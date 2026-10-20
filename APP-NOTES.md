# Frame Flicks — App Notes (read this first)

> **For any AI (or person) picking this project up:** this file describes the whole app — what it is, how it is
> built, where everything lives, the security rules that must never be broken, and how it is tested.
> Read it top to bottom before changing anything. **Whoever changes the app must also update this file in the
> same change** (see "How to keep this file up to date" at the bottom).

- **App version when this was last updated:** Phase 3 · worker detail page · build 11 · 20 Oct 2026 (see `js/version.js`)
- **Owner:** one person (the "admin"), a freelance video editor / small studio in India (times are IST, `Asia/Kolkata`).
  The owner is **not a programmer**. Explain things in plain words, step by step, and say exactly what to click.

---

## 1. What the app is

**Frame Flicks** (internally still called *ClientTrack* in a few places) is a private business app for a video studio:

- **Admin side (the owner):** outreach CRM (prospects, follow-ups, DM scripts), a project **Dashboard** (income, paid/pending),
  client analysis, price split ("Price Distributor"), invoice maker, calendar with push reminders, shareable
  client progress links, and a **crew system**: add workers, assign them to projects with a role and pay, see their
  progress, and mark them paid.
- **Worker side (the crew):** a separate, light app with **five bottom tabs**: **Home** (today's jobs, next shoot, overdue, own earnings snapshot), **Calendar** (read-only), **Works** (job list; change status To do / In progress / Done; own pay on each card), **Earnings** (own pay only), **Profile** (**Call admin** button, notifications, **anonymous feedback**, Face ID, password, log out). A worker sees **only their own jobs and own pay**.
- **Client side:** `track.html` — a public read-only page where a client sees their project's stage via a private link.

Everything is **vanilla JavaScript (ES modules), HTML and CSS. There is no build step, no framework, no bundler.**
Files are uploaded to GitHub and served from Cloudflare (workers.dev). Data lives in **Supabase**
(Postgres + Auth + Edge Functions + pg_cron).

## 2. Hard rules (never break these)

1. **Workers must never see:** other workers' pay, admin totals, prospects, pricing, invoices, client phone numbers,
   or project prices. A worker sees only: project name, client *name*, location, shoot date/time, deadline, crew
   notes, their role, their own pay, their own status.
2. A worker can change **only the status of their own jobs**, and only through the database function
   `worker_set_status`. Workers have no insert/update/delete rights on any table.
3. Notifications never contain pay, phone numbers or prices.
4. **No secrets in browser code.** The Supabase *anon* key in `js/config.js` is public by design; the service-role key,
   VAPID private key and `CRON_SECRET` live only in Supabase (edge-function secrets / SQL).
5. Rules are enforced by the **database (Row Level Security, triggers, security-definer functions)** and server
   functions — not by hiding buttons. The browser is never trusted.
6. A worker's browser must never download admin code (admin modules are only dynamically imported after an admin check;
   test `t11_access.mjs` enforces this — if you add a shared file the worker app imports, add it to that allow-list).
7. Vanilla JS, no build step. Do not introduce npm dependencies into the browser app.
8. Keep instructions for the owner simple. They upload files to GitHub in batches under 100 files.

## 3. Architecture at a glance

```
Browser (admin)  ── index.html → js/bootstrap.js ──► js/main.js + js/pages/*   (admin app)
Browser (worker) ── index.html → js/bootstrap.js ──► js/worker/workerApp.js     (worker app)
Public client    ── track.html → js/tracker.js                                   (read-only)
                           │
                           ▼
Supabase: Auth (email + password; workers' first login by 6-digit emailed code)
          Postgres + RLS (see §6)
          Edge functions: admin-create-worker, send-reminders
          pg_cron + pg_net: calls send-reminders every minute
          Web Push (VAPID) → sw.js shows the notification
```

