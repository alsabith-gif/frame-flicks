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

Notifications are now set up by **Phase 6** (further down this file). Ignore the old command-line steps
and do not run `supabase/push-setup.sql` any more — PART 6A and PART 6B of `supabase/worker-setup.sql`
replace it.

In Settings → Notifications (admin) you still choose, per event type (Shoot days, Deadlines, Payments,
Meetings), whether it notifies, the day-before time, the same-day time, and a "before start time" reminder.

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


---

## Phase 4 — workers change job status, My Calendar, and your crew overview

What you get:
- **Worker (phone):** every job card now has three buttons — **To do / In progress / Done**.
  Tapping one changes the job at once. If the internet is off, or the server says no, the
  card goes back and says why (for example *"You need internet to change status."*).
  A new **My Calendar** tab shows their own jobs in a month grid: **shoot days** are the
  main marks, **deadlines** are smaller marks. Tap a day to see its jobs. It is read-only —
  nothing can be added, edited, moved or deleted there.
- **Admin:** on the **Workers** page each worker card now shows how many jobs are
  To do / In progress / Done and how many are **overdue**, plus their last finished job.
  Below the cards, a **Crew jobs** list shows every crew job with filters (worker, status,
  overdue / upcoming / marked done recently). When a worker marks a job Done you see
  *"Asha marked this done on 8 Oct, 3:20 pm"*, with a green **New ✓** for the first 48 hours.
  The page refreshes when you come back to the app, or tap **↻ Refresh**.
- The worker's tabs are **My Work · My Calendar · Settings** (Phase 5 adds **My Earnings**).

### 1. Run PART 4 of `supabase/worker-setup.sql`
Supabase → SQL Editor → new query → paste from the **PART 4** heading to the end of the
file → Run (click **Run query** if a warning appears). At the bottom you must see:
- one line: `worker_set_status`
- the **same two** policies as before: `worker_tasks: admin all` and `worker_tasks: worker reads own`.
  (There must still be **no** policy that lets a worker write — status changes go only through
  the `worker_set_status` function, which changes the status and nothing else.)

It is safe to run twice. **Do this before step 2** — if you upload the app first, the Workers
page will say it needs PART 4 and status buttons will show an error until you run it.

### 2. Upload the new app files (GitHub, same as before)
Unzip, go inside **Frame flicks app**, upload everything inside to the GitHub folder that has
`index.html`. Changed/new this time: `css/worker.css`, `css/workers.css`, `js/version.js`,
`js/crewOverview.js` (new), `js/pages/workers.js`, `pages/workers.html`, the `js/worker/`
folder (`workerApp.js`, `workerCalendar.js` (new), `workerData.js`, `workerView.js`,
`myWork.js`), `SETUP.md` and `supabase/worker-setup.sql`. Wait 2 minutes, hard-refresh.
The login screen must say **Phase 4 · job status, calendar & crew overview · build 4**.

### 3. Test it (use your test worker and a project you assigned in Phase 3)
1. **Worker phone:** My Work → on a job tap **In progress**. The button turns blue straight away.
2. **Admin:** Workers page → tap **↻ Refresh**. The worker's card shows *In progress 1*, and the
   job in **Crew jobs** shows the *In progress* badge.
3. **Worker:** tap **Done**. The job moves into the **Done** section.
   **Admin:** refresh → the job says *"… marked this done on …"* with **New ✓**, and the worker's
   card shows *Last marked done: …*.
4. **Worker:** tap **To do** on that finished job → it comes out of Done; the admin's line disappears
   on refresh.
5. **Worker:** switch the phone to airplane mode and tap a status button → the card says
   *"You need internet to change status."* and nothing changes. Turn the internet back on.
6. **Worker:** open **My Calendar**. The job's shoot day has an orange mark and its deadline a
   small blue mark. Tap the day → the job appears with its status. Try to find anything to
   edit — there is nothing.
7. **Admin:** edit the project and Save (change nothing about the crew). The worker's status
   must **not** go back to To do.
8. **Admin:** make a job overdue (shoot date in the past, not Done) → the worker's card shows
   a red **overdue** count, and **Crew jobs → Overdue** lists it.

### Rules worth knowing
- A worker can change **only the status** of **their own** job. They cannot change dates, notes, pay, or
  anyone else's job — the database refuses, not just the screen.
- **Closed jobs:** once a job is marked paid (Phase 5 adds this button), the worker can no longer move it
  back out of Done, so your pay record can never point at an unfinished job. Their screen says only
  *"Closed — ask the admin if this job needs to be re-opened."* (no mention of money). You can
  always change it yourself.
- Deactivated workers can't change anything, and see nothing.
- The time a job was marked Done is saved (`done_at`) — Phase 5's monthly earnings use it.
  Jobs that were already Done before this phase get their last-changed time as a best guess.

