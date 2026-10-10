// worker/myEarnings.js — the "My Earnings" tab. A worker sees ONLY their own
// jobs' pay (the database never sends anyone else's). Pay is shown here and
// nowhere else in the worker app. Read-only: there is nothing to edit.

import { escHtml } from '../format.js';
import { fmtDay } from './workerView.js';
import { summarizeEarnings, monthlyEarnings, earnedDay, money } from './earningsCalc.js';

function jobLine(t) {
  const day = earnedDay(t);
  const paid = t.pay_status === 'paid';
  return `
    <div class="wa-earn-job">
      <div class="wa-earn-job-main">
        <div class="wa-earn-job-title">${escHtml(t.title)}</div>
        <div class="wa-earn-job-sub">${day ? `Finished ${escHtml(fmtDay(day))}` : 'Finished'}</div>
      </div>
      <div class="wa-earn-job-side">
        <div class="wa-earn-job-amt">${escHtml(money(t.pay_amount))}</div>
        <span class="badge ${paid ? 'badge-green' : 'badge-amber'}">${paid ? `Paid${t.paid_on ? ' ' + escHtml(fmtDay(t.paid_on)) : ''}` : 'Not paid yet'}</span>
      </div>
    </div>`;
}

// state: the same object My Work uses: { tasks, loading, error, offline }
export function renderMyEarnings(root, state) {
  const { tasks, loading, error, offline } = state;
  const wasOpen = new Set(Array.from(root.querySelectorAll('details.wa-earn-month[open]')).map((d) => d.dataset.month));

  if (error && !tasks) {
    root.innerHTML = `<div class="wa-empty"><div class="wa-empty-ico">⚠️</div><p>${escHtml(error)}</p><p class="muted">Use the refresh button above to try again.</p></div>`;
    return;
  }
  if (!tasks && loading) {
    root.innerHTML = '<div class="wa-empty"><p class="muted">Loading your earnings…</p></div>';
    return;
  }

  const sum = summarizeEarnings(tasks || []);
  const months = monthlyEarnings(tasks || []);
  const banner = offline ? '<div class="wa-banner">You are offline — showing your last saved jobs.</div>' : '';

  if (!sum.done) {
    root.innerHTML = `${banner}
      <div class="wa-empty">
        <div class="wa-empty-ico">💰</div>
        <p>Nothing earned yet.</p>
        <p class="muted">When you mark a job <b>Done</b> on My Work, it counts here.</p>
      </div>`;
    return;
  }

  root.innerHTML = `${banner}
    <div class="wa-earn-tiles">
      <div class="wa-earn-tile"><div class="wa-earn-label">Jobs completed</div><div class="wa-earn-value">${sum.done}</div></div>
      <div class="wa-earn-tile"><div class="wa-earn-label">Earned</div><div class="wa-earn-value">${escHtml(money(sum.earned))}</div></div>
      <div class="wa-earn-tile"><div class="wa-earn-label">Paid</div><div class="wa-earn-value wa-earn-green">${escHtml(money(sum.paid))}</div></div>
      <div class="wa-earn-tile${sum.owed ? ' is-owed' : ''}"><div class="wa-earn-label">Still owed</div><div class="wa-earn-value">${escHtml(money(sum.owed))}</div></div>
    </div>
    <p class="muted wa-earn-note">Earned counts the jobs you marked <b>Done</b>. Paid is what the admin has recorded as paid.</p>
    <h2 class="wa-h2">By month</h2>
    ${months.map((m) => `
      <details class="wa-earn-month" data-month="${escHtml(m.key)}"${wasOpen.has(m.key) ? ' open' : ''}>
        <summary>
          <span class="wa-earn-month-name">${escHtml(m.label)}</span>
          <span class="wa-earn-month-meta">${m.count} job${m.count === 1 ? '' : 's'} · ${escHtml(money(m.earned))}</span>
        </summary>
        <div class="wa-earn-month-body">
          <div class="wa-earn-month-split">
            <span>Paid <b>${escHtml(money(m.paid))}</b></span>
            <span>Still owed <b>${escHtml(money(m.owed))}</b></span>
          </div>
          ${m.jobs.map(jobLine).join('')}
        </div>
      </details>`).join('')}`;
}
