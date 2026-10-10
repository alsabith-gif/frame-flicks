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


-- =====================================================================
-- PART 3 — assigning jobs to workers   (Phase 3)
-- worker_tasks holds ONE row per (project, worker): what the worker may
-- see about the job and their own pay. It deliberately has NO client phone
-- and NO project price. Rules (enforced here, not just on screen):
--   • admin: full access
--   • worker: can READ only their own rows, and only while active
--   • worker: cannot insert, update or delete anything directly
-- (Phase 4 adds the one safe way for a worker to change a job's status.)
-- =====================================================================

-- True only for an ACTIVE worker. SECURITY DEFINER so policies can use it.
create or replace function public.is_active_worker()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = (select auth.uid()) and role = 'worker' and active
  );
$$;

revoke all on function public.is_active_worker() from public, anon;
grant execute on function public.is_active_worker() to authenticated;

create table if not exists public.worker_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   text not null,                                   -- the project's id in the app
  worker_id    uuid not null references auth.users (id) on delete cascade,
  role         text not null check (role in ('camera', 'editor')),
  title        text not null,
  client_name  text,
  location     text,
  shoot_date   date,
  shoot_time   time,
  due_date     date,
  status       text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  notes        text,                                            -- notes FOR THE CREW (not your private notes)
  pay_amount   numeric(12, 2) not null default 0 check (pay_amount >= 0),
  pay_status   text not null default 'unpaid' check (pay_status in ('unpaid', 'paid')),
  paid_on      date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, worker_id)
);

create index if not exists worker_tasks_worker_idx on public.worker_tasks (worker_id);

create or replace function public.touch_worker_task()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists worker_tasks_touch on public.worker_tasks;
create trigger worker_tasks_touch
  before update on public.worker_tasks
  for each row execute function public.touch_worker_task();

alter table public.worker_tasks enable row level security;
revoke all on public.worker_tasks from anon;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'worker_tasks' loop
    execute format('drop policy %I on public.worker_tasks', p.policyname);
  end loop;
end $$;

create policy "worker_tasks: admin all" on public.worker_tasks
  for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "worker_tasks: worker reads own" on public.worker_tasks
  for select to authenticated
  using (worker_id = (select auth.uid()) and (select public.is_active_worker()));

-- Check: you should see exactly the two policies above
select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'worker_tasks' order by policyname;


-- =====================================================================
-- PART 4 — workers can change the STATUS of their own jobs   (Phase 4)
-- This is the ONE and only way a worker writes anything to the database.
-- A worker still has no insert/update/delete rights on worker_tasks; the
-- function below runs with extra rights, but it checks everything itself:
--   • caller must be signed in and be an ACTIVE worker
--   • the job must belong to that caller (anyone else's job = "not found")
--   • status must be todo / in_progress / done
--   • it changes ONLY status, done_at and updated_at — never pay, never
--     pay_status, never paid_on, never the job details
-- Every part of this is safe to run twice.
-- =====================================================================

-- done_at = the moment the worker marked the job Done. It is set when the
-- job becomes Done and cleared if it is moved back. Phase 5's monthly
-- earnings view groups by it. (Jobs finished before this part existed get
-- their last-changed time as a best guess.)
alter table public.worker_tasks add column if not exists done_at timestamptz;

update public.worker_tasks
   set done_at = updated_at
 where status = 'done' and done_at is null;

create or replace function public.worker_set_status(task_id uuid, new_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.worker_tasks%rowtype;
  v_done_at timestamptz;
begin
  if v_uid is null then
    raise exception 'You are not signed in.' using errcode = '28000';
  end if;

  if not public.is_active_worker() then
    raise exception 'This account cannot change jobs.' using errcode = '42501';
  end if;

  if new_status is null or new_status not in ('todo', 'in_progress', 'done') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;

  -- Lock the row. Someone else's job and a job that does not exist look the
  -- same on purpose, so a worker cannot probe for other people's job ids.
  select * into v_row
    from public.worker_tasks
   where id = task_id and worker_id = v_uid
     for update;

  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;

  -- Same status again: nothing to do (and nothing is touched).
  if v_row.status = new_status then
    return jsonb_build_object('id', v_row.id, 'status', v_row.status,
                              'done_at', v_row.done_at, 'updated_at', v_row.updated_at);
  end if;

  -- A job the admin has already settled (paid) cannot be re-opened by the worker,
  -- so the pay record never ends up pointing at a job that is "not done".
  if v_row.pay_status = 'paid' then
    raise exception 'This job is closed. Ask the admin if it needs to be re-opened.' using errcode = '55000';
  end if;

  v_done_at := case when new_status = 'done' then now() else null end;

  update public.worker_tasks
     set status = new_status, done_at = v_done_at
   where id = v_row.id
  returning * into v_row;           -- updated_at is refreshed by the existing trigger

  return jsonb_build_object('id', v_row.id, 'status', v_row.status,
                            'done_at', v_row.done_at, 'updated_at', v_row.updated_at);
end;
$$;

revoke all on function public.worker_set_status(uuid, text) from public, anon, authenticated;
grant execute on function public.worker_set_status(uuid, text) to authenticated;

-- Check: the function exists, and the policies on worker_tasks are still only
-- the two from PART 3 (admin all / worker reads own) — workers still cannot write directly.
select proname from pg_proc where proname = 'worker_set_status';
select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'worker_tasks' order by policyname;


-- =====================================================================
-- PART 5 — pay tracking safety rules   (Phase 5)
-- The admin marks jobs paid / unpaid straight from the app (the admin policy
-- from PART 3 already allows that; workers still cannot write anything).
-- This part adds three rules that the DATABASE enforces on every write, so
-- they hold even if an old copy of the app is still open on someone's phone:
--   1. Only a job that is DONE can be marked paid.
--   2. Once a job is paid, its pay amount is LOCKED. (Today a project re-save
--      could silently overwrite it.) To change a paid amount: undo the
--      payment, change the amount, then mark it paid again.
--   3. A paid job always has a paid date (today, India time, if none is given);
--      an unpaid job never has one.
-- Safe to run twice.
-- =====================================================================

create or replace function public.worker_tasks_pay_guard()
returns trigger
language plpgsql
as $$
begin
  -- Rule 1
  if new.pay_status = 'paid' and new.status is distinct from 'done' then
    raise exception 'Only a job that is Done can be marked paid.' using errcode = '55000';
  end if;

  -- Rule 2 (compares the stored amounts, so re-saving the same amount is fine)
  if tg_op = 'UPDATE'
     and old.pay_status = 'paid' and new.pay_status = 'paid'
     and new.pay_amount is distinct from old.pay_amount then
    raise exception 'This job is already paid, so its pay amount is locked. Undo the payment first if the amount must change.'
      using errcode = '55000';
  end if;

  -- Rule 3
  if new.pay_status = 'paid' then
    new.paid_on := coalesce(new.paid_on, (now() at time zone 'Asia/Kolkata')::date);
  else
    new.paid_on := null;
  end if;

  return new;
end;
$$;

drop trigger if exists worker_tasks_pay_guard on public.worker_tasks;
create trigger worker_tasks_pay_guard
  before insert or update on public.worker_tasks
  for each row execute function public.worker_tasks_pay_guard();

-- Check: you should see the guard trigger, and STILL only the same two policies
-- (admin all / worker reads own) — a worker still cannot write to this table.
select tgname from pg_trigger
where tgrelid = 'public.worker_tasks'::regclass and not tgisinternal order by tgname;
select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'worker_tasks' order by policyname;
