# HANDOFF — where the big update stands (read with APP-NOTES.md)

**Current version:** Phase 7 · Package builder · build 15 (23 Oct 2026)

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

## Phase 7 (build 15) — built, waiting for owner's "it works"
Packages page + library (`packageLib` in pricing data), one-time invoice type, invoice reads library. Files: `pages/packages.html`, `js/pages/packages.js`, `css/packages.css`, `pricing.js`, `invoice.js`, `invoice.html/css`, `router.js`, `index.html`. Tests: `t19_packages.mjs`. No SQL. Next: Phase 8 — extend the security proof (feedback / money / packages / expenses are admin-only: they live in `app_data`, so add checks that workers cannot read it).

## Phase 6 (build 14) — done
Money page + partial-payment history. Files: `js/money.js`, `js/paymentsUi.js`, `js/pages/money.js`, `pages/money.html`, `css/money.css`; edits in `income.js`, `projectLibrary.js`, `invoice.js`, `clientAnalysis.js`, `clientDirectory.js`, `storage.js`, `cloud.js`, `router.js`, `index.html`. Tests: `t18_money.mjs`. No SQL. Next: Phase 7 Package builder.

## Phase 5 (build 13) — done
Weekly package invoice (owner's new request) in `js/pages/invoice.js` + `pricing.js` (`weeklyPackages`, `business.weekly*`). Content Types page removed; list edited in Settings (`settings.js` `renderContentTypes`). No SQL. Tests: `t17_weekly_ctypes.mjs`. Next: Phase 6 Money tracking.

## Phase 4 (build 12) — done
Projects page + project detail inside `js/pages/projectLibrary.js` (state `detailId`, `#plDetail`). Renamed menu/title to "Projects".
`income.js` now exports `confirmDeleteProject`, `openIncomeModal`, `openLinksModal`, `syncTrackerStatus`, `onProjectsChanged`. No SQL.
(A half-built draft of this was found in the folder from an earlier session; it was reviewed, tested (t16) and a link-safety fix added.)

## Next: Phase 5 — Remove the Content Types PAGE (A6)
Remove only the page (menu item, `PAGE_META` entry, `pages/contentTypes.html`, `js/pages/contentTypes.js`, `css/contentTypes.css`), and make the old
`contentTypes` route redirect (e.g. to the Dashboard). KEEP the content-type choices (`ve_ct_content_types`, `getContentTypes`) working in the
Add/Edit Project form, the Dashboard filter and the Invoice Maker; never delete stored data. Since the page was the only place to edit the list,
decide with the owner whether to add a tiny "edit content types" box (e.g. in Settings) — default: yes, a small box in admin Settings.
Check `t3`/`t7`/`t9` and add a test that the form still offers the saved types. Then: 6 Money tracking · 7 Package builder · 8 extend proof. (Delete worker dropped.)

## Notes
- Test rig lives only in the build session. The latest tests zip has it: SQL suites, Deno, vapid, browser t1–t16.
