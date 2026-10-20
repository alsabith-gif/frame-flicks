-- =====================================================================
-- Frame Flicks — SECURITY PROOF for worker accounts
-- Run this WHOLE file in Supabase → SQL Editor (click Run once).
--
-- What it does: it makes four pretend people (an admin, two workers and a
-- deactivated worker, all with emails ending @wt-test.invalid), then pretends
-- to BE each of them and tries to do things a worker must NOT be able to do.
-- Every attempt must be refused (or return nothing). It also checks that the
-- admin CAN do these things — so a "pass" really means something.
--
-- It does not touch your real projects, workers or money. At the end it
-- deletes everything it made. The result is a list: every row must say PASS.
-- Safe to run as many times as you like.
-- =====================================================================

-- ---------- 0. clean up leftovers from an earlier run that was interrupted
delete from public.app_data       where key        = '__wt_probe__';
delete from public.feedback       where message like 'WT-FB%';
do $$ begin
  if to_regclass('public.project_status') is not null then
    delete from public.project_status where track_code = '__wt_probe__';
  end if;
end $$;
delete from public.push_reminders     where user_id in (select id from auth.users where email like '%@wt-test.invalid');
delete from public.push_subscriptions where user_id in (select id from auth.users where email like '%@wt-test.invalid');
delete from auth.users where email like '%@wt-test.invalid';   -- also removes their profiles, jobs, choices

-- ---------- 1. tools for this run (they vanish when the run ends)
drop table if exists pg_temp.wt_results;
create temp table wt_results (seq serial, area text, name text, pass boolean, detail text);
grant all on wt_results to public;
grant usage, select on sequence wt_results_seq_seq to public;

