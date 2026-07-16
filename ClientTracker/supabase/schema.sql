-- Run this once in Supabase: Project → SQL Editor → New query → paste → Run

create table if not exists app_data (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_data enable row level security;

-- Only logged-in users (you) can read/write. Since this is a single-user
-- app, we don't need per-row ownership checks — any authenticated session
-- is you.
create policy "authenticated can read app_data"
  on app_data for select
  using (auth.role() = 'authenticated');

create policy "authenticated can insert app_data"
  on app_data for insert
  with check (auth.role() = 'authenticated');

create policy "authenticated can update app_data"
  on app_data for update
  using (auth.role() = 'authenticated');
