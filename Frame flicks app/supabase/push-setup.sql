-- Push notifications — one-time setup. Run in Supabase → SQL Editor.

create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid(),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz default now()
);

create table if not exists push_reminders (
  id text primary key,
  user_id uuid not null default auth.uid(),
  type text,
  fire_at timestamptz not null,
  title text not null,
  body text,
  url text,
  tag text,
  sent boolean not null default false,
  created_at timestamptz default now()
);
create index if not exists push_reminders_due on push_reminders (sent, fire_at);

alter table push_subscriptions enable row level security;
alter table push_reminders enable row level security;

create policy "own subscriptions" on push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own reminders" on push_reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Schedule: ask the function to send due reminders every minute.
-- 1) Replace YOUR_CRON_SECRET below with the same value you set as the
--    CRON_SECRET secret (see SETUP.md).
-- 2) Enable the pg_cron and pg_net extensions first (Database → Extensions).
-- ---------------------------------------------------------------------
select cron.schedule(
  'send-push-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://vkuvdmqtlkrlanrzkfdz.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR_CRON_SECRET'),
    body := '{}'::jsonb
  );
  $$
);
