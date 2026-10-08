// worker/myWork.js — the "My Work" page: this worker's jobs, grouped into
// Overdue / Today / Upcoming / Done. Each card has a To do / In progress / Done
// control (Phase 4). A worker only ever sees their own jobs
// (the database guarantees it). Shown on each card: title, client NAME,
// location, shoot date + time, deadline, their role, and status.
// Never shown: client phone, project price, anyone else's pay.

import { escHtml } from '../format.js';
import {
  groupTasks, fmtDay, fmtTime, relDay, dayDiff, isClosed,
  STATUS_LABEL, ROLE_LABEL,
} from './workerView.js';

const STATUS_ORDER = ['todo', 'in_progress', 'done'];

// The To do / In progress / Done control. Tapping a button is handled by
// workerApp.js (event delegation on data-set-status). While a change is being
// saved the buttons are switched off so a double tap cannot send two calls.
// A closed job (settled by the admin) cannot be re-opened by the worker.
function statusHtml(t, pending) {
  const current = STATUS_LABEL[t.status] ? t.status : 'todo';
  const closed = isClosed(t);
  const buttons = STATUS_ORDER.map((s) => {
    const on = s === current;
    return `<button type="button" class="wa-st wa-st-${s}${on ? ' is-on' : ''}" data-set-status="${s}" aria-pressed="${on}"${pending || closed ? ' disabled' : ''}>${STATUS_LABEL[s]}</button>`;
  }).join('');
  return `
    <div class="wa-status${pending ? ' is-saving' : ''}" role="group" aria-label="Job status" data-status="${current}"${pending ? ' aria-busy="true"' : ''}>${buttons}</div>
    ${closed ? '<p class="wa-closed">Closed — ask the admin if this job needs to be re-opened.</p>' : ''}
    <p class="wa-card-msg" role="alert" hidden></p>`;
}

export function taskCardHtml(t, today, pending = false) {
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
      <div class="wa-card-foot">${statusHtml(t, pending)}</div>
    </article>`;
}

function sectionHtml(title, cls, tasks, today, pending) {
  if (!tasks.length) return '';
  return `
    <section class="wa-section ${cls}">
      <h2 class="wa-h2">${title} <span class="wa-count">${tasks.length}</span></h2>
      ${tasks.map((t) => taskCardHtml(t, today, pending.has(t.id))).join('')}
    </section>`;
}

// state: { tasks: array|null, loading, error, offline, today, pending?: Set<id> }
export function renderMyWork(root, state) {
  const { tasks, loading, error, offline, today } = state;
  const pending = state.pending || new Set();
  // Keep the "Done" drawer open across redraws (a status change redraws the page).
  const doneWasOpen = !!root.querySelector('details.wa-done[open]');
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
      html += sectionHtml('Overdue', 'wa-sec-overdue', g.overdue, today, pending);
      html += sectionHtml('Today', 'wa-sec-today', g.today, today, pending);
      html += sectionHtml('Upcoming', 'wa-sec-upcoming', g.upcoming, today, pending);
      if (!g.overdue.length && !g.today.length && !g.upcoming.length) {
        html += '<div class="wa-empty"><div class="wa-empty-ico">✅</div><p><b>All caught up.</b></p><p class="muted">No open jobs right now.</p></div>';
      }
      if (g.done.length) {
        html += `<details class="wa-done"${doneWasOpen ? ' open' : ''}><summary>Done <span class="wa-count">${g.done.length}</span></summary>${g.done.map((t) => taskCardHtml(t, today, pending.has(t.id))).join('')}</details>`;
      }
    }
  }
  root.innerHTML = html;
}