**Boot flow (`js/bootstrap.js`):** every sign-in is checked against the `profiles` table.
`role = 'admin'` → admin app. `role = 'worker'` and `active` → worker app. Deactivated, or no profile → an
"access problem" screen and sign-out. The role is stored in `cloud.js` (`setRole/getRole`).

**Admin data** is kept in `localStorage` (fast, synchronous; see `js/storage.js`, keys `ve_ct_*`) and synced to the
Supabase table `app_data` (key/value rows) by `js/cloud.js`. A worker's device never pulls or writes `app_data`.
**Crew data** (workers, jobs, roles) is *not* in localStorage; it is read/written directly in Supabase tables.

**Router (`js/router.js`):** not URL-based. `showPage(name)` fetches `pages/<name>.html`, injects it, lazy-loads
`css/<name>.css` and `js/pages/<name>.js`, then calls that module's `init()`.

## 4. File map

### Top level
| File | What it is |
|---|---|
| `index.html` | The app shell (login screen, admin sidebar/shell, worker shell, modal, toast). |
| `track.html` + `js/tracker.js` | Public client progress page. Reads `project_status` by an unguessable code. |
| `sw.js` | Service worker. **Push only** — shows notifications and opens the app when tapped. No caching. |
| `manifest.json`, `assets/` | PWA manifest and icons. |
| `FrameFlicks.js` | A separate iPhone home-screen widget script (Scriptable). Not part of the web app. |
| `README.md`, `SETUP.md` | `README.md` = original overview. **`SETUP.md` = step-by-step setup/upgrade instructions, one section per phase.** |
| `APP-NOTES.md` | This file. |

### `js/` (shared + admin)
| File | Purpose |
|---|---|
| `config.js` | Supabase URL + anon key (public) and an empty VAPID public key (the app asks the server for it). |
| `cloud.js` | All Supabase access: login/logout, `fetchProfile`, `callWorkerAdmin` (calls the edge function), `app_data` sync, tracker status sync. Holds the signed-in role. |
| `bootstrap.js` | Runs first on every open; routes admin / worker / blocked. |
| `main.js`, `router.js`, `modal.js`, `toast.js` | Admin shell, page router, modal + confirm dialog, toast. |
| `storage.js` | The only place that touches `localStorage` for admin data; queues background cloud sync. |
| `roles.js` | **The crew role list** (Camera, Editor + admin-defined). Shared by admin and worker apps. Pure; `loadRoles(client)` fetches `crew_roles`. See §7. |
| `crew.js` | Admin crew logic: `suggestPays`, `validateCrew`, `buildTaskPayloads`, `diffCrew` (pure) + DB helpers (`loadWorkers`, `saveCrewChanges`…). |
| `crewForm.js` | The "Assign crew" section inside the Add/Edit Project form (worker, role, pay; paid rows are locked). |
| `crewOverview.js` | Pure helpers for the Workers page (counts, overdue, filtered job list). |
| `pay.js` | Admin pay tracking (mark paid/unpaid, date checks). Same rules are enforced again by a DB trigger. |
| `pricing.js` | Pure pricing + price-split maths (`splitPrice`, defaults). |
| `clients.js`, `format.js`, `imageUtils.js`, `screenshotShare.js`, `followupNudge.js` | CRM helpers. |
| `reminderRules.js`, `reminders.js` | Admin calendar → `push_reminders` rows (pure rules + sync). |
| `push.js` | Browser side of Web Push (register SW, permission, subscribe). |
| `facelock.js` | Per-device Face ID lock (never synced). |
| `tracklink.js`, `tracker.js` | Build / use the public client progress link. |
| `version.js` | `APP_VERSION` / `APP_BUILD`, shown on login + Settings → About. **Bump on every release.** |