### If something goes wrong
| You see | What it means / what to do |
|---|---|
| Worker: *"Could not change the status. Please try again."* | A temporary server problem. Tap the button again. If it keeps happening, PART 4 was probably not run (step 1). |
| Worker: *"You need internet to change status."* | No connection. Nothing was changed. Try again when online. |
| Worker: *"This job is no longer on your list."* | You removed the job from the project while they had it open. The list refreshes by itself. |
| Admin Workers page: *"The database needs PART 4…"* | Run PART 4 (step 1), then tap **↻ Refresh**. |
| Admin Workers page: *"The worker jobs table is missing…"* | PART 3 was not run. Run PART 3, then PART 4. |
| Worker's card on the admin page says *No jobs assigned* | Nothing assigned yet — assign crew from a project (Phase 3). |

### What changed (Phase 4)
- Database: new column `worker_tasks.done_at`, and the function `worker_set_status` (PART 4). No new
  permissions for workers on the table itself.
- Worker app: status buttons on My Work, new read-only My Calendar tab, status messages that survive a
  background refresh, and a guard so a refresh in the middle of saving never flips a card back.
- Admin: per-worker status summary, overdue counts, the Crew jobs list with filters, and "marked done" lines.
- The admin query for crew jobs deliberately does not ask for pay (the earnings view arrives in Phase 5).


---

## Phase 5 — earnings, paying your crew, and protecting pay history

What you get:
- **Worker (phone):** a new **My Earnings** tab (💰). Four numbers: **Jobs completed**, **Earned**,
  **Paid** and **Still owed**, plus a **By month** list (tap a month to see its jobs and what is paid
  or not). A worker sees **only their own** numbers. Pay appears on this tab and nowhere else.
- **Admin → Workers page:**
  - every worker card shows **Earned / Paid / Still owed**;
  - **Mark all owed as paid (n)** on a worker's card — one paid date for all of them;
  - in **Crew jobs**, every job shows its pay, with **Mark paid** (for a finished job) or **Undo paid**;
  - a new **Any payment** filter (Still owed / Paid), and **"Still owed to crew: ₹…"** at the top of the list.
- **Pay history is protected.** Once a job is marked paid, its pay amount is **locked**. Re-saving the
  project can no longer change it.

**What the words mean** (same everywhere):
- **Earned** = pay of jobs the worker marked **Done**.
- **Paid** = those jobs that you marked paid.
- **Still owed** = Done jobs not paid yet. So Earned = Paid + Still owed, always.
- A job can be marked paid **only after it is Done**.

### 1. Run PART 5 of `supabase/worker-setup.sql`
Easiest: open the separate file **`phase5-part5.sql`**, copy everything in it.
Supabase → **SQL Editor** → **New query** → paste → **Run** (click **Run query** if a warning appears).
At the bottom you must see:
- a table with **`worker_tasks_pay_guard`** and **`worker_tasks_touch`**
- the **same two** policies as before: `worker_tasks: admin all` and `worker_tasks: worker reads own`.

Safe to run twice. **Do this before step 2.**

### 2. Upload the new app files (GitHub, same as before)
Changed/new this time: `css/income.css`, `css/worker.css`, `css/workers.css`, `js/crew.js`, `js/crewForm.js`,
`js/crewOverview.js`, `js/pay.js` (new), `js/version.js`, `js/pages/income.js`, `js/pages/workers.js`,
`pages/workers.html`, `js/worker/workerApp.js`, `js/worker/earningsCalc.js` (new),
`js/worker/myEarnings.js` (new), `SETUP.md` and `supabase/worker-setup.sql`.
Wait 2 minutes, hard-refresh (Ctrl + Shift + R). The login screen must say
**Phase 5 · earnings & pay tracking · build 5**.

### 3. Test it (use your test worker and the project you assigned earlier)
1. **Worker phone:** open **My Earnings** — before any job is Done it says *"Nothing earned yet"*.
2. **Worker:** on My Work, mark a job **Done**. Open **My Earnings**: *Jobs completed 1*, *Earned* = the pay
   you set, *Paid ₹0*, *Still owed* = the same amount.
3. **Admin:** Workers page → tap **↻ Refresh**. The worker's card shows *Earned ₹… · Paid ₹0 · Still owed ₹…*.
4. **Admin:** in **Crew jobs**, that job shows **Mark paid**. Tap it → a popup with the amount and a date
   (today). Tap **Mark paid**. The job now says *Paid on …* with **Undo paid**.
5. **Worker:** pull the **↻** button. **My Earnings** shows *Paid* = the amount and *Still owed ₹0*.
6. **Admin:** **Undo paid** → confirm → it goes back to *Not paid yet*. Worker's screen follows after a refresh.
7. **Pay lock:** mark the job paid again. Open the project (Dashboard → ⋮ → Edit). In **Assign crew**, that
   worker's pay box is **greyed out** with *"🔒 Paid — locked"* and a note. Change something else (for
   example the notes) and Save — it works, and the pay stays the same.
8. **Change a paid amount (the proper way):** Workers → **Undo paid** → edit the project and change the pay →
   Save → Workers → **Mark paid** again.
9. **Mark all owed:** finish two jobs as the worker, then on the worker's card tap **Mark all owed as paid (2)**
   → pick a date → both become paid with the same date.
10. **Delete warning:** delete a project whose crew job is paid. After the first "are you sure", a second
    message says *"…already marked PAID. Deleting the project also deletes those pay records. Delete anyway?"*
    Choose **Cancel** to keep it.

