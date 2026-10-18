// worker/workerHome.js — the "Home" tab: a quick look at today. Greeting is in the
// header; here: today's jobs, the next shoot, what is still to finish, and the
// worker's OWN earnings snapshot. Read-only (status is changed on the Works tab).
// Only this worker's own jobs are ever here (the database guarantees it).

import { escHtml } from '../format.js';
import { groupTasks, fmtDay, fmtTime, relDay, dayDiff, ROLE_LABEL } from './workerView.js';
import { summarizeEarnings, money } from './earningsCalc.js';

function miniJob(t, today) {
  const when = [t.shoot_date ? fmtDay(t.shoot_date) : '', t.shoot_time ? fmtTime(t.shoot_time) : ''].filter(Boolean).join(' · ');
  return `
    <div class="wa-home-job">
      <div class="wa-home-job-main">
        <div class="wa-title">${escHtml(t.title)}</div>
        <div class="wa-client">${escHtml([t.client_name, ROLE_LABEL[t.role] || t.role].filter(Boolean).join(' · '))}</div>
        ${t.location ? `<div class="wa-line"><span class="wa-ico">📍</span><span>${escHtml(t.location)}</span></div>` : ''}
        ${when ? `<div class="wa-line"><span class="wa-ico">🎬</span><span>${escHtml(when)} <span class="wa-rel">(${escHtml(relDay(t.shoot_date || today, today))})</span></span></div>` : ''}
      </div>
    </div>`;
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
  const g = groupTasks(all, today);
  const open = g.overdue.length + g.today.length + g.upcoming.length;
  const next = nextShoot(all, today);
  const e = summarizeEarnings(all);
  let html = offline ? '<div class="wa-banner">You are offline — showing your last saved jobs.</div>' : '';

  html += `<section class="wa-panel wa-home-stats">
      <div class="wa-stat"><b>${g.today.length}</b><span>Today</span></div>
      <div class="wa-stat${g.overdue.length ? ' is-late' : ''}"><b>${g.overdue.length}</b><span>Overdue</span></div>
      <div class="wa-stat"><b>${open}</b><span>To finish</span></div>
    </section>`;

  html += `<section class="wa-panel"><h2 class="wa-h2">Today's jobs <span class="wa-count">${g.today.length}</span></h2>
      ${g.today.length ? g.today.map((t) => miniJob(t, today)).join('') : '<p class="muted">Nothing scheduled for today.</p>'}
    </section>`;

  html += `<section class="wa-panel"><h2 class="wa-h2">Next shoot</h2>
      ${next ? miniJob(next, today) : '<p class="muted">No upcoming shoot.</p>'}
    </section>`;

  if (g.overdue.length) {
    html += `<section class="wa-panel wa-sec-overdue"><h2 class="wa-h2">Still to finish — overdue <span class="wa-count">${g.overdue.length}</span></h2>
      ${g.overdue.map((t) => miniJob(t, today)).join('')}
    </section>`;
  }

  html += `<section class="wa-panel"><h2 class="wa-h2">My earnings</h2>
      ${e.done
    ? `<div class="wa-earn">
          <span class="wa-pill">Earned <b>${escHtml(money(e.earned))}</b></span>
          <span class="wa-pill">Paid <b>${escHtml(money(e.paid))}</b></span>
          <span class="wa-pill">Still owed <b>${escHtml(money(e.owed))}</b></span>
        </div>`
    : '<p class="muted">No finished jobs yet.</p>'}
      <p><button type="button" class="btn btn-ghost btn-sm" data-go="earnings">See earnings</button>
         <button type="button" class="btn btn-ghost btn-sm" data-go="work">Open my jobs</button></p>
    </section>`;

  root.innerHTML = html;
}
