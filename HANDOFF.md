# HANDOFF — where the big update stands (read with APP-NOTES.md)

**Current version:** Phase 3 · worker detail page · build 11 (20 Oct 2026)

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

## Phase 3 (build 11) — done
Worker detail page inside `js/pages/workers.js` (state `detailId`; `#wkDetail` in `pages/workers.html`). No SQL.
Also removed the long anonymity warning paragraph from the worker feedback screen (owner's request).

## Next: Phase 4 — Projects page + project detail (A4)
Rename "Project Library" → **Projects** everywhere users see it (keep the old `projectLibrary` route working). It lists ALL projects
(like the Library grid today). Opening a project shows a full detail page: client, dates, stage + history, amount, payments, crew
(who, role, pay, status, location, time, notes), services/content types, revisions, saved links, client progress link, invoice(s),
price split, notes; edit/delete from there. Reuse existing data/logic (`getIncome`, `crew.js`, `tracklink.js`, `pricing.js`); do NOT
copy the Dashboard. Admin-only. First do the inventory of where project data lives (`js/pages/income.js`, `storage.js`).
Then: 5 remove Content Types *page* · 6 Money tracking · 7 Package builder · 8 extend proof. (Delete worker is dropped.)

## Notes
- Test rig lives only in the build session. The latest tests zip has it: SQL suites, Deno, vapid, browser t1–t15.