### `js/pages/` (admin pages, one per sidebar item)
`prospects`, `goals`, `analysis`, `income` (the **Dashboard**), `clientAnalysis`, `clientDirectory`, `projectLibrary`,
`scripts`, `followup`, `calendar`, `invoice`, `priceSplit`, `contentTypes`, `tips`,
**`workers`** (add/edit/deactivate workers with role tick-boxes; each worker opens into a **detail page** — roles, status, last login, actions, job counts, earnings per month, pay history, every job with filters, mark paid / undo; no delete; never shows feedback — plus the all-crew jobs list),
**`feedback`** (admin-only: crew feedback, date + mood only, mark read, delete), **`settings`** (mode switcher, Face ID, notifications, **Crew roles manager**, **crew contact number**, About, logout).
Each has a matching `pages/<name>.html` and `css/<name>.css`.

### `js/worker/` (the worker app — a separate, light shell)
`workerApp.js` (shell, 5 tabs, refresh loop), `workerHome.js` (Home tab), `myWork.js` (Works tab), `workerCalendar.js`, `myEarnings.js`, `workerSettings.js` (the Profile tab), `workerContact.js` (Call-admin button + feedback form),
`workerNotify.js` (notification choices), `workerData.js` (fetch own jobs, offline cache, `worker_set_status`),
`workerView.js` (pure date/grouping helpers, `keyDate`), `earningsCalc.js` (pure money rules, in paise).

