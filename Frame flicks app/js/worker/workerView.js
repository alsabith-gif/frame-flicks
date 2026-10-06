// worker/workerView.js — pure helpers for the worker app (no DOM, no network),
// so the date/grouping rules can be tested on their own.
//
// All dates are plain "YYYY-MM-DD" strings and are compared as calendar days
// (never as moments in time), so a shoot on the 12th is the 12th everywhere.

export function localToday(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function parts(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}

// Days from `today` to `ymd` (negative = in the past). null if no/invalid date.
export function dayDiff(ymd, today) {
  const a = parts(ymd); const b = parts(today);
  if (!a || !b) return null;
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86400000);
}

export function fmtDay(ymd) {
  const p = parts(ymd);
  if (!p) return '';
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

// "09:30" or "09:30:00" -> "9:30 AM"
export function fmtTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return '';
  let h = +m[1];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}

export function relDay(ymd, today) {
  const n = dayDiff(ymd, today);
  if (n === null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

// The date a job is mainly about: the shoot for camera work, the deadline
// for editing (each falls back to the other if it is missing).
export function keyDate(t) {
  return t.role === 'editor' ? (t.due_date || t.shoot_date || null) : (t.shoot_date || t.due_date || null);
}

const byDateThenTime = (a, b) => {
  const ka = keyDate(a); const kb = keyDate(b);
  if (ka !== kb) { if (!ka) return 1; if (!kb) return -1; return ka < kb ? -1 : 1; }
  const ta = a.shoot_time || '99:99'; const tb = b.shoot_time || '99:99';
  return ta < tb ? -1 : ta > tb ? 1 : String(a.title).localeCompare(String(b.title));
};

// Sorts a worker's jobs into the sections My Work shows.
export function groupTasks(tasks, today) {
  const out = { today: [], overdue: [], upcoming: [], done: [] };
  for (const t of tasks) {
    if (t.status === 'done') { out.done.push(t); continue; }
    const key = keyDate(t);
    if (t.shoot_date === today || t.due_date === today) out.today.push(t);
    else if (key && key < today) out.overdue.push(t);
    else out.upcoming.push(t);
  }
  out.today.sort(byDateThenTime);
  out.overdue.sort(byDateThenTime);
  out.upcoming.sort(byDateThenTime);
  out.done.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return out;
}

export const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
export const STATUS_CLASS = { todo: 'badge-muted', in_progress: 'badge-blue', done: 'badge-green' };
export const ROLE_LABEL = { camera: 'Camera', editor: 'Editor' };
