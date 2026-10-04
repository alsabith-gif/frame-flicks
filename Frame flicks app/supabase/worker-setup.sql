-- =====================================================================
-- Frame Flicks — worker system. ALL new SQL lives in this one file.
-- Run it in Supabase → SQL Editor, one PART at a time, in order.
-- Each part is safe to run twice.
-- =====================================================================


-- =====================================================================
-- PART 1A — profiles + make YOURSELF admin   (run this FIRST)
-- Nothing is locked down yet, so you cannot lock yourself out here.
--
-- Step 1: find your login email:   select id, email from auth.users;
-- Step 2: replace YOUR_ADMIN_LOGIN_EMAIL below with it, then run 1A.
-- Step 3: the last select must show ONE row with role = admin.
-- =====================================================================

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('admin', 'worker')),
  name       text,
  email      text,
  active     boolean not null default true,
  created_at timestamptz default now()
);

-- is_admin(): true only for an ACTIVE admin. SECURITY DEFINER so it can read
-- profiles without being blocked by profiles' own RLS (no recursion).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = (select auth.uid()) and role = 'admin' and active
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ► EDIT THIS EMAIL ◄
insert into public.profiles (user_id, role, name, email, active)
select id, 'admin', 'Owner', email, true
from auth.users
where email = 'YOUR_ADMIN_LOGIN_EMAIL'
on conflict (user_id) do update set role = 'admin', active = true;

select user_id, email, role, active from public.profiles;   -- must show you, role = admin


-- =====================================================================
-- PART 1B — the lockdown   (run after 1A shows you as admin)
-- Aborts with an error (and changes nothing) if no active admin exists,
-- so it can never lock you out.
-- =====================================================================

do $$
begin
  if not exists (select 1 from public.profiles where role = 'admin' and active) then
    raise exception 'No active admin in profiles. Run PART 1A first (with your email). Nothing was changed.';
  end if;
end $$;

-- ---- profiles: admin does everything; everyone may read ONLY their own row.
-- Nobody but an admin can insert/update/delete, so a worker cannot promote
-- themselves or re-activate themselves.
alter table public.profiles enable row level security;
revoke all on public.profiles from anon;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles' loop
    execute format('drop policy %I on public.profiles', p.policyname);
  end loop;
end $$;

create policy "profiles: admin all" on public.profiles
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "profiles: read own row" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---- app_data: ADMIN ONLY. Drops whatever policies exist today (any name).
alter table public.app_data enable row level security;
revoke all on public.app_data from anon;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'app_data' loop
    execute format('drop policy %I on public.app_data', p.policyname);
  end loop;
end $$;

create policy "app_data: admin only" on public.app_data
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- project_status (client progress links).
-- Before: any logged-in user could write, and anyone could list every row.
-- Now: only the admin writes/reads directly. The public tracker page gets a
-- single project through get_project_status(track_code) below.
do $$
declare p record;
begin
  if to_regclass('public.project_status') is null then
    raise notice 'project_status table not found — skipped (client links not set up).';
    return;
  end if;

  alter table public.project_status enable row level security;

  -- drop every policy except plain public SELECT (kept until PART 1C)
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'project_status' and cmd <> 'SELECT' loop
    execute format('drop policy %I on public.project_status', p.policyname);
  end loop;

  -- make sure the old public read still exists so the live tracker keeps working
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'project_status' and cmd = 'SELECT') then
    create policy "Public can read by track_code" on public.project_status for select using (true);
  end if;

  drop policy if exists "project_status: admin read"   on public.project_status;
  drop policy if exists "project_status: admin insert" on public.project_status;
  drop policy if exists "project_status: admin update" on public.project_status;
  drop policy if exists "project_status: admin delete" on public.project_status;

  create policy "project_status: admin read"   on public.project_status for select to authenticated using ((select public.is_admin()));
  create policy "project_status: admin insert" on public.project_status for insert to authenticated with check ((select public.is_admin()));
  create policy "project_status: admin update" on public.project_status for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
  create policy "project_status: admin delete" on public.project_status for delete to authenticated using ((select public.is_admin()));

  -- single-project lookup for the public tracker page (needs the exact code)
  execute $f$
    create or replace function public.get_project_status(p_code text)
    returns jsonb
    language sql
    stable
    security definer
    set search_path = public
    as $body$
      select to_jsonb(t) from (
        select client, project, stage, stages, services, note, due_date, stage_history, updated_at
        from public.project_status
        where track_code = p_code
        limit 1
      ) t;
    $body$;
  $f$;
  revoke all on function public.get_project_status(text) from public;
  grant execute on function public.get_project_status(text) to anon, authenticated;
end $$;

-- ---- push_subscriptions / push_reminders: already per-user
-- ("own subscriptions" / "own reminders", auth.uid() = user_id). Left as is,
-- so a worker can only ever touch their own rows. Anonymous access removed:
do $$
begin
  if to_regclass('public.push_subscriptions') is not null then
    revoke all on public.push_subscriptions from anon;
  end if;
  if to_regclass('public.push_reminders') is not null then
    revoke all on public.push_reminders from anon;
  end if;
end $$;


-- =====================================================================
-- PART 1C — close public listing of project_status
-- Run ONLY after you have deployed the new js/tracker.js (it calls
-- get_project_status) and opened a client link in a private window to
-- confirm it still loads.
-- =====================================================================

do $$
declare p record;
begin
  if to_regclass('public.project_status') is null then return; end if;
  for p in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'project_status' and cmd = 'SELECT'
             and policyname <> 'project_status: admin read' loop
    execute format('drop policy %I on public.project_status', p.policyname);
  end loop;
  revoke select on public.project_status from anon;
end $$;


-- Check: policies now in force
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'app_data', 'project_status', 'push_subscriptions', 'push_reminders')
order by tablename, cmd, policyname;


-- =====================================================================
-- PART 2 — worker accounts   (Phase 2: run after Part 1 is finished, before
-- you use the Workers page)
-- =====================================================================

-- A worker's usual job: camera person or editor. (profiles.role stays
-- admin/worker — this is a separate label.)
alter table public.profiles add column if not exists job_role text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_job_role_check') then
    alter table public.profiles
      add constraint profiles_job_role_check check (job_role is null or job_role in ('camera', 'editor'));
  end if;
end $$;

-- Two accounts can never share one email (case-insensitive).
create unique index if not exists profiles_email_unique
  on public.profiles (lower(email)) where email is not null;

-- Signs a person out everywhere. Only the edge function (service role) may
-- call it — never the browser. Used when a worker is deactivated or their
-- access is reset.
create or replace function public.admin_revoke_sessions(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_user;
$$;

revoke all on function public.admin_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_sessions(uuid) to service_role;

-- Check: your admin row plus any workers (job_role is empty for admins)
select user_id, email, role, job_role, active from public.profiles order by role, email;
