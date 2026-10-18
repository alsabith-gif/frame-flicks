# HANDOFF — where the big update stands (read with APP-NOTES.md)

**Current version:** Phase 1 · worker app with 5 tabs · build 9 (18 Oct 2026)

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

## Next: Phase 2 — Contact admin + anonymous feedback
1. SQL PART 9: `crew_contact` (admin write; admin + active workers read), `feedback` table with NO user id/name/email/exact time (date only),
   `submit_feedback(message, mood)` SECURITY DEFINER (checks active worker, does not store auth.uid(), trims/validates length), no worker select/update/delete.
2. Admin Settings card for the call number; admin **Feedback** page (newest first, date only, unread marker, mark read, delete).
3. Worker Profile: "Call admin" button (`tel:`; hidden if no number) and a feedback form with an honest note about anonymity limits.
4. Tests: SQL (worker can't read feedback, nothing identifying stored), browser, add checks to `worker-tests.sql`; bump version; update APP-NOTES + SETUP.

## Notes
- Test rig lives only in the build session (not in the app zip). `roles_update_tests.zip` / the latest tests zip has it: SQL suites, Deno, vapid, browser t1–t13.