### Rules worth knowing
- **Nobody but you can mark anything paid.** A worker cannot mark paid, change a pay amount, or see another
  worker's earnings. The database refuses — not just the screen.
- **Paid jobs are closed for the worker.** After you mark a job paid, the worker can no longer move it out of
  Done (their screen just says *"Closed"*, nothing about money).
- **Repeating is safe.** Pressing **Mark paid** twice, or having two windows open, never changes a date or
  counts a payment twice. If a worker re-opened a job just before you pressed the button, that job is
  skipped and you are told.
- **Months:** a finished job counts in the month it was marked **Done**, by **India time**. Jobs finished
  before Phase 4 have no "done" time, so they use the **shoot date** (then the deadline). Jobs with no date
  at all sit under **No date**.
- **Deleting a project deletes its crew jobs, paid ones too.** That is why the extra warning exists. If you
  want to keep pay history for a project you no longer need, don't delete it — change its status instead.
- A deactivated worker's money still shows on their card, so you can still pay what you owe them.

### If something goes wrong
| You see | What it means / what to do |
|---|---|
| Popup says *"Only a job that is Done can be marked paid."* | The worker has not marked it Done (or re-opened it). Wait for them, then try again. |
| Popup says *"…Nothing was changed — those jobs are no longer Done, or were already paid"* | Someone changed it just before you. The list refreshed; look at it and try again. |
| Saving a project says *"This job is already paid, so its pay amount is locked"* | You have an old copy of the app open. Hard-refresh (Ctrl + Shift + R). The pay box will be locked. Use **Undo paid** first if the amount really must change. |
| Pay box is greyed out with 🔒 | That job is paid. See step 8 above. |
| Workers page shows *"The database needs PART 4…"* or a table error | Run PART 4 and PART 5 (see above), then tap **↻ Refresh**. |
| Popup says *"No connection to the server"* | Offline. Nothing was changed. Try again when online. |
| Worker's **My Earnings** looks out of date | They need to tap **↻** (or reopen the app). It also refreshes by itself every minute. |
| Worker says a number is wrong | Open **Crew jobs**, filter by that worker, and compare. Only **Done** jobs count as earned. |

### What changed (Phase 5)
- Database (PART 5): one safety trigger on `worker_tasks`. It refuses to mark a not-Done job paid, locks the pay
  amount of a paid job, always gives a paid job a paid date (today, India time, if none is given) and clears the
  date when you undo. No new permissions: workers still cannot write to the table.
- Worker app: **My Earnings** tab (money rules in `js/worker/earningsCalc.js`, adds up in paise so there are no
  rounding errors).
- Admin: earnings per worker, mark paid / undo / mark all owed, Any-payment filter, crew-wide total,
  locked pay boxes in the project form, delete warning for paid crew jobs.
- The money rules are in one file and used by both screens, so the worker and admin always agree.


---

## Phase 6 — notifications for workers (and a proper setup for yours)

What you get: a worker's phone buzzes the evening before a shoot and 1 hour before it, the evening before a
deadline and on the day, and whenever you add, change or remove one of their jobs. You get your own calendar
reminders as before. A notification **never** shows pay, a client's phone number or a project price.
Times are India time. If you deactivate a worker, they stop getting notifications at once.

This phase has more steps than the others, because notifications need a "sender" running in Supabase.
Do them **in this order**. Nothing in your app breaks if you stop half way — notifications just stay off.

### 1. Run PART 6A
Supabase → **SQL Editor** → **New query** → paste the whole of `phase6-part6a.sql` (or the PART 6A section of
`supabase/worker-setup.sql`) → **Run**. The last table it shows should list four rows (policies) and no error.
Safe to run twice.

### 2. Make your two notification keys
1. On your computer, unzip the app folder and **double-click `vapid-keys.html`**. It opens in Chrome.
2. Click **Make my keys**. Two long lines of text appear: a *public* key and a *private* key.
3. Keep this page open. (It works only on your computer; nothing is sent anywhere.)
4. The **private** key is a secret. Never put it in the app files, a chat or an email.
5. Make the keys **once**. If you ever make new ones, every phone must turn notifications on again.

### 3. Save four secrets in Supabase
Supabase → **Edge Functions** → **Secrets** (in some versions: **Edge Functions → Manage secrets**).
Click **Add new secret** for each of these (name on the left exactly as written, value on the right):

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | the public key from step 2 |
| `VAPID_PRIVATE_KEY` | the private key from step 2 |
| `VAPID_SUBJECT` | the word `mailto:` followed by **your own email**, e.g. `mailto:you@example.com` (no space) |
| `CRON_SECRET` | any long made-up text (30+ letters and numbers, no spaces). Write it down — you need it again in step 6 |

Click **Save** after adding them.

### 4. Deploy the sender function
Same as you did for the worker function in Phase 2, step 5:
1. **Edge Functions** → **Deploy a new function** → **Via Editor**. Name it exactly `send-reminders`.
   (If a function with this name already exists, open it instead and replace its code.)
2. Delete the sample code, paste the whole of `supabase/functions/send-reminders/index.ts`, click **Deploy**.
3. Open the function's settings and turn **Verify JWT** **OFF**, then save. (The sender checks the secret
   itself; the every-minute call has no login.)

