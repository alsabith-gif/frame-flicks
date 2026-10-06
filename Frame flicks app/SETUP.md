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

## Push notifications (calendar reminders)

One-time setup, about 10 minutes:

1. **Keys** — run `npx web-push generate-vapid-keys`. Paste the *public* key into `VAPID_PUBLIC_KEY` in `js/config.js`.
2. **Tables** — Supabase → SQL Editor → run `supabase/push-setup.sql` (first part only, up to the cron section).
3. **Function** — deploy `supabase/functions/send-reminders` (`supabase functions deploy send-reminders`), then set secrets:
   `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@email.com CRON_SECRET=<any long random text>`
4. **Schedule** — Database → Extensions: enable `pg_cron` and `pg_net`. Run the `cron.schedule` part of `push-setup.sql`, replacing `YOUR_CRON_SECRET` with the same text as above. It checks every minute.
5. **Phone** — deploy the app over HTTPS. On iPhone: Safari → Share → Add to Home Screen, open it from the icon, then Settings → Notifications → turn on and tap *Send test notification*.

In Settings → Notifications you choose, per event type (Shoot days ⭐, Deadlines, Payments, Meetings), whether it notifies, the day-before time, the same-day time, and a "before start time" reminder. Add shoot days from Calendar → + Add Event (Shoot day) or the new Shoot Date field on each project.

## Invoice Maker & Price Distributor

Defaults come from the 2026 pricing PDF. Use **Edit prices** on the Invoice page to change any price, delivery % or your business/UPI details. Distribution percentages are edited directly on the Price Distributor page. Both are saved and synced.


---

# Worker system — setup, in the order you must do it

Each phase adds steps below. Do them in order. All SQL lives in
`supabase/worker-setup.sql`; run it one **PART** at a time.

## Phase 1 — roles and lockdown

> ⚠️ Do steps 1–3 **before** you upload the new app files. The new app checks
> your role on every sign-in; if the table doesn't exist yet it shows
> "Setup not finished" instead of opening.

1. **Find your login email.** Supabase → SQL Editor → run
   `select id, email from auth.users;` and note the email you log in to Frame Flicks with.
2. **Run PART 1A** of `supabase/worker-setup.sql`. First replace
   `YOUR_ADMIN_LOGIN_EMAIL` with that email. The last query must show **one row,
   role = admin**. If it shows nothing, the email was wrong — fix it and run 1A again.
3. **Run PART 1B.** It refuses to run (and changes nothing) unless an active admin
   exists, so you cannot lock yourself out. After it runs, only admins can read or
   write `app_data`, `profiles` and `project_status`.
4. **Upload the new app files** (everything in this zip that changed:
   `index.html`, `js/cloud.js`, `js/bootstrap.js`, `js/tracker.js`).
5. **Check your own login** (see "Phase 1 checks" below).
6. **Run PART 1C** — only after step 5 *and* after opening a client link
   (`track.html?p=…`) in a private window to confirm it still loads. 1C stops
   the public from being able to list every client project; the tracker page
   keeps working because it now asks for one project by its exact code.

### Phase 1 checks
- Log in as yourself: the app opens, Prospects/Income/etc. all show your data.
- Settings → Log out → log back in: works; your data comes back.
- Open a client progress link in a private window: loads normally (before and after 1C).
- Supabase → Table editor → `profiles`: one row, you, `admin`.

### What changed in the app
- **Roles:** after sign-in the app reads your row in `profiles`. Admin → app as before.
  Worker → a holding screen for now (the real worker app arrives in Phase 3).
  No profile → "No access yet". Deactivated → signed out with a message.
- **Shared devices:** the app remembers whose data is cached on a device. If a
  different person or role signs in, all cached `ve_ct_*` data (and Face ID setup)
  is wiped first. Logging out wipes cached business data but keeps *your* Face ID
  setup, so you don't have to redo it each time.
- **Workers never touch `app_data`:** the browser code refuses to pull or push it for
  any non-admin, and the database refuses too.
- **Logout** also stops push notifications for that device.

### How to tell which version is live
Open the login screen (or Settings → About). A small grey line shows the
version, for example `Phase 1 · roles & lockdown · build 1`. **If there is no
version line at all, the old files are still live** — the new upload did not
take effect. Each phase changes this line, so you can always confirm an
upload worked before moving on.


---

## Phase 2 — worker accounts and email-code login

What you get: a **Workers** page (Clients mode → 👷 Workers) where you add a
worker by name + email + role (Camera / Editor). They get an email with a
6-digit code, type it in, choose their own password, and are offered Face ID.
After that they log in with email + password. You can deactivate, reactivate,
send a new code, or reset a worker's access at any time.

Workers still see only a "welcome" screen after logging in. Their jobs, calendar
and earnings arrive in Phases 3–5.

> Do the steps in this order. Steps 2–4 are about email — without them, workers
> cannot receive their code.

