// worker/workerCalendar.js — "My Calendar": a month grid of THIS worker's own
// jobs. Read-only on purpose: you can look and tap a day for details, but
// nothing can be added, edited, moved or deleted here (status is changed on
// My Work). Shoot days are the main marks; deadlines are smaller marks.
// Never shown: client phone, project price, anyone else's jobs or pay.

import { escHtml } from '../format.js';
import {
  calendarMarks, monthCells, monthLabel, fmtLongDay, fmtTime, relDay, localToday,
  STATUS_LABEL, STATUS_CLASS, ROLE_LABEL,
} from './workerView.js';

const nowParts = () => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; };
let view = nowParts();     // which month is showing (survives tab switches and refreshes)
let selected = null;       // the tapped day, 'YYYY-MM-DD'

export function resetCalendarView() { view = nowParts(); selected = null; }

function dayCard(mark, today) {
  const t = mark.task;
  const done = t.status === 'done';
  const s = STATUS_LABEL[t.status] ? t.status : 'todo';
  const isShoot = mark.type === 'shoot';
  const when = isShoot && t.shoot_time ? ` · ${fmtTime(t.shoot_time)}` : '';
  const rel = !done ? ` <span class="wa-rel">(${escHtml(relDay(isShoot ? t.shoot_date : t.due_date, today))})</span>` : '';
  return `
    <div class="wa-cal-item${done ? ' is-done' : ''}">
      <span class="wa-cal-dot wa-cal-dot-${mark.type}" aria-hidden="true"></span>
      <div class="wa-cal-item-main">
        <div class="wa-cal-item-title">${escHtml(t.title)}</div>
        <div class="wa-cal-item-sub">${isShoot ? '🎬 Shoot' : '⏰ Deadline'}${escHtml(when)}${rel}${t.location && isShoot ? ` · 📍 ${escHtml(t.location)}` : ''}</div>
        ${t.client_name ? `<div class="wa-cal-item-sub">${escHtml(t.client_name)}</div>` : ''}
      </div>
      <div class="wa-cal-item-badges">
        <span class="badge ${t.role === 'editor' ? 'badge-amber' : 'badge-purple'}">${escHtml(ROLE_LABEL[t.role] || t.role)}</span>
        <span class="badge ${STATUS_CLASS[s]}">${STATUS_LABEL[s]}</span>
      </div>
    </div>`;
}

function dayPanel(marks, today) {
  if (!selected) return '<p class="muted wa-cal-hint">Tap a day to see its jobs.</p>';
  const list = marks[selected] || [];
  return `
    <h3 class="wa-h2 wa-cal-daytitle">${escHtml(fmtLongDay(selected))}</h3>
    ${list.length ? list.map((m) => dayCard(m, today)).join('') : '<p class="muted">Nothing on this day.</p>'}`;
}

// state: the same object My Work uses: { tasks, loading, error, offline, today }
export function renderWorkerCalendar(root, state) {
  const { tasks, loading, error, offline } = state;
  const today = state.today || localToday();

  if (error && !tasks) {
    root.innerHTML = `<div class="wa-empty"><div class="wa-empty-ico">⚠️</div><p>${escHtml(error)}</p><p class="muted">Use the refresh button above to try again.</p></div>`;
    return;
  }
  if (!tasks && loading) {
    root.innerHTML = '<div class="wa-empty"><p class="muted">Loading your calendar…</p></div>';
    return;
  }

  const marks = calendarMarks(tasks || []);
  const cells = monthCells(view.year, view.month);
  const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  root.innerHTML = `
    ${offline ? '<div class="wa-banner">You are offline — showing your last saved jobs.</div>' : ''}
    <div class="wa-cal-nav">
      <button type="button" class="btn btn-icon" data-cal="prev" aria-label="Previous month">‹</button>
      <div class="wa-cal-month">${escHtml(monthLabel(view.year, view.month))}</div>
      <button type="button" class="btn btn-icon" data-cal="next" aria-label="Next month">›</button>
      <button type="button" class="btn btn-ghost btn-sm" data-cal="today">Today</button>
    </div>
    <div class="wa-cal-legend">
      <span><i class="wa-cal-dot wa-cal-dot-shoot"></i>Shoot day</span>
      <span><i class="wa-cal-dot wa-cal-dot-deadline"></i>Deadline</span>
    </div>
    <div class="wa-cal-grid">
      <div class="wa-cal-dow">${dow.map((d) => `<div>${d}</div>`).join('')}</div>
      <div class="wa-cal-cells">
        ${cells.map((c) => {
          if (!c.date) return `<div class="wa-cal-cell is-blank"><span class="wa-cal-num">${c.d}</span></div>`;
          const list = marks[c.date] || [];
          const shoots = list.filter((m) => m.type === 'shoot');
          const deadlines = list.filter((m) => m.type === 'deadline');
          const allDone = list.length > 0 && list.every((m) => m.task.status === 'done');
          const label = `${fmtLongDay(c.date)}${list.length ? `, ${list.length} item${list.length === 1 ? '' : 's'}` : ''}`;
          return `
            <button type="button" class="wa-cal-cell${c.date === today ? ' is-today' : ''}${c.date === selected ? ' is-selected' : ''}${allDone ? ' all-done' : ''}" data-date="${c.date}" aria-label="${escHtml(label)}">
              <span class="wa-cal-num">${c.d}</span>
              <span class="wa-cal-marks">
                ${shoots.slice(0, 2).map((m) => `<span class="wa-cal-mark wa-cal-mark-shoot${m.task.status === 'done' ? ' is-done' : ''}">${escHtml(m.task.title)}</span>`).join('')}
                ${shoots.length > 2 ? `<span class="wa-cal-more">+${shoots.length - 2}</span>` : ''}
                ${deadlines.length ? `<span class="wa-cal-mark wa-cal-mark-deadline${deadlines.every((m) => m.task.status === 'done') ? ' is-done' : ''}" title="Deadline"></span>` : ''}
              </span>
            </button>`;
        }).join('')}
      </div>
    </div>
    <section class="wa-cal-day" id="waCalDay">${dayPanel(marks, today)}</section>`;

  const redraw = () => renderWorkerCalendar(root, state);
  root.querySelector('[data-cal="prev"]').addEventListener('click', () => {
    view = view.month === 0 ? { year: view.year - 1, month: 11 } : { year: view.year, month: view.month - 1 };
    selected = null; redraw();
  });
  root.querySelector('[data-cal="next"]').addEventListener('click', () => {
    view = view.month === 11 ? { year: view.year + 1, month: 0 } : { year: view.year, month: view.month + 1 };
    selected = null; redraw();
  });
  root.querySelector('[data-cal="today"]').addEventListener('click', () => {
    view = nowParts(); selected = today; redraw();
  });
  root.querySelectorAll('.wa-cal-cell[data-date]').forEach((cell) => {
    cell.addEventListener('click', () => {
      selected = cell.dataset.date;
      redraw();
      const panel = root.querySelector('#waCalDay');
      if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });
}
