// money.js — pure money maths (no DOM, no storage) so it can be tested alone.
// A project may carry `payments: [{ id, date, amount, note }]`. Once it does,
// the payments ARE the truth: received = their sum and the status (Pending /
// Partial / Paid) is worked out from them. A project with no `payments` list
// (everything made before Phase 6) keeps working exactly as before:
// "Paid" means the whole amount was received, anything else means nothing yet.
// All amounts are whole rupees.

const n = (v) => Math.max(0, Math.round(Number(v) || 0));
export const hasPayments = (p) => Array.isArray(p && p.payments);

export function received(p) {
  if (!p) return 0;
  if (hasPayments(p)) return p.payments.reduce((s, x) => s + n(x.amount), 0);
  return p.status === 'Paid' ? n(p.amount) : 0;
}
export const balance = (p) => Math.max(0, n(p && p.amount) - received(p));

export function statusFor(p) {
  const amt = n(p.amount), got = received(p);
  if (amt > 0 && got >= amt) return 'Paid';
  return got > 0 ? 'Partial' : 'Pending';
}

// Turn an old project into one with a payments list, keeping what it already says.
export function startPayments(p, advance = 0) {
  if (hasPayments(p)) return p;
  const date = p.date || '';
  if (p.status === 'Paid') p.payments = n(p.amount) ? [{ id: 'old', date, amount: n(p.amount), note: 'Paid before payment tracking' }] : [];
  else if (n(advance)) p.payments = [{ id: 'adv', date, amount: n(advance), note: 'Advance' }];
  else p.payments = [];
  return p;
}

export function addPayment(p, { date, amount, note }, id) {
  if (!n(amount)) throw new Error('Enter an amount above 0');
  startPayments(p);
  p.payments.push({ id: id || `pay${Date.now()}${p.payments.length}`, date: date || '', amount: n(amount), note: String(note || '').trim().slice(0, 120) });
  p.status = statusFor(p);
  return p;
}

export function removePayment(p, id) {
  if (!hasPayments(p)) return p;
  p.payments = p.payments.filter((x) => x.id !== id);
  p.status = statusFor(p);
  return p;
}

// The invoice's "advance paid" is kept as one payment with id 'adv'.
export function applyInvoiceAdvance(p, advance, date) {
  const a = n(advance);
  if (!a && !hasPayments(p)) return p;            // nothing to track yet — leave legacy status alone
  startPayments(p);
  const i = p.payments.findIndex((x) => x.id === 'adv');
  if (a && i >= 0) p.payments[i] = { ...p.payments[i], amount: a, date: date || p.payments[i].date };
  else if (a) p.payments.unshift({ id: 'adv', date: date || '', amount: a, note: 'Advance' });
  else if (i >= 0) p.payments.splice(i, 1);
  p.status = statusFor(p);
  return p;
}

// Month key (YYYY-MM) a payment belongs to; undated payments fall back to the project's start date.
const mk = (d) => (d && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : '');
export function paymentRows(projects) {
  const rows = [];
  for (const p of projects) {
    if (hasPayments(p)) p.payments.forEach((x) => rows.push({ project: p, pay: x, date: x.date || p.date || '', amount: n(x.amount) }));
    else if (p.status === 'Paid' && n(p.amount)) rows.push({ project: p, pay: null, date: p.date || '', amount: n(p.amount) });
  }
  return rows;
}

// Totals for one month ('' = all time). expenses: [{date, amount}]
export function summary(projects, expenses, month = '') {
  const inMonth = (d) => !month || mk(d) === month;
  const money = paymentRows(projects).filter((r) => inMonth(r.date));
  const exp = (expenses || []).filter((e) => inMonth(e.date));
  const rec = money.reduce((s, r) => s + r.amount, 0);
  const spent = exp.reduce((s, e) => s + n(e.amount), 0);
  const owed = projects.reduce((s, p) => s + balance(p), 0);
  return { received: rec, expenses: spent, left: rec - spent, owed, payments: money, expenseRows: exp };
}

export function monthsWithData(projects, expenses) {
  const set = new Set();
  paymentRows(projects).forEach((r) => mk(r.date) && set.add(mk(r.date)));
  (expenses || []).forEach((e) => mk(e.date) && set.add(mk(e.date)));
  return [...set].sort().reverse();
}

export const EXPENSE_CATEGORIES = ['Travel', 'Equipment', 'Software / subscriptions', 'Marketing', 'Food', 'Rent / bills', 'Other'];