### 1. Run PART 2 of `supabase/worker-setup.sql`
Supabase → SQL Editor → new query → paste from the **PART 2** heading to the end
of the file → Run (click **Run query** if a warning box appears).
At the bottom you should see a table with your own row (role = admin) and no red error.
It adds a job role (camera/editor) to profiles, stops two accounts sharing one
email, and adds the "sign out everywhere" helper that only the server can use.

### 2. Stop people signing themselves up
Supabase → **Authentication** → **Sign In / Providers** (on some screens: **Providers**
or **Settings**) → find **"Allow new users to sign up"** → turn it **OFF** → Save.
This is what makes "workers cannot sign up on their own" true. Accounts you add
from the Workers page still work, because the server creates them for you.

### 3. Connect a mailbox (required — workers get no email without it)
Supabase's built-in email sender only delivers to people on your own Supabase
team, so real workers would never get their code. Set up your own sender (free):

**Easiest — use your Gmail**
1. Google Account → Security → turn on **2-Step Verification**.
2. Open https://myaccount.google.com/apppasswords → create an app password
   called "Frame Flicks" → copy the 16 letters.
3. Supabase → **Authentication** → **Emails** (or **SMTP Settings**) →
   **Enable custom SMTP**, then fill in:
   - Sender email: your Gmail address
   - Sender name: `Frame Flicks`
   - Host: `smtp.gmail.com`
   - Port: `465`
   - Username: your Gmail address
   - Password: the 16-letter app password (not your normal Gmail password)
4. Save. (Gmail allows about 500 emails a day — far more than you need.)

Supabase starts custom SMTP at 30 emails per hour. That is plenty. If you ever
see "email rate limit exceeded", wait a bit, or raise it under
Authentication → Rate Limits.

### 4. Make the email show the 6-digit code
Supabase → **Authentication** → **Email Templates** → **Magic Link**.
Set the subject to `Your Frame Flicks login code` and replace the body with:

```html
<h2>Your Frame Flicks login code</h2>
<p>Type this code into the app:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:bold">{{ .Token }}</p>
<p>It stops working after an hour. If you didn't ask for it, ignore this email.</p>
```
`{{ .Token }}` is the 6-digit code. Save. (If you see an "Email OTP length"
setting under the Email provider, keep it at **6**.)

### 5. Deploy the worker function
This small server program creates worker accounts. It uses a powerful key that
must never be inside the app — Supabase gives it to the function by itself, so
**you do not copy or paste any key**.
1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name it exactly: `admin-create-worker`
3. Delete the sample code and paste in the whole of
   `supabase/functions/admin-create-worker/index.ts`. Click **Deploy**.
4. Open the function's settings and turn **Verify JWT** **OFF**, then save.
   (The function checks for itself that you are the logged-in admin. Turning
   this off only avoids a Supabase key-format mismatch.)
   Command-line alternative: `supabase functions deploy admin-create-worker --no-verify-jwt`

### 6. Upload the new app files (GitHub, same as before)
Unzip, open the folder until you are inside **Frame flicks app**, and upload
everything inside it to the folder on GitHub that already has `index.html`.
Wait 1–2 minutes, then hard-refresh (Ctrl + Shift + R). The login screen should
show **Phase 2 · worker accounts · build 2**. If it still says Phase 1, the
upload did not take effect.

### 7. Test it end to end (use a second email address that you own)
1. In the app: **Workers → + Add Worker** → your second email → Add.
   You should see "Worker added — code emailed". Check that inbox (and spam).
2. Open a **private window** (Ctrl + Shift + N), open the app, tap
   **"First time here, or forgot your password?"**, enter that email, then the code.
3. Choose a password → you are offered Face ID (tap **Not now**) → you see "Hi <name>".
4. Log out, then log in with that email + password. It works.
5. Back in your admin window, Workers shows "Last logged in <today>".
6. Tap **Deactivate** on that worker → in the private window they are signed out
   and cannot log in again ("deactivated"). **Reactivate** brings them back.
7. **Reset access** → their old password stops working and they get a new code.

### If something goes wrong
| You see | What it means / what to do |
|---|---|
| "The worker function is not deployed yet" | Step 5 not done, or the name is not exactly `admin-create-worker`. |
| "The function rejected the login" | Step 5.4: turn **Verify JWT** off. |
| "Admins only" | You are logged in as a worker, not as the admin. |
| Worker added but "code email could not be sent" | Steps 3–4 not finished or wrong app password. Fix, then tap **Send new code**. |
| No email arrives | Check spam. Check Supabase → Logs → Auth for the reason. Make sure step 3 is saved. |
| "Please wait 60 seconds…" | Supabase allows one code per minute per person. Wait, then resend. |
| "That code is wrong or has expired" | Ask for a new code; use only the newest one. |
| "That email already has an account" | That email is already a worker or your admin login. |
| "Setup not finished" on login | Step 1 (or Phase 1 SQL) was not run. |

### Forgot your own admin password?
The same **"First time here, or forgot your password?"** link works for you too:
enter your admin email, type the code, and choose a new password.

