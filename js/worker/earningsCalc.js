// worker/earningsCalc.js — the money rules, with no DOM and no network, so the
// worker's "My Earnings" tab and the admin's Workers page always agree and the
// rules can be tested on their own.
//
//   Earned     = pay of jobs that are DONE
//   Paid       = pay of done jobs the admin has marked paid
//   Still owed = pay of done jobs that are not paid yet
//   so  Earned = Paid + Still owed, always.
//
// (The database also guarantees a job can only be paid once it is Done — PART 5 —
// so there is no such thing as "paid but not done".)
//
// Money is added up in paise (whole numbers) so 0.1 + 0.2 never shows as
// 0.30000000000000004.

export const IST = 'Asia/Kolkata';

const toPaise = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const fromPaise = (p) => p / 100;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

// "₹5,500" or "₹5,500.50" (never more than 2 decimals, no trailing .00)
export function money(n) {
  const v = Number(n);
  const x = Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  return '₹' + x.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(x) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

// The calendar day (YYYY-MM-DD) of a moment in INDIA time, whatever time zone
// the phone is set to. null when the value is missing or not a date.
export function istDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Which day a finished job counts for: when it was marked done (India time);
// if that was never recorded, its shoot date; failing that, its deadline.
export function earnedDay(t) {
  const d = istDay(t.done_at);
  if (d) return d;
  for (const k of ['shoot_date', 'due_date']) {
    const m = DATE_RE.exec(String(t[k] || ''));
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

export const NO_MONTH = 'none';
export const monthKey = (t) => { const d = earnedDay(t); return d ? d.slice(0, 7) : NO_MONTH; };

export function monthName(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return 'No date';
  return new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// Totals for a list of jobs (one worker's, normally).
export function summarizeEarnings(tasks) {
  let done = 0; let earned = 0; let paid = 0; let owed = 0;
  for (const t of tasks || []) {
    if (t.status !== 'done') continue;
    const p = toPaise(t.pay_amount);
    done += 1; earned += p;
    if (t.pay_status === 'paid') paid += p; else owed += p;
  }
  return { done, earned: fromPaise(earned), paid: fromPaise(paid), owed: fromPaise(owed) };
}

// Finished jobs grouped by month, newest month first; jobs with no usable date
// go in a last "No date" group. Each group: { key, label, count, earned, paid, owed, jobs }.
export function monthlyEarnings(tasks) {
  const groups = new Map();
  for (const t of tasks || []) {
    if (t.status !== 'done') continue;
    const k = monthKey(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = [...groups.entries()].map(([key, jobs]) => {
    jobs.sort((a, b) => String(earnedDay(b) || '').localeCompare(String(earnedDay(a) || ''))
      || String(a.title).localeCompare(String(b.title)));
    return { key, label: monthName(key), count: jobs.length, ...summarizeEarnings(jobs), jobs };
  });
  out.sort((a, b) => {
    if (a.key === NO_MONTH) return 1;
    if (b.key === NO_MONTH) return -1;
    return a.key < b.key ? 1 : -1;
  });
  return out;
}
