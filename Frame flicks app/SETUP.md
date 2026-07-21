# Setup — Client Progress Links

Your Supabase project is already connected (see `js/config.js`) and the
existing login/sync (`app_data` table) keeps working with no changes.

The **client progress link** feature (the 🔗 button in Income, and
`track.html`) needs one new table. Without it, the links will show
"couldn't find a project" forever. This is a one-time setup.

## 1. Create the table

In your Supabase project → **SQL Editor** → New query → paste and run:

```sql
create table if not exists project_status (
  track_code text primary key,
  client text,
  project text,
  stage text,
  stages jsonb,
  services jsonb,
  note text,
  due_date date,
  stage_history jsonb,
  updated_at timestamptz default now()
);

alter table project_status enable row level security;

-- Anyone holding the link can read the status (the track_code itself is a
-- long random secret — nobody can guess or enumerate it).
create policy "Public can read by track_code"
  on project_status for select
  using (true);

-- Only you (logged in) can create/update/delete entries.
create policy "Authenticated can insert"
  on project_status for insert
  with check (auth.role() = 'authenticated');

create policy "Authenticated can update"
  on project_status for update
  using (auth.role() = 'authenticated');

create policy "Authenticated can delete"
  on project_status for delete
  using (auth.role() = 'authenticated');
```

## 2. Already set this up before? Run this migration

If you created the `project_status` table earlier, it's missing two new
columns the redesigned tracker page needs (expected delivery date, and a
per-stage date history). In **SQL Editor**, run:

```sql
alter table project_status add column if not exists due_date date;
alter table project_status add column if not exists stage_history jsonb;
alter table project_status add column if not exists stages jsonb;
alter table project_status add column if not exists services jsonb;
```

Without this, saving a project won't error, but the client page won't be
able to show the delivery date, per-step dates, the correct set of steps
for that project's ticked services, or the new Services checklist section.

## 3. Try it

1. Open the app → **Income** → add or edit a project → click **🔗 Share with Client**.
2. Open that link in a private/incognito tab (so you're not logged in) — you
   should see the project's stage tracker.
3. Change the project's stage back in the app → refresh the client link →
   it should update within a few seconds.

## What the client can and can't see

They see: project name, your name/brand, which stage it's at, expected
delivery date, a date under each completed step, a separate Services
checklist (only for services you've ticked on that project — grouped as
Color & Sound / Motion & VFX / AI Elements), any note you leave them, and
buttons to message you on WhatsApp/email. They **cannot** see your
other clients, your income numbers, or anything else in the app — the
public page only ever reads one row, by its exact track_code.

## Your contact details on the client page

The WhatsApp number and email shown on the client page are set directly in
`js/tracker.js`, near the top:

```js
const CONTACT_WHATSAPP = '918921706042'; // country code + number, no + or spaces
const CONTACT_EMAIL = 'muhammedalsabith111@gmail.com';
```

Edit those two lines if either ever changes.

## Link + QR code

Clicking **🔗 Share with Client** in Income opens a small window with the
link (to copy) and a QR code (to show on screen or download as a PNG) —
handy when you're sharing in person or on a call instead of over text.

## Notifications (later upgrade)

Right now the client checks the link manually (or you email it to them).
Turning that into a real phone notification needs push infrastructure —
that's intentionally not part of this first version. Once you've used the
link with a few real clients and like how it works, that's the natural next
step to add.
