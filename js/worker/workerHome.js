// worker/workerHome.js — the "Home" tab, kept simple: ONE big "Your next job" card with an
// Open button, a short "This week" list, and one line "Owed to you ₹X". Read-only (status is changed on the Works tab).
// Only this worker's own jobs are ever here (the database guarantees it).

import { escHtml } from '../format.js';
import { groupTasks, fmtDay, fmtTime, relDay, dayDiff, ROLE_LABEL } from './workerView.js';
import { summarizeEarnings, money } from './earningsCalc.js';

// Small label for a job's day: Overdue / Today / Tomorrow / a date.
function dayLabel(t, today) {
  const key = t.shoot_date || t.due_date;
  if (!key) return { text: 'No date', cls: '' };
  if (t.shoot_date === today || t.due_date === today) return { text: 'Today', cls: 'is-today' };
  if (key < today) return { text: 'Overdue', cls: 'is-late' };
  return { text: relDay(key, today), cls: '' };
}

// The ONE job to look at first: today's (earliest first), else the oldest overdue, else the next coming up.
export function pickNextJob(tasks, today) {
  const g = groupTasks(tasks || [], today);
  return g.today[0] || g.overdue[0] || g.upcoming[0] || null;
}

function bigJob(t, today) {
  const when = [t.shoot_date ? fmtDay(t.shoot_date) : '', t.shoot_time ? fmtTime(t.shoot_time) : ''].filter(Boolean).join(' · ');
  const lab = dayLabel(t, today);
  return `
    <section class="wa-panel wa-next">
      <div class="wa-next-top"><h2 class="wa-h2">Your next job</h2><span class="wa-tag ${lab.cls}">${escHtml(lab.text)}</span></div>
      <div class="wa-title wa-next-title">${escHtml(t.title)}</div>
      <div class="wa-client">${escHtml([t.client_name, ROLE_LABEL[t.role] || t.role].filter(Boolean).join(' · '))}</div>
      ${t.location ? `<div class="wa-line"><span class="wa-ico">📍</span><span>${escHtml(t.location)}</span></div>` : ''}
      ${when ? `<div class="wa-line"><span class="wa-ico">🎬</span><span>${escHtml(when)}</span></div>` : ''}
      <button type="button" class="btn btn-primary wa-next-btn" data-go="work" data-job="${escHtml(t.id)}">Open</button>
    </section>`;
}

function weekRow(t, today) {
  const lab = dayLabel(t, today);
  return `<button type="button" class="wa-week-row" data-go="work" data-job="${escHtml(t.id)}">
      <span class="wa-week-main"><span class="wa-week-title">${escHtml(t.title)}</span><span class="wa-week-sub">${escHtml([t.client_name, ROLE_LABEL[t.role] || t.role].filter(Boolean).join(' · '))}</span></span>
      <span class="wa-tag ${lab.cls}">${escHtml(lab.text)}</span>
    </button>`;
}

// The soonest open job whose shoot day is after today (today's jobs are listed above it).
export function nextShoot(tasks, today) {
  return (tasks || [])
    .filter((t) => t.status !== 'done' && t.shoot_date && dayDiff(t.shoot_date, today) > 0)
    .sort((a, b) => a.shoot_date.localeCompare(b.shoot_date) || String(a.shoot_time || '').localeCompare(String(b.shoot_time || '')))[0] || null;
}

// state: { tasks, loading, error, offline, today }
export function renderWorkerHome(root, state, profile) {
  const { tasks, loading, error, offline, today } = state;
  if (error && !tasks) {
    root.innerHTML = `<div class="wa-empty"><div class="wa-empty-ico">⚠️</div><p>${escHtml(error)}</p><p class="muted">Use the refresh button above to try again.</p></div>`;
    return;
  }
  if (!tasks && loading) { root.innerHTML = '<div class="wa-empty"><p class="muted">Loading…</p></div>'; return; }

  const all = tasks || [];
  const next = pickNextJob(all, today);
  const e = summarizeEarnings(all);
  let html = offline ? '<div class="wa-banner">You are offline — showing your last saved jobs.</div>' : '';

  html += next
    ? bigJob(next, today)
    : `<section class="wa-panel wa-next"><h2 class="wa-h2">Your next job</h2><p class="wa-caught">You are all caught up 🎉</p><p class="muted">New jobs show up here by themselves.</p></section>`;

  // This week: other open jobs that are overdue or fall in the next 7 days (max 5).
  const week = all
    .filter((t) => t.status !== 'done' && (!next || t.id !== next.id))
    .filter((t) => { const key = t.shoot_date || t.due_date; return key && dayDiff(key, today) <= 7; })
    .sort((a, b) => String(a.shoot_date || a.due_date).localeCompare(String(b.shoot_date || b.due_date)));
  if (week.length) {
    html += `<section class="wa-panel"><h2 class="wa-h2">This week</h2>
      ${week.slice(0, 5).map((t) => weekRow(t, today)).join('')}
      ${week.length > 5 ? `<p><button type="button" class="btn btn-ghost btn-sm" data-go="work">See all my jobs (${week.length})</button></p>` : ''}
    </section>`;
  }

  html += `<button type="button" class="wa-owed" data-go="earnings">
      <span>${e.owed > 0 ? 'Owed to you' : 'Nothing owed to you'}</span>${e.owed > 0 ? `<b>${escHtml(money(e.owed))}</b>` : ''}<span class="wa-owed-go">Earnings ›</span>
    </button>`;

  root.innerHTML = html;
}
