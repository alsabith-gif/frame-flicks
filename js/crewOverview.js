// crewOverview.js — pure helpers (no DOM, no network) for the admin's Workers
// page: how many jobs each worker has in each state, which are overdue, and
// the filtered "all crew jobs" list. Kept separate so the rules can be tested.
//
// "Overdue" = not done, and its main date (shoot for camera work, deadline
// for editing — same rule the worker sees) is before today.

import { keyDate, dayDiff } from './worker/workerView.js';

export const RECENT_HOURS = 48;   // a job marked done within this long is flagged "new"

export function isOverdue(t, today) {
  if (t.status === 'done') return false;
  const k = keyDate(t);
  return !!k && dayDiff(k, today) < 0;
}

export function wasMarkedDoneRecently(t, now = Date.now()) {
  if (t.status !== 'done' || !t.done_at) return false;
  const ms = Date.parse(t.done_at);
  return Number.isFinite(ms) && now - ms >= 0 && now - ms <= RECENT_HOURS * 3600 * 1000;
}

// Counts for one worker's jobs.
export function summarize(tasks, today) {
  const s = { total: tasks.length, todo: 0, in_progress: 0, done: 0, overdue: 0, lastDone: null };
  for (const t of tasks) {
    if (t.status === 'done') {
      s.done += 1;
      if (t.done_at && (!s.lastDone || String(t.done_at) > String(s.lastDone.done_at || ''))) s.lastDone = t;
    } else if (t.status === 'in_progress') s.in_progress += 1;
    else s.todo += 1;
    if (isOverdue(t, today)) s.overdue += 1;
  }
  return s;
}

export function groupByWorker(tasks) {
  const map = {};
  for (const t of tasks) (map[t.worker_id] = map[t.worker_id] || []).push(t);
  return map;
}

// filters: { worker: '' | user_id, status: '' | todo | in_progress | done,
//            when: '' | 'overdue' | 'upcoming' | 'recent',
//            pay: '' | 'owed' (Done, not paid yet) | 'paid' }
// Open jobs first (soonest main date first); finished jobs after, newest first.
export function filterJobs(tasks, filters, today, now = Date.now()) {
  const f = filters || {};
  const out = tasks.filter((t) => {
    if (f.worker && t.worker_id !== f.worker) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.when === 'overdue' && !isOverdue(t, today)) return false;
    if (f.when === 'upcoming') {
      const k = keyDate(t);
      if (t.status === 'done' || !k || dayDiff(k, today) < 0) return false;
    }
    if (f.when === 'recent' && !wasMarkedDoneRecently(t, now)) return false;
    if (f.pay === 'owed' && !(t.status === 'done' && t.pay_status !== 'paid')) return false;
    if (f.pay === 'paid' && t.pay_status !== 'paid') return false;
    return true;
  });
  const open = out.filter((t) => t.status !== 'done');
  const done = out.filter((t) => t.status === 'done');
  const byKey = (a, b) => {
    const ka = keyDate(a); const kb = keyDate(b);
    if (ka !== kb) { if (!ka) return 1; if (!kb) return -1; return ka < kb ? -1 : 1; }
    return String(a.title).localeCompare(String(b.title));
  };
  open.sort(byKey);
  done.sort((a, b) => String(b.done_at || b.updated_at || '').localeCompare(String(a.done_at || a.updated_at || '')));
  return [...open, ...done];
}

// "5 Oct, 3:20 pm" in the admin's own time zone
export function fmtStamp(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
