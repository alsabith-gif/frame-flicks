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

// ---------------------------------------------------------------------------
// Phase 4 additions

// A job the admin has settled can no longer be re-opened by the worker (the
// database enforces this too). The screen only says "closed" — never why.
export function isClosed(t) {
  return t.pay_status === 'paid' && t.status === 'done';
}

const pad2 = (n) => String(n).padStart(2, '0');
export const ymd = (y, m0, d) => `${y}-${pad2(m0 + 1)}-${pad2(d)}`;

// What the My Calendar tab marks: a SHOOT mark on the shoot day (the main
// mark) and a smaller DEADLINE mark on the deadline day. One job can give
// both. Returns { 'YYYY-MM-DD': [{ type: 'shoot'|'deadline', task }] }
// with shoots listed before deadlines on each day.
export function calendarMarks(tasks) {
  const map = {};
  const add = (date, type, task) => {
    if (!parts(date)) return;
    const key = String(date).slice(0, 10);
    (map[key] = map[key] || []).push({ type, task });
  };
  for (const t of tasks || []) {
    add(t.shoot_date, 'shoot', t);
    add(t.due_date, 'deadline', t);
  }
  const rank = { shoot: 0, deadline: 1 };
  for (const list of Object.values(map)) {
    list.sort((a, b) => rank[a.type] - rank[b.type]
      || String(a.task.shoot_time || '99:99').localeCompare(String(b.task.shoot_time || '99:99'))
      || String(a.task.title).localeCompare(String(b.task.title)));
  }
  return map;
}

// The 42 cells (6 weeks, Sunday first) of a month grid. month0 is 0-11.
// Cells outside the month have date = null (they are blank, like the admin calendar).
export function monthCells(year, month0) {
  const startOffset = new Date(year, month0, 1).getDay();
  const days = new Date(year, month0 + 1, 0).getDate();
  const prevDays = new Date(year, month0, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push({ d: prevDays - startOffset + 1 + i, date: null });
  for (let d = 1; d <= days; d++) cells.push({ d, date: ymd(year, month0, d) });
  for (let n = 1; cells.length < 42; n++) cells.push({ d: n, date: null });
  return cells;
}

export function monthLabel(year, month0) {
  return new Date(year, month0, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
export function fmtLongDay(date) {
  const p = parts(date);
  if (!p) return '';
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}
