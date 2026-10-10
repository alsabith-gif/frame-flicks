// pay.js — admin-only pay tracking: which jobs can be marked paid, date
// checks, and the database calls. The pure functions have no DOM or network.
//
// The database (PART 5) enforces the same rules again, so even an old copy of
// the app cannot break them:
//   • only a Done job can be paid
//   • a paid job's pay amount is locked (undo the payment to change it)
//   • a paid job always has a paid date; an unpaid one never does
//
// Every write below is "safe to repeat": it only touches jobs that are still in
// the state we expect (Done + unpaid to pay; paid to undo), so pressing a button
// twice, or two windows open at once, can never change a date or double-count.

import { supabase } from './cloud.js';
import { money } from './worker/earningsCalc.js';

export { money };

const toPaise = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

export const isPaid = (t) => t.pay_status === 'paid';
// A job can be marked paid only once the worker has finished it.
export const canMarkPaid = (t) => t.status === 'done' && !isPaid(t);

// The Done-but-unpaid jobs (optionally for one worker) — "still owed".
export function owedJobs(tasks, workerId) {
  return (tasks || []).filter((t) => (!workerId || t.worker_id === workerId) && canMarkPaid(t));
}

export function totalPay(jobs) {
  return (jobs || []).reduce((sum, t) => sum + toPaise(t.pay_amount), 0) / 100;
}

// Returns a message for the admin, or null if the date is fine.
export function validatePaidDate(value, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return 'Pick the date the payment was made.';
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return 'That date does not exist.';
  if (y < 2000) return 'That date looks wrong. Check the year.';
  if (today && value > today) return "The paid date can't be in the future.";
  return null;
}

function friendly(error) {
  const code = error && error.code;
  const msg = (error && error.message) || '';
  if (/failed to fetch|network|load failed/i.test(msg)) return new Error('No connection to the server. Check your internet and try again.');
  if (code === '55000') return new Error(msg);   // our own database rules, already in plain words
  if (code === '42501') return new Error('You are not allowed to do that. Log in as the admin.');
  if (code === '42P01' || code === 'PGRST205') return new Error('The worker jobs table is missing — run PART 3, 4 and 5 of supabase/worker-setup.sql (SETUP.md).');
  return new Error(msg || 'Could not save. Please try again.');
}

async function write(builder) {
  let res;
  try { res = await builder; } catch (e) { throw friendly(e); }
  if (res.error) throw friendly(res.error);
  return (res.data || []).length;
}

// Marks the given jobs paid on `paidOn` (YYYY-MM-DD). Only jobs that are still
// Done and unpaid are changed. Resolves to how many were really changed.
export async function markPaid(ids, paidOn, today) {
  const bad = validatePaidDate(paidOn, today);
  if (bad) throw new Error(bad);
  if (!ids || !ids.length) return 0;
  return write(supabase.from('worker_tasks')
    .update({ pay_status: 'paid', paid_on: paidOn })
    .in('id', ids).eq('status', 'done').eq('pay_status', 'unpaid')
    .select('id'));
}

// Undoes a payment (the job goes back to "owed"). Only paid jobs are changed.
export async function markUnpaid(ids) {
  if (!ids || !ids.length) return 0;
  return write(supabase.from('worker_tasks')
    .update({ pay_status: 'unpaid', paid_on: null })
    .in('id', ids).eq('pay_status', 'paid')
    .select('id'));
}