### `supabase/`
| File | Purpose |
|---|---|
| `worker-setup.sql` | **The whole database setup, in numbered PARTs** (safe to run twice): 1A profiles+admin, 1B lockdown, 1C project_status, 2 worker accounts, 3 jobs, 4 worker status function, 5 pay guard, 6A push, 6B cron sender, 7 final tightening, **8 crew roles**, **9 contact number + anonymous feedback**. |
| `worker-tests.sql` | **Security proof.** Makes pretend users, tries things a worker must not do, deletes everything after. Every row must say PASS (95 checks). |
| `functions/admin-create-worker/index.ts` | The ONLY place worker accounts are created/changed (service-role key, admin-only). Actions: create, update, set_active, resend_code, reset_access, list_status. |
| `functions/send-reminders/index.ts` | Sends due push reminders (Verify JWT **off**; protected by the `x-cron-secret` header). Needs secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`. |
| `push-setup.sql` | Superseded; do not run. |

## 5. Database (Supabase / Postgres)

| Table | Holds | Who can access |
|---|---|---|
| `profiles` | One row per login: `user_id`, `role` (admin/worker), `name`, `email`, `active`, `job_role` (main role, kept in sync), `job_roles text[]` (all roles; first = main) | Admin: all. Worker: own row (read). Only the edge function writes workers. |
| `crew_contact` | ONE row: `phone` the crew's "Call admin" button dials | Admin: all. Active workers: read only. |
| `feedback` | `message`, optional `mood` (good/okay/bad), `day` (date only), `is_read`, `seq` (order). **No user id, name, email or time** | Admin only (read, mark read, delete). Workers cannot read it. New rows only via `submit_feedback`. |
| `crew_roles` | The role list: `key`, `label`, `main_date` (`shoot`/`deadline`), `builtin`, `sort_order` | Admin: all. Active workers: read only. |
| `worker_tasks` | One job per (project, worker): role, title, client name, location, dates, notes, `pay_amount`, `status`, `pay_status`, `paid_on`, `done_at` | Admin: all. Worker: read own. Writes only by admin (and status via `worker_set_status`). |
| `app_data` | Admin's business data (key/value). *No `user_id` column.* | Admin only. |
| `project_status` | Public client progress rows (by `track_code`) | Public read of one code; admin writes. |
| `push_subscriptions` | A phone's push address | Own rows; add/change needs an active worker or admin. |
| `push_reminders` | Reminders due at exact times (built by the database from jobs / the admin calendar) | Server only. |
| `worker_notif_prefs` | A worker's notification choices | Via `worker_set_notif_prefs`. |

**Key functions/triggers:** `is_admin`, `is_active_worker`, `worker_set_status` (the only worker write),
`worker_set_notif_prefs`, `admin_revoke_sessions`, `worker_tasks_pay_guard` (Done-before-paid, paid amount locked,
`paid_on` in India time), `rebuild_task_reminders` / `rebuild_worker_reminders` / `push_worker_alert` /
`worker_wants` / `worker_tasks_notify` / `profiles_notify_active` (notification building),
`submit_feedback` (security definer: checks the caller is an active worker, then stores the message **without** `auth.uid()`), `crew_roles_guard` (built-ins permanent, roles in use can't be removed), `profiles_sync_roles` (keeps
`job_roles`/`job_role` consistent and validates roles exist).

**Pay maths** is in **paise** (integers). Earned = Paid + Still owed. A job can only be marked paid when Done; once
paid its amount is locked (undo paid → change → mark paid again).

## 6. Security model (summary)

- Row Level Security on every table; `revoke all … from anon` where relevant.
- Workers get data only through RLS-filtered selects and the single `worker_set_status` function.
- Deactivating a worker: profile `active=false` first (the database stops honouring them immediately), then Supabase
  sign-in ban, then all sessions revoked.
- Notifications are built by the database from job rows and never include pay/phone/price; the sender claims a
  reminder before sending and skips deactivated users.
- Proof: `supabase/worker-tests.sql` (95 checks) + the test suites in §9.

## 7. Crew roles (Roles update)

- A worker can have **several roles** (e.g. Camera + Editor). `profiles.job_roles` is the list; the **first is the
  main role** and is mirrored into `profiles.job_role` so older code keeps working.
- The admin manages the list in **Settings → Crew roles**: add (name + "works to the shoot day" or "works to the
  deadline"), rename, remove. **Camera and Editor are built in** (rename only). A role cannot be removed while a
  worker has it or a job uses it.
- `main_date` replaces the old hard-coded "editor ⇒ deadline" rule: a role that works to the **deadline** is shown with
  its due date as the key date and an amber badge; a **shoot** role uses the shoot date and a purple badge.
- **Pay suggestion** (`suggestPays`): the "labour" share of the price split is shared equally by *shoot* roles; the
  "editing" share by *deadline* roles. It is only a suggestion — the admin can type any amount.
- One job per worker per project: if one person does camera *and* editing on the same project, the admin picks the
  role for that project (the worker's own roles are listed first) and sets the combined pay.
- `js/roles.js` exports `CREW_ROLES`, `ROLE_LABEL`, `ROLE_MAIN_DATE` as objects that are **updated in place**, so any
  file that imported them sees the current list. The list is cached in `localStorage` (`ff_crew_roles`) so a worker
  offline still sees "Drone". If the `crew_roles` table is missing (SQL not run), the app falls back to Camera + Editor.
- `admin-create-worker` accepts `job_roles` (array) and still accepts a single `job_role` from older code; every role
  is checked against `crew_roles`.

## 8. Notifications (web push)

`push_reminders` rows are created by the database (jobs → shoot/due reminders and change alerts) and by the admin
browser (calendar events). `pg_cron` calls `send-reminders` every minute (via `pg_net`, with the `x-cron-secret`
header); it sends encrypted VAPID web-push messages using `npm:web-push@3.6.7`. `sw.js` displays them. iPhone
requires "Add to Home Screen" first.

## 9. Tests (all run outside the app, against fakes or a real throwaway Postgres)

| Suite | What it proves |
|---|---|
| `worker-tests.sql` (in Supabase) | 95 security checks on the owner's real database. |
| `sql_phase4/5/6_tests.sql`, `sql_phase8_tests.sql`, `sql_phase9_tests.sql` | Worker status function, pay guard, reminders/notifications, crew roles — on a real Postgres 16 with a fake Supabase schema (`fake_supabase.sql`, `stubs.sql`, `chain.sh`). |
| `deno/test.js`, `deno/test_admin.js` | `send-reminders` and `admin-create-worker` with fake supabase / web-push. |
| `vapid/vapid_test.mjs` | Push keys and encryption with Node `web-push`. |
| `browser/t1…t15` | jsdom tests with a fake `cloud.js` (`cloud_stub.js`): worker app, admin pages, pay, crew lock, delete warning, notifications, access rules (`t11`), roles (`t12`), Home tab (`t13`), contact + feedback (`t14`), worker detail page (`t15`). |

When you change behaviour: add/adjust a test, run **all** suites, and only then hand over files.

## 10. How the owner deploys changes

1. Upload changed files to GitHub (the repo is served by Cloudflare workers.dev). Replace old files; hard-refresh
   the browser (Ctrl+Shift+R) if the app looks unstyled or an old screen shows.
2. If the update includes SQL, run the given `.sql` file in Supabase → SQL Editor first (safe to run twice).
3. If an edge function changed, paste the new `index.ts` into Supabase → Edge Functions and Deploy.
4. `SETUP.md` has the exact click-by-click steps per phase.

## 11. Change log

| Build | Date | What changed |
|---|---|---|
| Phase 1–3 | Oct 2026 | Profiles + lockdown, worker accounts, assigning crew, My Work. |
| Phase 4 | Oct 2026 | Workers change job status (`worker_set_status`), `done_at`. |
| Phase 5 | Oct 2026 | Earnings, marking paid, pay guard trigger (PART 5). |
| Phase 6 | Oct 2026 | Push notifications, cron sender (PART 6A/6B), edge function `send-reminders`. |
| Final (build 7) | 14 Oct 2026 | PART 7, security proof `worker-tests.sql` (95 checks), access tests. |
| Phase 3 (build 11) | 20 Oct 2026 | Worker detail page on the Workers page (Open button / name link). Removed the long anonymity warning from the worker feedback screen (kept: "does not save or show who sent it"). No SQL. |
| Phase 2 (build 10) | 20 Oct 2026 | PART 9 (`crew_contact`, `feedback`, `submit_feedback`); worker Profile: Call admin + anonymous feedback; admin Settings: crew contact number; admin Feedback page; proof now 95 checks. |
| Phase 1 (build 9) | 18 Oct 2026 | Worker app has 5 tabs (Home, Calendar, Works, Earnings, Profile); new Home tab (`workerHome.js`); own pay on Works cards; Settings renamed Profile (old `?page=settings` links still work). No SQL. |
| Roles update (build 8) | 18 Oct 2026 | Multi-role workers; admin-defined roles (Settings → Crew roles, PART 8, `crew_roles`, `job_roles`); `roles.js`; `main_date` rule replaces hard-coded editor logic; `admin-create-worker` takes `job_roles`; this notes file added. |

## 11b. Roadmap (the owner's "big update" plan)
Done: worker status, earnings and paying, notifications, security proof, multi-role workers, Phase 1 (5 tabs), **Phase 2 (contact admin + feedback), **Phase 3 (worker detail page)**.
Next, in this order (owner confirmed):
4 Projects page + project detail (renames "Project Library") · 5 Remove the Content Types *page* (keep the choices in the
project form) · 6 Money tracking (own expenses + partial payments) · 7 Package builder · 8 Extend the security proof.
**Dropped by the owner: "Delete worker"** (too risky for past pay records). See `HANDOFF.md`.

## 12. How to keep this file up to date

**Rule for every future change (by any AI or person):** in the same change that edits the app, update this file:

1. Add a row to **§11 Change log** (build label, date, one-line summary) and bump `js/version.js`.
2. If you added, renamed or removed a file → update **§4 File map**.
3. If you changed tables, columns, functions, triggers or policies → update **§5/§6** and add a new numbered PART to
   `supabase/worker-setup.sql` (never edit old PARTs in a way that breaks re-running).
4. If you changed a rule the worker side depends on → re-check **§2 Hard rules** and run `worker-tests.sql`.
5. If you added or removed tests → update **§9**.
6. Update the "last updated" line at the top.
7. Add a short section to `SETUP.md` telling the owner, in plain words, what to run/upload.

Keep this file accurate rather than long. If something here is out of date, fix it.