### What changed in the app (Phase 2)
- **Login:** new "get a code" path (6-digit email code → choose a password → optional Face ID).
  Codes can never create an account; only people you added can get one. The screen gives the
  same answer for unknown emails so nobody can discover who works with you.
- **Password step cannot be skipped** — even if the worker closes the app and comes back.
- **Workers page (admin only):** add, edit name/role, send new code, reset access,
  deactivate / reactivate, last-login time.
- **Deactivate** blocks the account itself, signs them out of every device, and the
  database stops honouring them immediately.
- **New server function** `admin-create-worker` — the only place worker accounts are
  created or changed. It checks the caller is an active admin on every request.


---

## Phase 3 — give jobs to workers + the worker's "My Work" screen

What you get:
- **Admin:** in every project (Add Project / Edit), a new **👷 Assign crew** box. Pick
  the worker(s), their role and their pay. The app suggests the pay from your Price
  Distributor (labour share split between the camera crew, editing share to the editor);
  you can type over it any time. You also set the **location**, **shoot time** and
  **notes for the crew** (the crew can see these — your private Notes are never shared).
- **Worker (phone):** after login they now get their own light app with two tabs,
  **My Work** (Overdue / Today / Upcoming / Done) and **Settings** (Face ID, change
  password, log out). Jobs appear by themselves when they open the app again.
- Workers can only READ. They cannot add, change or delete anything.

### 1. Run PART 3 of `supabase/worker-setup.sql`
Supabase → SQL Editor → new query → paste from the **PART 3** heading to the end of the
file → Run (click **Run query** if a warning appears; if it offers "Run and enable RLS",
choose that). At the bottom you must see **exactly two** lines:
`worker_tasks: admin all` and `worker_tasks: worker reads own`.
(Nothing else is needed on Supabase for this phase: no new function, no new key.)

### 2. Upload the new app files (GitHub, same as before)
Unzip, go inside **Frame flicks app**, upload everything inside to the GitHub folder that
has `index.html`. Changed/new this time: `index.html`, `css/income.css`, `css/worker.css`,
`js/bootstrap.js`, `js/crew.js`, `js/crewForm.js`, `js/version.js`, `js/pages/income.js`,
`js/pages/invoice.js`, `js/pages/workers.js`, the whole `js/worker/` folder, and
`supabase/worker-setup.sql`. Wait 2 minutes, hard-refresh (Ctrl + Shift + R).
The login screen must say **Phase 3 · assign crew & My Work · build 3**.

### 3. Test it (use the worker account you already made)
1. **Admin:** Dashboard → **+ Add Project** (or ⋮ → Edit on a project). Fill client, project,
   amount, shoot date, deadline.
2. In **👷 Assign crew** tap **+ Add crew member** → pick your test worker → the role and a
   suggested pay appear → type a location and shoot time → **Save**.
   You should see "Project added · crew updated".
3. **Worker phone:** open the app (or switch back to it). The job appears under
   Today / Upcoming with the title, client name, place, date, time and deadline.
   Check that you can NOT see: the client's phone number, the project price, or any pay.
4. **Admin:** edit the project, change the pay or the shoot time, Save → the phone shows the
   new time the next time the app is opened. Nothing is re-sent if you Save without changes.
5. **Admin:** edit the project, remove the worker (✕), Save → the job disappears from the phone.
6. **Admin:** delete a project that has crew → its job disappears from the phone.
7. **Admin:** Deactivate the worker → within about a minute the phone is signed out.
   Reactivate to carry on.

### If something goes wrong
| You see | What it means / what to do |
|---|---|
| "Crew can't be changed right now" in the form | The app could not reach the server. Check internet, close and reopen the form. Your project can still be saved. |
| "Project saved, but the crew could not be saved… Press Save again" | Offline or server hiccup. The project IS saved. Press **Save** again — it will not make a duplicate. |
| "Not deleted — couldn't remove the crew's jobs" | Offline. The project was kept so no job is left on a phone. Try again online. |
| "Crew not updated… Open the project and press Save to retry" | The Invoice Maker changed a name/date but could not tell the workers. Open the project → Save. |
| Worker sees "No jobs yet" | Nothing assigned yet, or the worker was deactivated (they are signed out soon after). |
| "Setup not finished" / table error when assigning | PART 3 was not run (step 1). |

### What changed (Phase 3)
- New database table `worker_tasks` (one row per worker per project). It holds only: title,
  client NAME, location, shoot date/time, deadline, notes, role, status and that worker's pay.
  It never holds the client's phone number or the project price.
- Database rules: admin can do everything; a worker can only READ their own rows, and only
  while active. A deactivated worker sees nothing. No worker can insert, change or delete.
- Saving a project only writes the rows that really changed, and never resets a worker's
  progress or paid mark. Deleting a project removes its crew jobs first.
- The Invoice Maker now also updates the crew's copy when it changes a project's name,
  client or shoot date.
- A worker who is deactivated while the app is open is signed out on the next refresh.
