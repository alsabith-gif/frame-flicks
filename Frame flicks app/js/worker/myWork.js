// worker/myWork.js — the "My Work" page: this worker's jobs, grouped into
// Overdue / Today / Upcoming / Done. A worker only ever sees their own jobs
// (the database guarantees it). Shown on each card: title, client NAME,
// location, shoot date + time, deadline, their role, and status.
// Never shown: client phone, project price, anyone else's pay.

import { escHtml } from '../format.js';
import {
  groupTasks, fmtDay, fmtTime, relDay, dayDiff,
  STATUS_LABEL, STATUS_CLASS, ROLE_LABEL,
} from './workerView.js';

// Phase 4 replaces this badge with To do / In progress / Done buttons.
function statusHtml(t) {
  const s = STATUS_LABEL[t.status] ? t.status : 'todo';
  return `<span class="badge ${STATUS_CLASS[s]}" data-status="${s}">${STATUS_LABEL[s]}</span>`;
}

export function taskCardHtml(t, today) {
  const done = t.status === 'done';
  const lines = [];

  if (t.shoot_date || t.shoot_time) {
    const when = [t.shoot_date ? fmtDay(t.shoot_date) : '', t.shoot_time ? fmtTime(t.shoot_time) : ''].filter(Boolean).join(' · ');
    const rel = t.shoot_date && !done ? ` <span class="wa-rel">(${escHtml(relDay(t.shoot_date, today))})</span>` : '';
    lines.push(`<div class="wa-line"><span class="wa-ico">🎬</span><span><b>Shoot</b> ${escHtml(when)}${rel}</span></div>`);
  }
  if (t.location) {
    lines.push(`<div class="wa-line"><span class="wa-ico">📍</span><span>${escHtml(t.location)}</span></div>`);
  }
  if (t.due_date) {
    const late = !done && dayDiff(t.due_date, today) < 0;
    const rel = !done ? ` <span class="wa-rel">(${escHtml(relDay(t.due_date, today))})</span>` : '';
    lines.push(`<div class="wa-line${late ? ' wa-late' : ''}"><span class="wa-ico">⏰</span><span><b>Deadline</b> ${escHtml(fmtDay(t.due_date))}${rel}</span></div>`);
  }
  if (t.notes) {
    lines.push(`<div class="wa-line wa-notes"><span class="wa-ico">📝</span><span>${escHtml(t.notes)}</span></div>`);
  }

  return `
    <article class="wa-card${done ? ' is-done' : ''}" data-id="${escHtml(t.id)}">
      <div class="wa-card-top">
        <div>
          <h3 class="wa-title">${escHtml(t.title)}</h3>
          ${t.client_name ? `<div class="wa-client">${escHtml(t.client_name)}</div>` : ''}
        </div>
        <span class="badge ${t.role === 'editor' ? 'badge-amber' : 'badge-purple'}">${escHtml(ROLE_LABEL[t.role] || t.role)}</span>
      </div>
      <div class="wa-lines">${lines.join('')}</div>
      <div class="wa-card-foot">${statusHtml(t)}</div>
    </article>`;
}

function sectionHtml(title, cls, tasks, today) {
  if (!tasks.length) return '';
  return `
    <section class="wa-section ${cls}">
      <h2 class="wa-h2">${title} <span class="wa-count">${tasks.length}</span></h2>
      ${tasks.map((t) => taskCardHtml(t, today)).join('')}
    </section>`;
}

// state: { tasks: array|null, loading, error, offline, today }
export function renderMyWork(root, state) {
  const { tasks, loading, error, offline, today } = state;
  let html = '';

  if (error && !tasks) {
    html = `<div class="wa-empty"><div class="wa-empty-ico">⚠️</div><p>${escHtml(error)}</p><p class="muted">Pull the refresh button above to try again.</p></div>`;
  } else if (!tasks && loading) {
    html = '<div class="wa-empty"><p class="muted">Loading your jobs…</p></div>';
  } else {
    if (offline) html += '<div class="wa-banner">You are offline — showing your last saved jobs.</div>';
    const g = groupTasks(tasks || [], today);
    if (!tasks.length) {
      html += `<div class="wa-empty"><div class="wa-empty-ico">🎬</div>
        <p><b>No jobs yet.</b></p>
        <p class="muted">When the admin gives you a job, it will show up here.</p></div>`;
    } else {
      html += sectionHtml('Overdue', 'wa-sec-overdue', g.overdue, today);
      html += sectionHtml('Today', 'wa-sec-today', g.today, today);
      html += sectionHtml('Upcoming', 'wa-sec-upcoming', g.upcoming, today);
      if (!g.overdue.length && !g.today.length && !g.upcoming.length) {
        html += '<div class="wa-empty"><div class="wa-empty-ico">✅</div><p><b>All caught up.</b></p><p class="muted">No open jobs right now.</p></div>';
      }
      if (g.done.length) {
        html += `<details class="wa-done"><summary>Done <span class="wa-count">${g.done.length}</span></summary>${g.done.map((t) => taskCardHtml(t, today)).join('')}</details>`;
      }
    }
  }
  root.innerHTML = html;
}