create or replace function pg_temp.as_user(uid text, r text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  perform set_config('request.jwt.claim.role', r, false);
  perform set_config('request.jwt.claims', case when uid is null then '{}' else json_build_object('sub', uid, 'role', r)::text end, false);
  execute format('set role %I', r);
end $$;

create or replace function pg_temp.rec(a text, n text, p boolean, d text default null) returns void language plpgsql as $$
declare v text := current_user;
begin
  reset role;
  insert into wt_results (area, name, pass, detail) values (a, n, coalesce(p, false), d);
  if v <> session_user then execute format('set role %I', v); end if;
end $$;

-- ---------- 2. the pretend people and some data
insert into auth.users (id, email) values
  ('aaaaaaaa-7e57-4000-8000-000000000001', 'admin@wt-test.invalid'),
  ('bbbbbbbb-7e57-4000-8000-000000000001', 'workerA@wt-test.invalid'),
  ('bbbbbbbb-7e57-4000-8000-000000000002', 'workerB@wt-test.invalid'),
  ('bbbbbbbb-7e57-4000-8000-000000000003', 'workerOff@wt-test.invalid');

insert into public.profiles (user_id, role, name, email, active, job_role) values
  ('aaaaaaaa-7e57-4000-8000-000000000001', 'admin',  'WT Admin',  'admin@wt-test.invalid',     true, null),
  ('bbbbbbbb-7e57-4000-8000-000000000001', 'worker', 'WT Worker A', 'workerA@wt-test.invalid', true, 'camera'),
  ('bbbbbbbb-7e57-4000-8000-000000000002', 'worker', 'WT Worker B', 'workerB@wt-test.invalid', true, 'editor'),
  ('bbbbbbbb-7e57-4000-8000-000000000003', 'worker', 'WT Worker Off', 'workerOff@wt-test.invalid', true, 'camera');

-- "probe" rows: stand-ins for your private data, so we can prove a worker cannot touch them
insert into public.app_data (key, value) values ('__wt_probe__', '{"secret":"admin only"}');
do $$ begin
  if to_regclass('public.project_status') is not null then
    insert into public.project_status (track_code) values ('__wt_probe__');
  end if;
end $$;

-- Jobs. Worker A has two (one finished and paid), worker B has one. Odd pay numbers make leaks easy to spot.
insert into public.worker_tasks (id, project_id, worker_id, role, title, client_name, shoot_date, shoot_time, due_date, status, notes, pay_amount, pay_status, paid_on, done_at) values
  ('d0000000-7e57-4000-8000-0000000000a1', 'wt-p1', 'bbbbbbbb-7e57-4000-8000-000000000001', 'camera', 'WT Job A1', 'WT Client', current_date + 10, '10:30', current_date + 20, 'todo', 'NOTE-FOR-CREW-77', 123457, 'unpaid', null, null),
  ('d0000000-7e57-4000-8000-0000000000a2', 'wt-p2', 'bbbbbbbb-7e57-4000-8000-000000000001', 'camera', 'WT Job A2 old', 'WT Client', current_date - 20, null, current_date - 10, 'done', null, 111113, 'paid', current_date - 5, now() - interval '12 days'),
  ('d0000000-7e57-4000-8000-0000000000b1', 'wt-p1', 'bbbbbbbb-7e57-4000-8000-000000000002', 'editor', 'WT Job B1', 'WT Client', current_date + 10, null, current_date + 25, 'todo', null, 987653, 'unpaid', null, null),
  ('d0000000-7e57-4000-8000-0000000000c1', 'wt-p3', 'bbbbbbbb-7e57-4000-8000-000000000003', 'camera', 'WT Job Off', 'WT Client', current_date + 7, null, current_date + 14, 'todo', null, 55551, 'unpaid', null, null);

-- Worker "Off" has turned notifications on (a phone is registered), before being deactivated below.
insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values
  ('https://wt-test.invalid/push/off', 'bbbbbbbb-7e57-4000-8000-000000000003', 'k', 'a'),
  ('https://wt-test.invalid/push/b',   'bbbbbbbb-7e57-4000-8000-000000000002', 'k', 'a'),
  ('https://wt-test.invalid/push/a',   'bbbbbbbb-7e57-4000-8000-000000000001', 'k', 'a');

-- snapshots, to prove nothing was changed behind the scenes
create temp table wt_snap as
  select (select md5(string_agg(t::text, '|' order by id)) from public.worker_tasks t where t.project_id like 'wt-%') as tasks,
         (select md5(string_agg(p::text, '|' order by user_id)) from public.profiles p where p.email like '%@wt-test.invalid') as profiles,
         (select md5(string_agg(a::text, '|' order by key)) from public.app_data a where a.key = '__wt_probe__') as app_data;
grant all on wt_snap to public;

-- ---------- 3. the attempts (each part is separate: if one stops with an error it shows up as a FAIL line)
do $$
declare
  ADM constant text := 'aaaaaaaa-7e57-4000-8000-000000000001';
  WA  constant text := 'bbbbbbbb-7e57-4000-8000-000000000001';
  WB  constant text := 'bbbbbbbb-7e57-4000-8000-000000000002';
  WO  constant text := 'bbbbbbbb-7e57-4000-8000-000000000003';
  tA1 constant uuid := 'd0000000-7e57-4000-8000-0000000000a1';
  tA2 constant uuid := 'd0000000-7e57-4000-8000-0000000000a2';
  tB1 constant uuid := 'd0000000-7e57-4000-8000-0000000000b1';
  n int; n2 int; ok boolean; msg text; has_ps boolean := to_regclass('public.project_status') is not null;
  fn text; r record;
begin
  -- ===================================================================
  -- 1. app_data (all your business data) — admin only
  -- ===================================================================
  perform pg_temp.as_user(ADM, 'authenticated');
  select count(*) into n from public.app_data;
  perform pg_temp.rec('1 app_data', 'ADMIN can read app_data (so the tests below mean something)', n >= 1, n::text);
  perform pg_temp.as_user(WA, 'authenticated');
  select count(*) into n from public.app_data;
  perform pg_temp.rec('1 app_data', 'worker reads ZERO app_data rows', n = 0, n::text);
  begin insert into public.app_data (key, value) values ('__wt_hack__', '{}'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('1 app_data', 'worker cannot INSERT into app_data', ok);
  update public.app_data set value = value; get diagnostics n = row_count;
  perform pg_temp.rec('1 app_data', 'worker cannot UPDATE app_data (0 rows touched)', n = 0, n::text);
  delete from public.app_data where key = '__wt_probe__'; get diagnostics n = row_count;
  perform pg_temp.rec('1 app_data', 'worker cannot DELETE app_data (0 rows touched)', n = 0, n::text);
  perform pg_temp.as_user(null, 'anon');
  begin select count(*) into n from public.app_data; ok := (n = 0); exception when others then ok := true; end;
  perform pg_temp.rec('1 app_data', 'signed-out visitor cannot read app_data', ok);

  -- ===================================================================
  -- 2. worker_tasks — own jobs only, read only
  -- =====================================================================
  perform pg_temp.as_user(ADM, 'authenticated');
  select count(*) into n from public.worker_tasks where project_id like 'wt-%';
  perform pg_temp.rec('2 jobs', 'ADMIN sees all test jobs (4)', n = 4, n::text);
  perform pg_temp.as_user(WA, 'authenticated');
  select count(*) into n from public.worker_tasks where project_id like 'wt-%';
  perform pg_temp.rec('2 jobs', 'worker A sees only their own 2 jobs', n = 2, n::text);
  select count(*) into n from public.worker_tasks where id = tB1;
  perform pg_temp.rec('2 jobs', 'worker A cannot see worker B''s job even by its exact id', n = 0, n::text);
  select count(*) into n from public.worker_tasks where worker_id <> WA::uuid;
  perform pg_temp.rec('2 jobs', 'worker A cannot see any job that belongs to someone else', n = 0, n::text);
  begin insert into public.worker_tasks (project_id, worker_id, role, title) values ('wt-hack', WA::uuid, 'camera', 'self-assigned'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('2 jobs', 'worker cannot create a job for themselves', ok);
  begin insert into public.worker_tasks (project_id, worker_id, role, title) values ('wt-hack', WB::uuid, 'camera', 'for B'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('2 jobs', 'worker cannot create a job for someone else', ok);
  update public.worker_tasks set title = 'hacked'; get diagnostics n = row_count;
  perform pg_temp.rec('2 jobs', 'worker cannot edit any job directly (0 rows touched)', n = 0, n::text);
  delete from public.worker_tasks; get diagnostics n = row_count;
  perform pg_temp.rec('2 jobs', 'worker cannot delete any job (0 rows touched)', n = 0, n::text);
  perform pg_temp.as_user(null, 'anon');
  begin select count(*) into n from public.worker_tasks; ok := (n = 0); exception when others then ok := true; end;
  perform pg_temp.rec('2 jobs', 'signed-out visitor cannot read jobs', ok);
exception when others then
  perform pg_temp.rec('2. worker_tasks — own jobs only, read on', 'THIS PART STOPPED WITH AN ERROR', false, sqlerrm);
end $$;

do $$
declare
  ADM constant text := 'aaaaaaaa-7e57-4000-8000-000000000001';
  WA  constant text := 'bbbbbbbb-7e57-4000-8000-000000000001';
  WB  constant text := 'bbbbbbbb-7e57-4000-8000-000000000002';
  WO  constant text := 'bbbbbbbb-7e57-4000-8000-000000000003';
  tA1 constant uuid := 'd0000000-7e57-4000-8000-0000000000a1';
  tA2 constant uuid := 'd0000000-7e57-4000-8000-0000000000a2';
  tB1 constant uuid := 'd0000000-7e57-4000-8000-0000000000b1';
  n int; n2 int; ok boolean; msg text; has_ps boolean := to_regclass('public.project_status') is not null;
  fn text; r record;
begin
  -- ===================================================================
  -- 3. status changes — only your own job, never pay
  -- =====================================================================
  perform pg_temp.as_user(WA, 'authenticated');
  begin perform public.worker_set_status(tB1, 'done'); ok := false; exception when others then ok := true; msg := sqlerrm; end;
  perform pg_temp.rec('3 status', 'worker A cannot change the status of worker B''s job', ok, msg);
  begin perform public.worker_set_status(tA1, 'finished'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('3 status', 'a made-up status is refused', ok);
  begin perform public.worker_set_status(tA2, 'todo'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('3 status', 'a worker cannot re-open a job the admin has marked paid', ok);
  perform public.worker_set_status(tA1, 'in_progress');
  perform public.worker_set_status(tA1, 'done');
  select (status = 'done' and done_at is not null) into ok from public.worker_tasks where id = tA1;
  perform pg_temp.rec('3 status', 'worker CAN change their own job''s status (the one thing allowed)', ok);
  begin update public.worker_tasks set pay_amount = 999999, pay_status = 'paid', paid_on = current_date where id = tA1; get diagnostics n = row_count; ok := (n = 0); exception when others then ok := true; end;
  perform pg_temp.rec('3 status', 'worker cannot change pay, paid status or paid date', ok);
  reset role;
  select (pay_amount = 123457 and pay_status = 'unpaid' and paid_on is null) into ok from public.worker_tasks where id = tA1;
  perform pg_temp.rec('3 status', 'after all that, the pay fields are exactly as the admin set them', ok);
  select (status = 'todo' and pay_amount = 987653) into ok from public.worker_tasks where id = tB1;
  perform pg_temp.rec('3 status', 'worker B''s job was not touched', ok);
  perform pg_temp.as_user(null, 'anon');
  begin perform public.worker_set_status(tA1, 'todo'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('3 status', 'signed-out visitor cannot change a status', ok);
  perform pg_temp.as_user(ADM, 'authenticated');
  begin perform public.worker_set_status(tA1, 'todo'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('3 status', 'the worker status function refuses a non-worker account', ok);
exception when others then
  perform pg_temp.rec('3. status changes — only your own job, n', 'THIS PART STOPPED WITH AN ERROR', false, sqlerrm);
end $$;

do $$
declare
  ADM constant text := 'aaaaaaaa-7e57-4000-8000-000000000001';
  WA  constant text := 'bbbbbbbb-7e57-4000-8000-000000000001';
  WB  constant text := 'bbbbbbbb-7e57-4000-8000-000000000002';
  WO  constant text := 'bbbbbbbb-7e57-4000-8000-000000000003';
  tA1 constant uuid := 'd0000000-7e57-4000-8000-0000000000a1';
  tA2 constant uuid := 'd0000000-7e57-4000-8000-0000000000a2';
  tB1 constant uuid := 'd0000000-7e57-4000-8000-0000000000b1';
  n int; n2 int; ok boolean; msg text; has_ps boolean := to_regclass('public.project_status') is not null;
  fn text; r record;
begin
  -- ===================================================================
  -- 4. profiles — see only yourself, never change role / active
  -- =====================================================================
  perform pg_temp.as_user(ADM, 'authenticated');
  select count(*) into n from public.profiles where email like '%@wt-test.invalid';
  perform pg_temp.rec('4 profiles', 'ADMIN sees all 4 test profiles', n = 4, n::text);
  perform pg_temp.as_user(WA, 'authenticated');
  select count(*) into n from public.profiles;
  select count(*) into n2 from public.profiles where user_id = WA::uuid;
  perform pg_temp.rec('4 profiles', 'worker sees only their own profile row (1 row)', n = 1 and n2 = 1, n::text);
  update public.profiles set role = 'admin' where user_id = WA::uuid; get diagnostics n = row_count;
  perform pg_temp.rec('4 profiles', 'worker cannot make themselves admin', n = 0, n::text);
  update public.profiles set active = false; get diagnostics n = row_count;
  perform pg_temp.rec('4 profiles', 'worker cannot change anyone''s active flag', n = 0, n::text);
  update public.profiles set name = 'hacked'; get diagnostics n = row_count;
  perform pg_temp.rec('4 profiles', 'worker cannot even rename themselves', n = 0, n::text);
  begin insert into public.profiles (user_id, role, name, email) values ('bbbbbbbb-7e57-4000-8000-0000000000ff', 'admin', 'x', 'x@wt-test.invalid'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('4 profiles', 'worker cannot create a profile', ok);
  delete from public.profiles; get diagnostics n = row_count;
  perform pg_temp.rec('4 profiles', 'worker cannot delete a profile', n = 0, n::text);
  perform pg_temp.as_user(null, 'anon');
  begin select count(*) into n from public.profiles; ok := (n = 0); exception when others then ok := true; end;
  perform pg_temp.rec('4 profiles', 'signed-out visitor cannot read profiles', ok);
  begin perform public.is_admin(); ok := true; exception when others then ok := true; end;
  perform pg_temp.as_user(WA, 'authenticated');
  perform pg_temp.rec('4 profiles', 'is_admin() says NO for a worker', not public.is_admin());
exception when others then
  perform pg_temp.rec('4. profiles — see only yourself, never c', 'THIS PART STOPPED WITH AN ERROR', false, sqlerrm);
end $$;

do $$
declare
  ADM constant text := 'aaaaaaaa-7e57-4000-8000-000000000001';
  WA  constant text := 'bbbbbbbb-7e57-4000-8000-000000000001';
  WB  constant text := 'bbbbbbbb-7e57-4000-8000-000000000002';
  WO  constant text := 'bbbbbbbb-7e57-4000-8000-000000000003';
  tA1 constant uuid := 'd0000000-7e57-4000-8000-0000000000a1';
  tA2 constant uuid := 'd0000000-7e57-4000-8000-0000000000a2';
  tB1 constant uuid := 'd0000000-7e57-4000-8000-0000000000b1';
  n int; n2 int; ok boolean; msg text; has_ps boolean := to_regclass('public.project_status') is not null;
  fn text; r record;
begin
  -- ===================================================================
  -- 5. project_status (client progress links) — no direct access
  -- =====================================================================
  if has_ps then
    perform pg_temp.as_user(WA, 'authenticated');
    select count(*) into n from public.project_status;
    perform pg_temp.rec('5 project_status', 'worker reads ZERO project_status rows', n = 0, n::text);
    begin insert into public.project_status (track_code) values ('__wt_hack__'); ok := false; exception when others then ok := true; end;
    perform pg_temp.rec('5 project_status', 'worker cannot INSERT project_status', ok);
    update public.project_status set client = 'hacked'; get diagnostics n = row_count;
    perform pg_temp.rec('5 project_status', 'worker cannot UPDATE project_status', n = 0, n::text);
    delete from public.project_status; get diagnostics n = row_count;
    perform pg_temp.rec('5 project_status', 'worker cannot DELETE project_status', n = 0, n::text);
    perform pg_temp.as_user(null, 'anon');
    begin select count(*) into n from public.project_status; ok := (n = 0); exception when others then ok := true; end;
    perform pg_temp.rec('5 project_status', 'signed-out visitor cannot list project_status (only a client link with its exact code works)', ok, n::text);
    perform pg_temp.as_user(ADM, 'authenticated');
    select count(*) into n from public.project_status where track_code = '__wt_probe__';
    perform pg_temp.rec('5 project_status', 'ADMIN can read project_status', n = 1, n::text);
  else
    perform pg_temp.rec('5 project_status', 'project_status table not set up here — skipped', true, 'no client links in use');
  end if;
exception when others then
  perform pg_temp.rec('5. project_status (client progress links', 'THIS PART STOPPED WITH AN ERROR', false, sqlerrm);
end $$;

do $$
declare
  ADM constant text := 'aaaaaaaa-7e57-4000-8000-000000000001';
  WA  constant text := 'bbbbbbbb-7e57-4000-8000-000000000001';
  WB  constant text := 'bbbbbbbb-7e57-4000-8000-000000000002';
  WO  constant text := 'bbbbbbbb-7e57-4000-8000-000000000003';
  tA1 constant uuid := 'd0000000-7e57-4000-8000-0000000000a1';
  tA2 constant uuid := 'd0000000-7e57-4000-8000-0000000000a2';
  tB1 constant uuid := 'd0000000-7e57-4000-8000-0000000000b1';
  n int; n2 int; ok boolean; msg text; has_ps boolean := to_regclass('public.project_status') is not null;
  fn text; r record;
begin
  -- ===================================================================
  -- 6. admin-only functions cannot be called by workers
  -- =====================================================================
  perform pg_temp.as_user(WA, 'authenticated');
  begin perform public.admin_revoke_sessions(WB::uuid); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('6 admin functions', 'worker cannot call admin_revoke_sessions (sign someone out)', ok);
  perform pg_temp.as_user(ADM, 'authenticated');
  begin perform public.admin_revoke_sessions(WB::uuid); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('6 admin functions', 'not even the admin''s browser can call admin_revoke_sessions (only the server function can)', ok);
  perform pg_temp.as_user(null, 'anon');
  begin perform public.admin_revoke_sessions(WB::uuid); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('6 admin functions', 'signed-out visitor cannot call admin_revoke_sessions', ok);
  reset role;
  for fn in select unnest(array[
      'public.admin_revoke_sessions(uuid)', 'public.rebuild_task_reminders(uuid)', 'public.rebuild_worker_reminders(uuid)',
      'public.push_worker_alert(uuid,uuid,text,text,text)', 'public.worker_wants(uuid,text)',
      'public.worker_tasks_notify()', 'public.profiles_notify_active()']) loop
    perform pg_temp.rec('6 admin functions', 'browser roles cannot run ' || fn,
      not has_function_privilege('authenticated', fn, 'execute') and not has_function_privilege('anon', fn, 'execute'));
  end loop;
  perform pg_temp.rec('6 admin functions', 'the only functions a worker may call are the two safe ones (status, notification choices)',
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in ('worker_set_status', 'worker_set_notif_prefs')
        and has_function_privilege('authenticated', p.oid, 'execute')) = 2);
exception when others then
  perform pg_temp.rec('6. admin-only functions cannot be called', 'THIS PART STOPPED WITH AN ERROR', false, sqlerrm);
end $$;

do $$
declare
  ADM constant text := 'aaaaaaaa-7e57-4000-8000-000000000001';
  WA  constant text := 'bbbbbbbb-7e57-4000-8000-000000000001';
  WB  constant text := 'bbbbbbbb-7e57-4000-8000-000000000002';
  WO  constant text := 'bbbbbbbb-7e57-4000-8000-000000000003';
  tA1 constant uuid := 'd0000000-7e57-4000-8000-0000000000a1';
  tA2 constant uuid := 'd0000000-7e57-4000-8000-0000000000a2';
  tB1 constant uuid := 'd0000000-7e57-4000-8000-0000000000b1';
  n int; n2 int; ok boolean; msg text; has_ps boolean := to_regclass('public.project_status') is not null;
  fn text; r record;
begin
  -- ===================================================================
  -- 8. deactivation — access stops at once
  -- =====================================================================
  perform pg_temp.as_user(WO, 'authenticated');
  select count(*) into n from public.worker_tasks;
  perform pg_temp.rec('8 deactivated', 'BEFORE deactivation worker "Off" sees their job (so the next tests mean something)', n = 1, n::text);
  reset role;
  select count(*) into n from public.push_reminders where user_id = WO::uuid and not sent;
  select count(*) into n2 from public.push_subscriptions where user_id = WO::uuid;
  perform pg_temp.rec('8 deactivated', 'BEFORE deactivation they have waiting notifications and a registered phone', n > 0 and n2 = 1, n || ' / ' || n2);

  update public.profiles set active = false where user_id = WO::uuid;      -- what the admin's "Deactivate" button does
  perform pg_temp.as_user(WO, 'authenticated');
  select count(*) into n from public.worker_tasks;
  perform pg_temp.rec('8 deactivated', 'deactivated worker: job list is now EMPTY', n = 0, n::text);
  begin perform public.worker_set_status('d0000000-7e57-4000-8000-0000000000c1', 'done'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('8 deactivated', 'deactivated worker cannot change a status', ok);
  begin perform public.worker_set_notif_prefs(true, true, true, true); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('8 deactivated', 'deactivated worker cannot change notification choices', ok);
  perform pg_temp.rec('8 deactivated', 'is_active_worker() says NO', not public.is_active_worker());
  reset role;
  select count(*) into n from public.push_reminders where user_id = WO::uuid and not sent;
  perform pg_temp.rec('8 deactivated', 'their waiting notifications were deleted', n = 0, n::text);
  select count(*) into n from public.push_subscriptions where user_id = WO::uuid;
  perform pg_temp.rec('8 deactivated', 'their registered phone was deleted', n = 0, n::text);
  perform pg_temp.as_user(ADM, 'authenticated');
  update public.worker_tasks set title = 'WT Job Off (changed)', shoot_date = current_date + 3 where id = 'd0000000-7e57-4000-8000-0000000000c1';
  insert into public.worker_tasks (project_id, worker_id, role, title, shoot_date) values ('wt-p4', WO::uuid, 'camera', 'WT assigned after', current_date + 3);
  reset role;
  select count(*) into n from public.push_reminders where user_id = WO::uuid;
  perform pg_temp.rec('8 deactivated', 'changing or assigning jobs to them creates NO notifications', n = 0, n::text);
  perform pg_temp.as_user(WO, 'authenticated');
  begin insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://wt-test.invalid/push/off2', WO::uuid, 'k', 'a'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('8 deactivated', 'deactivated worker cannot register a new phone', ok);
  -- re-activation brings reminders back, and the app asks them to turn on their phone again
  reset role;
  update public.profiles set active = true where user_id = WO::uuid;
  perform pg_temp.as_user(WO, 'authenticated');
  select count(*) into n from public.worker_tasks;
  perform pg_temp.rec('8 deactivated', 'after re-activation the worker sees their jobs again', n = 2, n::text);
  reset role;
  update public.profiles set active = false where user_id = WO::uuid;
exception when others then
  perform pg_temp.rec('8. deactivation — access stops at once', 'THIS PART STOPPED WITH AN ERROR', false, sqlerrm);
end $$;

do $$
declare
  ADM constant text := 'aaaaaaaa-7e57-4000-8000-000000000001';
  WA  constant text := 'bbbbbbbb-7e57-4000-8000-000000000001';
  WB  constant text := 'bbbbbbbb-7e57-4000-8000-000000000002';
  WO  constant text := 'bbbbbbbb-7e57-4000-8000-000000000003';
  tA1 constant uuid := 'd0000000-7e57-4000-8000-0000000000a1';
  tA2 constant uuid := 'd0000000-7e57-4000-8000-0000000000a2';
  tB1 constant uuid := 'd0000000-7e57-4000-8000-0000000000b1';
  n int; n2 int; ok boolean; msg text; has_ps boolean := to_regclass('public.project_status') is not null;
  fn text; r record;
begin
  -- ===================================================================
  -- 9. notifications never contain pay, client phone or price
  -- ===================================================================
  -- make every kind of notification happen: assigned, changed, removed, reminders
  perform pg_temp.as_user(ADM, 'authenticated');
  update public.worker_tasks set title = 'WT Job A1 renamed', location = 'Studio 9', shoot_date = current_date + 12 where id = tA1;
  update public.worker_tasks set status = 'todo', done_at = null where id = tA1;
  update public.worker_tasks set pay_amount = 424243 where id = tB1;
  delete from public.worker_tasks where id = tB1;
  insert into public.worker_tasks (project_id, worker_id, role, title, shoot_date, shoot_time, due_date, pay_amount, notes)
    values ('wt-p5', WA::uuid, 'camera', 'WT Job A3', current_date + 15, '09:00', current_date + 18, 777771, 'NOTE-FOR-CREW-77');
  reset role;
  select count(*) into n from public.push_reminders where user_id in (WA::uuid, WB::uuid);
  perform pg_temp.rec('9 notifications', 'a good number of notifications were created to inspect', n >= 8, n::text);
  -- only the test workers' notifications are inspected (your own admin calendar reminders may legitimately say "payment")
  select count(*), left(string_agg('[' || type || '] ' || coalesce(title, '') || ' / ' || coalesce(body, '') || ' / ' || coalesce(url, '') || ' / ' || coalesce(tag, ''), '  ||  '), 300)
    into n, msg from public.push_reminders
   where user_id in (WA::uuid, WB::uuid, WO::uuid)
     and coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || coalesce(url, '') || ' ' || coalesce(tag, '')
         ~* '(123457|111113|987653|424243|777771|55551|₹|rs\.? ?[0-9]|rupee|\mpay|paid|price|phone|mobile|invoice|NOTE-FOR-CREW)';
  perform pg_temp.rec('9 notifications', 'no notification mentions pay, price, phone, invoice or crew notes', n = 0, case when n = 0 then '0' else n || ' matched: ' || msg end);
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'worker_tasks' and column_name ~* '(phone|mobile|contact|price|budget|invoice|whatsapp|email)';
  perform pg_temp.rec('9 notifications', 'the worker jobs table has NO client phone / price / invoice column at all', n = 0, n::text);
  select count(*) into n from public.push_reminders where user_id in (WA::uuid, WB::uuid, WO::uuid) and url !~ '^\./index\.html(\?page=[a-z]+)?$';
  perform pg_temp.rec('9 notifications', 'every notification link stays inside the app', n = 0, n::text);

  -- one worker never gets another worker's notifications / phones / choices
  perform pg_temp.as_user(WA, 'authenticated');
  select count(*) into n from public.push_reminders where user_id <> WA::uuid;
  select count(*) into n2 from public.push_subscriptions where user_id <> WA::uuid;
  perform pg_temp.rec('9 notifications', 'worker A cannot see anyone else''s notifications or phones', n = 0 and n2 = 0, n || ' / ' || n2);
  begin insert into public.push_reminders (id, user_id, fire_at, title) values ('wt-forged', WB::uuid, now(), 'forged'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('9 notifications', 'worker cannot write a notification (not even to themselves)', ok);
  begin insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://wt-test.invalid/push/forged', WB::uuid, 'k', 'a'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('9 notifications', 'worker cannot register a phone under someone else''s name', ok);
  perform pg_temp.as_user(null, 'anon');
  begin select count(*) into n from public.push_reminders; ok := (n = 0); exception when others then ok := true; end;
  perform pg_temp.rec('9 notifications', 'signed-out visitor cannot read notifications', ok);
  -- notification choices are private too
  reset role;
  insert into public.worker_notif_prefs (user_id, enabled) values (WB::uuid, false) on conflict (user_id) do update set enabled = false;
  perform pg_temp.as_user(WA, 'authenticated');
  select count(*) into n from public.worker_notif_prefs where user_id <> WA::uuid;
  perform pg_temp.rec('9 notifications', 'worker A cannot read worker B''s notification choices', n = 0, n::text);
  update public.worker_notif_prefs set enabled = true where user_id = WB::uuid; get diagnostics n = row_count;
  perform pg_temp.rec('9 notifications', 'worker A cannot change worker B''s notification choices', n = 0, n::text);
exception when others then
  perform pg_temp.rec('make every kind of notification happen: ', 'THIS PART STOPPED WITH AN ERROR', false, sqlerrm);
end $$;

do $$
declare
  ADM constant text := 'aaaaaaaa-7e57-4000-8000-000000000001';
  WA  constant text := 'bbbbbbbb-7e57-4000-8000-000000000001';
  WO  constant text := 'bbbbbbbb-7e57-4000-8000-000000000003';
  n int; ok boolean;
begin
  -- ===================================================================
  -- 10. crew roles — workers may only READ the role names
  -- =====================================================================
  if to_regclass('public.crew_roles') is null then
    perform pg_temp.rec('10 crew roles', 'roles table exists (run PART 8)', false, 'crew_roles is missing');
    return;
  end if;
  perform pg_temp.as_user(ADM, 'authenticated');
  insert into public.crew_roles (key, label, main_date) values ('wt-probe', 'WT Probe Role', 'shoot');
  select count(*) into n from public.crew_roles where key = 'wt-probe';
  perform pg_temp.rec('10 crew roles', 'ADMIN can add a role (so the checks below mean something)', n = 1, n::text);
  perform pg_temp.as_user(WA, 'authenticated');
  select count(*) into n from public.crew_roles;
  perform pg_temp.rec('10 crew roles', 'active worker can read the role names', n >= 3, n::text);
  begin insert into public.crew_roles (key, label) values ('wt-evil', 'Evil'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('10 crew roles', 'worker cannot add a role', ok);
  update public.crew_roles set label = 'Hacked'; get diagnostics n = row_count;
  perform pg_temp.rec('10 crew roles', 'worker cannot rename a role', n = 0, n::text);
  delete from public.crew_roles; get diagnostics n = row_count;
  perform pg_temp.rec('10 crew roles', 'worker cannot remove a role', n = 0, n::text);
  begin update public.profiles set job_roles = array['camera', 'editor'] where user_id = WA::uuid; get diagnostics n = row_count; ok := (n = 0); exception when others then ok := true; end;
  perform pg_temp.rec('10 crew roles', 'worker cannot change their own roles', ok);
  perform pg_temp.as_user(WO, 'authenticated');
  select count(*) into n from public.crew_roles;
  perform pg_temp.rec('10 crew roles', 'deactivated worker cannot read roles', n = 0, n::text);
  perform pg_temp.as_user(null, 'anon');
  begin select count(*) into n from public.crew_roles; ok := (n = 0); exception when others then ok := true; end;
  perform pg_temp.rec('10 crew roles', 'signed-out visitor cannot read roles', ok);
  perform pg_temp.as_user(ADM, 'authenticated');
  delete from public.crew_roles where key = 'wt-probe';
  begin delete from public.crew_roles where key = 'camera'; ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('10 crew roles', 'even the admin cannot remove the built-in Camera role', ok);
  reset role;
exception when others then
  reset role;
  delete from public.crew_roles where key like 'wt-%';
  perform pg_temp.rec('10. crew roles', 'THIS PART STOPPED WITH AN ERROR', false, sqlerrm);
end $$;

do $$
declare
  ADM constant text := 'aaaaaaaa-7e57-4000-8000-000000000001';
  WA  constant text := 'bbbbbbbb-7e57-4000-8000-000000000001';
  WO  constant text := 'bbbbbbbb-7e57-4000-8000-000000000003';
  n int; ok boolean; cols text;
begin
  -- ===================================================================
  -- 11. contact number + anonymous feedback
  -- =====================================================================
  if to_regclass('public.feedback') is null or to_regclass('public.crew_contact') is null then
    perform pg_temp.rec('11 feedback', 'feedback + contact tables exist (run PART 9)', false, 'missing');
    return;
  end if;
  perform pg_temp.as_user(WA, 'authenticated');
  select count(*) into n from public.crew_contact;
  perform pg_temp.rec('11 contact', 'active worker can read the contact number row', n = 1, n::text);
  update public.crew_contact set phone = '000000'; get diagnostics n = row_count;
  perform pg_temp.rec('11 contact', 'worker cannot change the contact number', n = 0, n::text);
  perform pg_temp.as_user(WO, 'authenticated');
  select count(*) into n from public.crew_contact;
  perform pg_temp.rec('11 contact', 'deactivated worker cannot read the contact number', n = 0, n::text);

  perform pg_temp.as_user(WA, 'authenticated');
  perform public.submit_feedback('WT-FB probe message', 'okay');
  perform pg_temp.rec('11 feedback', 'active worker can send feedback', true);
  begin select count(*) into n from public.feedback; ok := (n = 0); exception when others then ok := true; end;
  perform pg_temp.rec('11 feedback', 'worker cannot read feedback (not even their own)', ok);
  begin update public.feedback set is_read = true; get diagnostics n = row_count; ok := (n = 0); exception when others then ok := true; end;
  perform pg_temp.rec('11 feedback', 'worker cannot change feedback', ok);
  begin delete from public.feedback; get diagnostics n = row_count; ok := (n = 0); exception when others then ok := true; end;
  perform pg_temp.rec('11 feedback', 'worker cannot delete feedback', ok);
  begin insert into public.feedback (message) values ('WT-FB direct'); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('11 feedback', 'worker cannot write to the feedback table directly', ok);
  perform pg_temp.as_user(WO, 'authenticated');
  begin perform public.submit_feedback('WT-FB deactivated', null); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('11 feedback', 'deactivated worker cannot send feedback', ok);
  perform pg_temp.as_user(null, 'anon');
  begin perform public.submit_feedback('WT-FB anon', null); ok := false; exception when others then ok := true; end;
  perform pg_temp.rec('11 feedback', 'signed-out visitor cannot send feedback', ok);

  reset role;
  select string_agg(column_name, ',' order by ordinal_position) into cols from information_schema.columns where table_schema = 'public' and table_name = 'feedback';
  perform pg_temp.rec('11 feedback', 'the feedback table stores NO user id, name, email or time', cols = 'id,seq,message,mood,day,is_read', cols);
  select count(*) into n from public.feedback f where f::text ~* (WA || '|workerA@|WT Worker A');
  perform pg_temp.rec('11 feedback', 'the saved message holds nothing that identifies the writer', n = 0, n::text);
  perform pg_temp.as_user(ADM, 'authenticated');
  select count(*) into n from public.feedback where message = 'WT-FB probe message';
  perform pg_temp.rec('11 feedback', 'ADMIN can read the feedback (so the checks above mean something)', n = 1, n::text);
  reset role;
  delete from public.feedback where message like 'WT-FB%';
exception when others then
  reset role;
  delete from public.feedback where message like 'WT-FB%';
  perform pg_temp.rec('11. feedback + contact', 'THIS PART STOPPED WITH AN ERROR', false, sqlerrm);
end $$;

do $$
declare
  ADM constant text := 'aaaaaaaa-7e57-4000-8000-000000000001';
  WA  constant text := 'bbbbbbbb-7e57-4000-8000-000000000001';
  WB  constant text := 'bbbbbbbb-7e57-4000-8000-000000000002';
  WO  constant text := 'bbbbbbbb-7e57-4000-8000-000000000003';
  tA1 constant uuid := 'd0000000-7e57-4000-8000-0000000000a1';
  tA2 constant uuid := 'd0000000-7e57-4000-8000-0000000000a2';
  tB1 constant uuid := 'd0000000-7e57-4000-8000-0000000000b1';
  n int; n2 int; ok boolean; msg text; has_ps boolean := to_regclass('public.project_status') is not null;
  fn text; r record;
begin
  -- ===================================================================
  -- nothing was changed behind the scenes
  -- =====================================================================
  reset role;
  select (select md5(string_agg(a::text, '|' order by key)) from public.app_data a where a.key = '__wt_probe__') = s.app_data into ok from wt_snap s;
  perform pg_temp.rec('end', 'the private app_data probe row is exactly as it was', ok);
  select (select md5(string_agg(p::text, '|' order by user_id)) from public.profiles p where p.email like '%@wt-test.invalid' and p.user_id <> WO::uuid)
         is not null into ok;
  perform pg_temp.rec('end', 'profiles of A, B and the admin are unchanged (roles, active flags)',
    (select count(*) from public.profiles where email like '%@wt-test.invalid' and role = 'admin') = 1
    and (select count(*) from public.profiles where email like '%@wt-test.invalid' and role = 'worker' and active) = 2);
exception when others then
  perform pg_temp.rec('nothing was changed behind the scenes', 'THIS PART STOPPED WITH AN ERROR', false, sqlerrm);
end $$;

-- ---------- 4. clean up everything this run made
reset role;
delete from public.app_data where key = '__wt_probe__';
do $$ begin
  if to_regclass('public.project_status') is not null then
    delete from public.project_status where track_code = '__wt_probe__';
  end if;
end $$;
delete from public.worker_tasks       where project_id like 'wt-%';
delete from public.push_reminders     where user_id in (select id from auth.users where email like '%@wt-test.invalid');
delete from public.push_subscriptions where user_id in (select id from auth.users where email like '%@wt-test.invalid');
delete from auth.users where email like '%@wt-test.invalid';

-- ---------- 5. the answer: every line must say PASS
select 'RESULT' as area,
       case when count(*) < 60 then 'ONLY ' || count(*) || ' CHECKS RAN — the script stopped early, treat as FAILED'
            when count(*) filter (where not pass) = 0 then 'ALL ' || count(*) || ' CHECKS PASSED'
            else count(*) filter (where not pass) || ' CHECK(S) FAILED — see the FAIL lines' end as name,
       case when count(*) >= 60 and count(*) filter (where not pass) = 0 then 'PASS' else 'FAIL' end as result,
       null::text as detail, 0 as seq
  from wt_results
union all
select area, name, case when pass then 'PASS' else 'FAIL' end, detail, seq from wt_results
order by seq;