### 5. Turn on the two helpers
Supabase → **Database** → **Extensions** → search **pg_cron** → switch it on. Search **pg_net** → switch it on.

### 6. Run PART 6B (starts the every-minute sender)
1. Open `phase6-part6b.sql` in Notepad (or the PART 6B section of `worker-setup.sql`).
2. Replace `YOUR_CRON_SECRET` with the **same** text you saved as `CRON_SECRET`. Keep the quote marks around it.
3. Supabase → **SQL Editor** → paste → **Run**. The last result must show one row with `active = true`.
   Safe to run twice (it replaces the old schedule).

### 7. Upload the new app files (GitHub, same as before)
Upload the files from the zip(s) over the old ones. Wait for Cloudflare to finish, then hard-refresh
(**Ctrl + Shift + R**). The login screen should say **Phase 6 · notifications**.

### 8. Test it
**Your own phone/browser first (admin):**
1. Log in as admin → **Settings** → Notifications → turn on → allow when asked → **Send test notification**.
   A notification should appear within a few seconds.

**A worker (use your test worker's phone):**
1. Android: open the app in Chrome and log in as the worker. **iPhone:** open the site in Safari → **Share** →
   **Add to Home Screen** → open **Frame Flicks from the Home Screen icon** (this is required by Apple) and log in.
2. **Settings** → **Notifications** → **Turn on notifications on this phone** → tap **Allow**.
3. Tap **Send me a test**. It should arrive within a few seconds.
4. As admin, assign that worker a new job (or change the date of one). Within about a minute the worker's phone
   shows **New job for you** / **Job updated**. Tap it: the app opens on **My Work**.
5. In the worker's Settings, switch **Job changes** off, change the job again as admin → **no** notification.
6. Deactivate the test worker on the Workers page, change their job → **no** notification. Reactivate them after.
7. Check that no notification ever shows a pay amount, phone number or price.

### If something goes wrong
| What you see | What to do |
|---|---|
| Turn-on button says "not set up on the server" | Steps 3 and 4: the four secrets saved, function deployed. Then try again. |
| "Could not save this device" | Run PART 6A (step 1). |
| Test says "no device registered" | Turn notifications on for that phone first (step 8). |
| Test works but real reminders never come | Step 5 (extensions on) and step 6 (secret text identical to `CRON_SECRET`). In SQL Editor run `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;` — it should show `succeeded` every minute. Also check Edge Functions → send-reminders → **Logs**. |
| Logs say "forbidden" (403) | The text in PART 6B is not the same as `CRON_SECRET`. Fix it and run PART 6B again. |
| Logs say "VAPID keys are not saved yet" / "not valid" | Step 3: re-paste the keys with no spaces or quotes; `VAPID_SUBJECT` must start with `mailto:`. |
| iPhone shows "Add to Home Screen" instead of a button | Open the app from the Home Screen icon, not Safari. Needs iOS 16.4 or newer. |
| "Notifications are blocked" | Phone Settings → Notifications → Frame Flicks (or Chrome → site settings) → Allow. |
| A worker got nothing after being re-activated | They must tap **Turn on notifications on this phone** again (their old phone is forgotten when deactivated). |
| Everything stopped after you made new keys | Every phone must turn notifications off and on again. |

### What changed (Phase 6)
- Database (PART 6A): tables for registered phones, waiting notifications and each worker's choices, all private
  per person (a worker sees only their own; only the admin app writes the admin's reminders). The database itself
  builds a worker's reminders and alerts, removes them when a job is done, deleted or the worker is deactivated,
  and never puts pay, client phone or price into any text. PART 6B starts the every-minute sender.
- Sender function (`send-reminders`): claims each notification before sending (no double sends), skips anyone
  deactivated, only opens pages inside the app, forgets phones that have expired.
- Worker app: **Settings → Notifications** (turn on for this phone, three choices, test, turn off), and tapping a
  notification opens the right screen.
- `vapid-keys.html`: makes your keys on your own computer. The public key is now served by the function, so you
  no longer paste anything into `js/config.js`.
- `supabase/push-setup.sql` is now just a note: do not run it.

### What could not be tested here (please check by hand — step 8)
The database, the sender function, the encryption and the worker screens were tested with simulated accounts,
a real database and a fake phone. A real notification reaching a real phone through Google/Apple could **not** be
tested from here, so step 8 is the real proof. Notification delivery on iPhone also depends on Apple's rules
(Home Screen app, iOS 16.4+).


---

## Final step — the security proof (run this once, then keep it)

This proves, with real tests, that a **worker account** can only do what a worker is meant to do. You run
**two things**: a script in Supabase (5 minutes) and a checklist with two browser windows (15 minutes).

### What a worker must NOT be able to do
1. Read, add, change or delete anything in your business data (`app_data`: income, prospects, pricing, invoices, client phone numbers, project prices).
2. See another worker's jobs or pay, or create / edit / delete any job.
3. Change the status of someone else's job, or change any pay or paid field at all.
4. See other people's accounts, or make themselves admin / re-activate themselves.
5. Read or change your client progress links (`project_status`) directly.
6. Call the admin functions (create a worker, sign someone out, trigger notifications).
7. See any admin screen or admin data in the browser — the admin app code is never even downloaded for a worker.
8. Keep any access after being deactivated (jobs vanish, status changes refused, sign-in refused, notifications stop, phone forgotten).
9. Receive a notification that contains pay, a client phone number, a price or your private notes.

### 1. Run PART 7 (one small extra lock)
Supabase → **SQL Editor** → **New query** → paste the whole of `phase7-part7.sql` → **Run**.
(A deactivated worker could still add a phone to their own list. Harmless, but now the database refuses it too.)

### 2. Run the proof script
Supabase → **SQL Editor** → **New query** → paste the whole of `supabase/worker-tests.sql` → **Run**.
It makes four pretend people (emails ending `@wt-test.invalid`), tries to break the rules as each of them, and
**deletes everything it made**. It never touches your real data. Safe to run again any time (for example after
every future update).

At the bottom you get a list. **The first line must say `ALL … CHECKS PASSED`** and every line must say **PASS**.
If any line says FAIL, send me a screenshot of that line. Do not use workers for real until it is fixed.

### 3. The checklist with real accounts (admin window + private window)
You need: your admin login, one test worker (a second email you own), and one test project with that worker
assigned and given some pay. Open **two windows**: your normal Chrome window (admin) and an **Incognito / private
window** (the worker). Tick each line.

**A. What the worker sees (private window, logged in as the test worker)**
- [ ] Only four tabs: **My Work, My Calendar, My Earnings, Settings**. No Income, Prospects, Workers, Pricing, Invoice or Analysis menu anywhere.
- [ ] Only the test worker's own jobs show. (Give a second worker a different job: it must not appear.)
- [ ] My Work shows no money. **My Earnings** shows only this worker's own pay.
- [ ] No client phone number and no project price anywhere (check My Work, My Calendar, and a job's details).
- [ ] In the address bar, change the end of the web address to `?page=income`, then to `?page=prospects`, and press Enter. The app must still show the worker screens (My Work), never an admin page.
- [ ] Change the status of the worker's own job to **In progress**, then **Done**. In the admin window the new status appears (refresh).
- [ ] The worker cannot change the pay: there is simply no pay box anywhere on a worker screen.

**B. Deactivation (admin window, then the private window)**
- [ ] Admin: **Workers → Deactivate** the test worker.
- [ ] Private window: press F5. It must go back to the login screen. Log in again with the worker's password: it says the account has been **deactivated**.
- [ ] Admin: change the test project's date. **No notification** reaches the worker's phone.
- [ ] Admin: **Reactivate**. The worker can log in again and sees their jobs. (They must tap **Turn on notifications on this phone** once more.)

**C. Notifications (worker's phone)**
- [ ] A new job, a changed date, and a removed job each produce a notification within about a minute.
- [ ] None of them shows an amount, a phone number, a price or your private notes.
- [ ] After the worker switches **Job changes** off, a change sends nothing.

**D. Client links still work**
- [ ] A client progress link (`track.html?...`) opened in a private window still shows that one project, and nothing else.

### 4. Clean-up (when you are done testing)
1. **Test projects:** in the admin app, delete each test project. This also removes the crew jobs made for it.
   (If a test job was marked **paid**, the app warns you first: deleting it deletes that pay record.)
2. **Test worker:** Supabase → **Authentication** → **Users** → find the test worker's email → **⋯** → **Delete user**.
   This removes their account, jobs and choices. Then run this once in the SQL Editor to remove their leftover
   notification rows:
   ```sql
   delete from public.push_reminders     where user_id not in (select id from auth.users);
   delete from public.push_subscriptions where user_id not in (select id from auth.users);
   ```
3. The proof script cleans up after itself. Check that nothing is left over by running
   `select email from auth.users where email like '%wt-test%';` — it must return no rows.
4. Remove the test worker's phone: on that phone, Settings → Notifications → **Turn off on this phone**.

### Where the rules live (for the curious)
Every rule above is enforced by the **database and server functions**, not by hiding buttons: a worker who edits
the web page or tampers with their browser still gets nothing, because Supabase refuses the request. The proof
script tests exactly that layer. The browser tests also check that a worker's browser never loads admin code, that
a deactivated account is signed out, and that the admin function and the notification sender refuse a worker.

### What changed (final step)
- `supabase/worker-tests.sql` (73 checks), self-cleaning, safe to re-run after any future change.
- PART 7: a deactivated worker cannot register a phone any more.
- Tests added for the admin server function and for who sees which screen.
- Version label: **Complete · worker system (security checked)**.

### What could not be tested here
Everything above was tested with simulated accounts on a real database and with simulated browsers. The checklist
in step 3 is your proof on the real thing (real login, real phone, real Supabase project). Supabase's own sign-in
ban and session sign-out (what happens inside Supabase when you press Deactivate) were tested against a stand-in,
so checklist B is the real proof for those.


---

## Roles update — workers with more than one role, and your own roles (build 8)

What you get:
- A worker can be **Camera and Editor** (or any mix). You tick the roles when you add or edit a worker.
- **Settings → Crew roles**: add your own roles (Drone, Photographer, Colorist…), rename them, remove ones you don't use.
- `APP-NOTES.md`: one file that explains the whole app. Send it (plus the app files) to any other AI and it will understand the app. It is kept up to date with every change.

Do these in this order (about 10 minutes):

### 1. Run the roles SQL
1. Open Supabase → **SQL Editor** → **New query**.
2. Open the file **`phase8-part8.sql`**, copy everything, paste it, click **Run**.
3. At the bottom you should see a small table with **camera** and **editor**. That's it. Every worker keeps the role they had.

(It is also inside `supabase/worker-setup.sql` as PART 8, so a fresh setup gets it automatically.)

### 2. Update the "admin-create-worker" function
1. Supabase → **Edge Functions** → click **admin-create-worker**.
2. Open **Code** (or the editor), select everything and delete it.
3. Open `supabase/functions/admin-create-worker/index.ts`, copy everything, paste it in.
4. Click **Deploy**. (You do not need to change any setting or secret.)

### 3. Upload the new app files (GitHub, same as before)
Upload the files from **`roles_update_changed_files_only.zip`** (or the full app). They replace the old ones. Then open the app and press **Ctrl+Shift+R** once.
The version at the bottom of Settings should say **Roles update · multi-role workers · build 8**.

### 4. Try it
1. **Settings → Crew roles** → type `Drone`, choose *Works to the shoot day*, press **Add role**.
2. **Workers → Edit** on someone → tick **Camera** and **Editor** (and Drone if you like) → **Save**. Their card shows every role.
3. Add a new project (or edit one) → **Assign crew** → pick that worker. Their own roles are listed first in the role box. Choose the role for this project and set the pay.
4. Log in as that worker: the header shows all their roles, and each job shows the role it was assigned for.

### 5. (Optional but recommended) run the security proof again
Open `supabase/worker-tests.sql` in the SQL Editor and run it. It must say **ALL 82 CHECKS PASSED** (9 new checks cover the roles list).

### Good to know
- **Camera** and **Editor** are built in: you can rename them but not remove them.
- A role can't be removed while a worker still has it or a job still uses it. The app tells you which.
- **Works to the shoot day / deadline** decides which date the worker sees first (and the badge colour). Editing-type roles (Editor, Colorist) → *deadline*. Filming-type roles → *shoot day*.
- If one person does camera **and** editing on the same project, they get **one** job: pick the role for that project and type the combined pay.
- The suggested pay still splits the "labour" share between shoot-day roles and the "editing" share between deadline roles. You can always type your own amount.

### If something goes wrong
- *Settings → Crew roles says the table is missing* → step 1 wasn't run yet.
- *Adding a worker says "Unknown role" or "Could not check the roles"* → step 1 wasn't run, or step 2 (deploy) wasn't done.
- *Old screen / role boxes missing* → press Ctrl+Shift+R, or check the new files were uploaded.

### What changed (build 8)
- New: `js/roles.js`, `APP-NOTES.md`. Changed: Workers page, Settings page, crew form, worker screens, `admin-create-worker`, `worker-setup.sql` (PART 8), `worker-tests.sql` (82 checks).
- Tested on a real Postgres database, with the Deno function tests and the simulated browser tests (all suites passed).


---

## Phase 1 — worker app with 5 tabs (build 9)

**No SQL and no function changes this time. You only upload files.**

### 1. Upload the new app files (GitHub, same as before)
Upload the files from **`phase1_changed_files_only.zip`**. They replace the old ones. Then open the app and press **Ctrl+Shift+R**. The version at the bottom of Settings (admin) should say **Phase 1 · worker app with 5 tabs · build 9**.

### 2. Test it (log in as your test worker, in a private window)
1. The app opens on **Home**: counts for Today / Overdue / To finish, today's jobs, the next shoot, and a small "My earnings" box.
2. Bottom tabs are now **Home, Calendar, Works, Earnings, Profile**.
3. **Works**: each job card shows **My pay** and "Paid / Not paid yet", plus the To do / In progress / Done buttons. Change one status — it still works.
4. **Profile**: it has everything the old Settings had (account, notifications, Face ID, change password, log out).
5. A tapped notification still opens the right tab.

### If you see…
| You see | Do this |
|---|---|
| Old 4 tabs (My Work, My Calendar…) | Files not uploaded fully, or old page cached. Re-upload and press Ctrl+Shift+R. |
| Home is empty but the worker has jobs | Press the ↻ refresh button at the top. |
| Unstyled / odd look | Upload `css/worker.css` again and refresh. |

### What changed (build 9)
New `js/worker/workerHome.js`. Changed: `workerApp.js`, `myWork.js`, `myEarnings.js` (text), `workerSettings.js` (now "Profile"), `css/worker.css`, `version.js`, notes. A worker still only ever sees their own jobs and their own pay.


---

## Phase 2 — "Call admin" and anonymous feedback (build 10)

What you get:
- Workers get a **Call admin** button on their **Profile** tab (it dials the number you set).
- Workers can send you **feedback**. You see the message, the date and an optional mood — **not who wrote it**.
- A new **Feedback** page in your menu, and a **Crew contact number** box in your Settings.

### 1. Run the Phase 2 SQL
1. Supabase → **SQL Editor** → **New query**.
2. Open **`phase2-part9.sql`**, copy everything, paste it, click **Run**. (If a box says "Potential issue detected", choose **Run and enable RLS**.)
3. At the bottom you will see: one row for the contact number (empty for now), a list of the feedback columns — **there must be NO user, name, email or time column** — and `submit_feedback`.

### 2. Upload the new app files (GitHub, same as before)
Upload the files from **`phase2_changed_files_only.zip`** (replace the old ones), then press **Ctrl+Shift+R**. Settings should say **Phase 2 · contact admin & feedback · build 10**.

### 3. Set your number
Admin app → **Settings** → **Crew contact number** → type it (for example `+91 98765 43210`) → **Save number**.

### 4. Test it (private window, logged in as your test worker)
1. **Profile** tab → **Call admin** button shows your number (on a phone it starts a call).
2. Scroll to **Feedback for the admin** → pick a mood (optional) → write a message → **Send feedback**. You should see "Thank you".
3. In your admin window → **Feedback** (menu) → the message is there with a **● New** marker, the date and the mood. Try **Mark as read** and **Delete**.
4. Empty the number in Settings and refresh the worker: the Call button disappears.

### 5. Run the security proof again
Open **`supabase/worker-tests.sql`** in the SQL Editor and run it. It must say **ALL 95 CHECKS PASSED** (13 new ones prove a worker cannot read feedback and nothing identifying is stored).

### What "anonymous" means here — honestly
- The app **does not save and does not show** who sent a message. The database table has no user, name, email or time — only the day.
- But: with a small crew your words or the day might still make it obvious, and whoever runs the Supabase project could in theory look through the server's technical logs. Don't promise your crew more than "not saved, not shown".

### If something goes wrong
| You see | Do this |
|---|---|
| Feedback page / Settings box says "run the Phase 2 SQL" | Step 1 not done yet. |
| Worker can't send: "This account cannot send feedback" | That worker is deactivated. |
| No **Call admin** button | You haven't saved a number (step 3), or refresh the worker's Profile tab. |
| No **Feedback** in the menu | Files not fully uploaded (step 2) — Ctrl+Shift+R. |

### What changed (build 10)
New: `js/worker/workerContact.js`, `js/pages/feedback.js`, `pages/feedback.html`, `css/feedback.css`. Changed: worker Profile, admin Settings, router, menu, version, `worker-setup.sql` (PART 9), `worker-tests.sql` (95 checks).


---

## Phase 3 — the worker detail page (build 11)

**No SQL and no function changes. You only upload files.**
(This update also removes the long warning text from the workers' feedback box, as you asked.)

### 1. Upload the new app files (GitHub, same as before)
Upload the files from **`phase3_changed_files_only.zip`**, replace the old ones, then press **Ctrl+Shift+R**. Settings should say **Phase 3 · worker detail page · build 11**.

### 2. Try it (admin window)
1. Open **Workers**. Every worker card now has an **Open** button (clicking the worker's name also works).
2. The worker's own page shows:
   - name, roles, Active/Deactivated, email, last login, and the buttons Edit, Send new code, Reset access, Deactivate / Reactivate;
   - **Jobs**: counts (to do, in progress, done, overdue);
   - **Earnings**: earned, paid, still owed, and the same figures month by month;
   - **Pay history**: every payment with its date, newest first, and the total;
   - **Every job** with filters (status, when, payment).
3. Try **Mark all owed as paid** (pick a date) and, on a paid job, **Undo paid**. The page stays on this worker and updates at once.
4. Press **← All workers** to go back.

There is **no Delete** button (you chose not to have one). Feedback is never shown on this page.

### If something goes wrong
| You see | Do this |
|---|---|
| No **Open** button | Files not fully uploaded — upload again and press Ctrl+Shift+R. |
| "Loading jobs…" stays | Press Refresh on the Workers page; check PART 3 / PART 4 SQL were run earlier. |

### What changed (build 11)
`js/pages/workers.js`, `pages/workers.html`, `css/workers.css` (detail page); `js/worker/workerContact.js`, `css/worker.css` (warning text removed); version, notes.


---

## Phase 4 — the "Projects" page and the project detail page (build 12)

**No SQL and no function changes. You only upload files.**

### 1. Upload the new app files (GitHub, same as before)
Upload the files from **`phase4_changed_files_only.zip`**, replace the old ones, then press **Ctrl+Shift+R**. Settings should say **Phase 4 · Projects page · build 12**.

### 2. Try it (admin window)
1. The menu item that said **Library** now says **Projects**. It shows all your projects (active and delivered) as before.
2. **Click any project.** You get its full page: client, dates, stage and when each stage happened, amount and payment status (with the advance and balance from the invoice), the invoice, the crew (who, role, pay, paid or not, status, location, time, notes), the price split, saved links, the client progress link, and notes.
3. On that page: **Edit** opens the same project form as the Dashboard; **Delete** asks first (and warns if paid crew jobs would be erased); **Manage saved links** and **Share link / QR** work as on the Dashboard.
4. **← All projects** goes back.

### If something goes wrong
| You see | Do this |
|---|---|
| Menu still says "Library" | Files not fully uploaded — upload again, Ctrl+Shift+R. |
| Crew says "Could not load the crew" | Check your internet and press Ctrl+Shift+R. The rest of the page still works. |
| Nothing happens when you click a project | Upload `js/pages/projectLibrary.js` and `js/pages/income.js` again. |

### What changed (build 12)
`js/pages/projectLibrary.js`, `pages/projectLibrary.html`, `css/projectLibrary.css`, `js/pages/income.js` (delete/edit/links can now be used from the Projects page), `js/router.js`, `index.html`, `js/pages/invoice.js` (a comment), version, notes.


## Phase 5 — weekly package invoice + Content Types cleanup (build 13)

**No SQL and no function changes. You only upload files.**

### 1. Upload the new app files (GitHub, same as before)
Upload the files from **`build13_changed_files_only.zip`** and replace the old ones. **Also delete these 3 old files on GitHub** (they are not used any more; leaving them is harmless): `pages/contentTypes.html`, `js/pages/contentTypes.js`, `css/contentTypes.css`. Then press **Ctrl+Shift+R**. Settings → About should say **Phase 5 · Weekly invoice + Content Types cleanup · build 13**.

### 2. Try the weekly invoice
1. Open **Invoice Maker**. In **Invoice type** choose **Weekly package**.
2. Pick a package (Weekly Starter / Growth / Premium), type the client name. The invoice shows "Weekly invoice", "/ week", "Renews weekly".
3. The period is 7 days. Change **Period starts** and the end moves 6 days later by itself.
4. Press **Save**. A project called "Weekly package — …" appears on the Dashboard.
5. **Edit packages** changes the weekly packages only. **Edit prices** has new Weekly tagline / payment note / footer boxes. Your monthly packages and old invoices are untouched.

### 3. Content Types
The **Content Types** menu item is gone. The choices still appear in the project form. To change them: **Settings → Project content types** (one per line) → Save.

### If something goes wrong
| You see | Do this |
|---|---|
| No "Weekly package" in Invoice type | Upload `pages/invoice.html` and `js/pages/invoice.js` again, Ctrl+Shift+R. |
| Weekly packages show monthly names | Upload `js/pricing.js` again. |
| "Content Types" still in menu | Upload `index.html` and `js/router.js` again. |
| No "Project content types" box in Settings | Upload `js/pages/settings.js` and `pages/settings.html` again. |

### What changed (build 13)
`js/pages/invoice.js`, `pages/invoice.html`, `css/invoice.css`, `js/pricing.js`, `js/pages/settings.js`, `pages/settings.html`, `js/router.js`, `index.html`, `js/version.js`, docs. Removed: the 3 Content Types files.


## Phase 6 — Money: part payments and your own expenses (build 14)

**No SQL and no function changes. You only upload files.**

### 1. Upload the new app files (GitHub, same as before)
Upload the files from **`build14_changed_files_only.zip`** (it includes 5 new files), replace the old ones, then press **Ctrl+Shift+R**. Settings → About should say **Phase 6 · Money tracking · build 14**.

### 2. Try it
1. **Record part payments:** open **Projects** → click a project → in **Payments** press **＋ Record a payment**. Type the amount, date and an optional note. The page shows *Received so far*, *Balance* and every payment. Status turns **Partial**, then **Paid** by itself when the balance reaches 0. The 🗑️ next to a payment removes it.
2. **Money page (new menu item 💰 Money):** pick a month (or All time). You see **Received**, **Your expenses**, **Left**, and **Still to receive**.
3. **Add an expense:** amount, date, kind, optional note → Add expense. 🗑️ deletes one.
4. **Still to receive** lists projects with a balance; **Record payment** works from there too.
5. Dashboard totals now count part payments. Once a project has payments, its status is worked out from them (the dropdown becomes a label). Older projects without payments work as before. An old "Partial" project gets its invoice advance as the first payment automatically.
6. Crew pay is **not** counted on this page.

### If something goes wrong
| You see | Do this |
|---|---|
| No "Money" in the menu | Upload `index.html` and `js/router.js` again, Ctrl+Shift+R. |
| Money page is blank / "Could not load" | Upload the 5 new files: `js/money.js`, `js/paymentsUi.js`, `js/pages/money.js`, `pages/money.html`, `css/money.css`. |
| No "Record a payment" on the project page | Upload `js/pages/projectLibrary.js` and `js/paymentsUi.js`. |
| "More than the balance" message | The payment is bigger than what is left. Edit the project amount first if the price went up. |
| Expenses missing on another device | Wait a few seconds / reload; they sync like your other data. |

### What changed (build 14)
New: `js/money.js`, `js/paymentsUi.js`, `js/pages/money.js`, `pages/money.html`, `css/money.css`. Changed: `js/pages/income.js`, `js/pages/projectLibrary.js`, `js/pages/invoice.js`, `js/pages/clientAnalysis.js`, `js/pages/clientDirectory.js`, `js/storage.js`, `js/cloud.js`, `js/router.js`, `index.html`, `js/version.js`, docs.
