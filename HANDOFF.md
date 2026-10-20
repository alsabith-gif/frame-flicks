# HANDOFF — where the big update stands (read with APP-NOTES.md)

**Current version:** Phase 2 · contact admin & feedback · build 10 (20 Oct 2026)

## Done
- Worker system complete and security-proofed (status, earnings/pay, notifications, `worker-tests.sql`).
- Roles update (build 8): multi-role workers, Settings → Crew roles, PART 8 SQL.
- **Phase 1 (build 9):** worker app tabs Home / Calendar / Works / Earnings / Profile. New `js/worker/workerHome.js`.
  Own pay shown on Works cards. Settings → Profile. No new SQL.

## Owner's decisions (keep)
- Order of phases: as in APP-NOTES.md §11b.
- **Delete worker (A3): dropped** — do not build.
- Contact admin: **call only** (`tel:`); the owner types the number in admin Settings (`crew_contact` table, admin write, admin + active workers read).
- Home tab = greeting + today's jobs + next shoot + jobs to finish + own earnings. Pay on Works cards: yes.
- Projects page = all projects (like the Library today) + a detail page. Content Types: remove only the page, keep the choices.
- Packages (A1): my choice — items with counts, revisions, delivery days, add-ons, price, one-time/monthly, active/archived; internal screens only; keep the old monthly packages as defaults.
- Not answered, using defaults: money page = own expenses + partial payments (yes to both); feedback = text + optional mood, admin can delete, date only.

## Phase 2 (build 10) — done
PART 9 SQL (`crew_contact`, `feedback`, `submit_feedback`), worker Profile (Call admin + feedback, with an honest anonymity note),
admin Settings contact box, admin Feedback page. Security proof now 95 checks. Mood values: good / okay / bad.

## Next: Phase 3 — Worker detail page (A2) + proper earnings view per worker
Click a worker on the Workers page → full page: name, email, roles, status, last login, actions (edit, send code, reset access,
deactivate/reactivate — NO delete), job counts, every job with filters (project, dates, status, pay, paid on), earnings
(earned / paid / owed) + pay history, mark paid / unpaid with a date (reuse `pay.js` + `workers.js` pay modal). Never show feedback there.
Admin-only data; no new SQL expected. Then update tests, APP-NOTES, SETUP, version.

## Notes
- Test rig lives only in the build session. The latest tests zip has it: SQL suites, Deno, vapid, browser t1–t14.
