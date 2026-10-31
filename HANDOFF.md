# HANDOFF — where the big update stands (read with APP-NOTES.md)

**Current version:** Connect 4 · Simple worker Home · build 22 (25 Oct 2026)

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

## "Connect everything" plan (owner approved 25 Oct 2026) — parts A–D
Owner's decisions: (1) profit counts the Price Distributor percentages for Travel/Subscriptions ("simple"), real typed expenses are shown separately and NOT subtracted again; (2) crew pay counts when ASSIGNED (paid / still owed shown separately); (3) referral = 5% only when a project is marked as a referral; (4) no preview of the worker Home redesign, just build it.
- **A (build 19) — built, waiting for "it works":** `js/finance.js` + links (see APP-NOTES change log).
- **B — Money page in detail:** received → crew (paid/owed) → referral → set-asides → profit; per-project and per-client tables; still to receive / still to pay crew; compare set-asides vs real expenses.
- **C — Analysis:** per-client split of every rupee, charts: top clients, most profitable clients, business profit by month, crew earnings (use `summarize`, `crewEarnings`).
- **D — Worker Home:** one big "Your next job" card, a short "this week" list, one line "Owed to you ₹X"; remove the 3 counters and repeated sections.

## Upgrade 2 (build 18) — built, waiting for owner's "it works"
Owner must run `upgrade2-part10.sql` (PART 10) in Supabase before assigning one worker two roles. Files: `js/crew.js`, `js/crewForm.js`, `js/pages/clientDirectory.js`, `supabase/worker-setup.sql` (PART 10). Tests `sql_phase10_tests.sql`, `t21`, `t22`; `sql_phase5_tests.sql` conflict key updated.

## Upgrade 1 (build 17) — built, waiting for owner's "it works"
Invoice PDF download (after saving) + layout fixes (Price Distributor overflow, date boxes on iPhone, Profile buttons). Files: `js/pages/invoice.js`, `pages/invoice.html`, `css/components.css`, `css/priceSplit.css`, `css/worker.css`, new `js/vendor/html2canvas.min.js`, `js/vendor/jspdf.umd.min.js`. No SQL. Tests `t20_invoice_pdf.mjs`.

## Phase 8 (build 16) — built, waiting for owner's result of running the proof
Owner must run the new `supabase/worker-tests.sql` once (SQL Editor → Run). Expect `ALL 114 CHECKS PASSED`. No SQL changes to the database, no app behaviour change. This was the last phase of the big update; Delete worker stays dropped.

## Phase 7 (build 15) — done
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


## Connect plan progress
A (build 19) done · B Money page (build 20) done · C Analysis page (build 21) done · D Worker Home (build 22) delivered, waiting for "it works" — then the Connect plan is complete · D Worker Home after.
