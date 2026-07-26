// pages/calendar.js — month view. Project deadlines and payment due dates
// are pulled automatically from existing project data (nothing to re-enter).
// Client meetings are the one thing added manually here, since there's no
// existing data source for those.

import { getIncome, getMeetings, saveMeetings, uid } from '../storage.js';
import { escHtml, currency } from '../format.js';
import { openModal, closeModal, openConfirm } from '../modal.js';
import { showToast } from '../toast.js';

let view = { year: new Date().getFullYear(), month: new Date().getMonth() }; // month: 0-11

function iso(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function eventsByDate() {
  const map = {};
  function add(dateStr, type, label) {
    if (!dateStr) return;
    (map[dateStr] = map[dateStr] || []).push({ type, label });
  }
  getIncome().forEach((p) => {
    if (!p.dueDate) return;
    add(p.dueDate, 'deadline', `Deliver — ${p.project || 'Project'}`);
    if (p.status !== 'Paid') add(p.dueDate, 'payment', `Payment due — ${p.project || 'Project'} (${currency(p.amount)})`);
  });
  getMeetings().forEach((m) => {
    add(m.date, 'meeting', `${m.title}${m.time ? ` — ${m.time}` : ''}`);
  });
  return map;
}

function monthLabel(y, m) {
  return new Date(y, m, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

function renderGrid() {
  document.getElementById('calMonthLabel').textContent = monthLabel(view.year, view.month);
  const map = eventsByDate();
  const grid = document.getElementById('calGrid');

  const firstOfMonth = new Date(view.year, view.month, 1);
  const startOffset = firstOfMonth.getDay(); // 0 = Sunday
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const daysInPrevMonth = new Date(view.year, view.month, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  const cells = [];
  for (let i = 0; i < startOffset; i++) {
    const d = daysInPrevMonth - startOffset + 1 + i;
    cells.push({ d, otherMonth: true, dateStr: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ d, otherMonth: false, dateStr: iso(view.year, view.month, d) });
  }
  let nextD = 1;
  while (cells.length < 42) {
    cells.push({ d: nextD, otherMonth: true, dateStr: null });
    nextD += 1;
  }

  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  grid.innerHTML = `
    <div class="cal-dow-row">${dow.map((d) => `<div class="cal-dow">${d}</div>`).join('')}</div>
    <div class="cal-cells">
      ${cells.map((c) => {
        const events = c.dateStr ? (map[c.dateStr] || []) : [];
        const isToday = c.dateStr === todayStr;
        const shown = events.slice(0, 3);
        const extra = events.length - shown.length;
        return `
          <div class="cal-cell${c.otherMonth ? ' other-month' : ''}${isToday ? ' today' : ''}" ${c.dateStr ? `data-date="${c.dateStr}"` : ''}>
            <div class="cal-cell-date">${c.d}</div>
            <div class="cal-cell-events">
              ${shown.map((ev) => `<div class="cal-pill cal-pill-${ev.type}" title="${escHtml(ev.label)}">${escHtml(ev.label)}</div>`).join('')}
              ${extra > 0 ? `<div class="cal-pill-more">+${extra} more</div>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>
  `;

  grid.querySelectorAll('.cal-cell[data-date]').forEach((cell) => {
    cell.addEventListener('click', () => openDayModal(cell.dataset.date, map[cell.dataset.date] || []));
  });
}

function openDayModal(dateStr, events) {
  const dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const body = document.createElement('div');

  function render() {
    const meetings = getMeetings().filter((m) => m.date === dateStr);
    const nonMeetingEvents = events.filter((ev) => ev.type !== 'meeting');
    body.innerHTML = `
      <div class="cal-day-events">
        ${nonMeetingEvents.length ? nonMeetingEvents.map((ev) => `
          <div class="cal-day-event">
            <span class="cal-dot cal-dot-${ev.type}"></span>
            <span>${escHtml(ev.label)}</span>
          </div>`).join('') : ''}
        ${meetings.map((m) => `
          <div class="cal-day-event">
            <span class="cal-dot cal-dot-meeting"></span>
            <span>${escHtml(m.title)}${m.time ? ` — ${escHtml(m.time)}` : ''}${m.client ? ` (${escHtml(m.client)})` : ''}</span>
            <button class="btn btn-icon btn-sm" data-del-meeting="${m.id}" title="Delete">🗑️</button>
          </div>`).join('')}
        ${!nonMeetingEvents.length && !meetings.length ? '<p class="muted">Nothing on this day yet.</p>' : ''}
      </div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="dayCloseBtn">Close</button>
        <button class="btn btn-primary" id="dayAddMeetingBtn">+ Add Meeting</button>
      </div>
    `;
    body.querySelector('#dayCloseBtn').addEventListener('click', closeModal);
    body.querySelector('#dayAddMeetingBtn').addEventListener('click', () => openMeetingModal(dateStr, () => { render(); refreshAfterChange(); }));
    body.querySelectorAll('[data-del-meeting]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openConfirm('Delete this meeting?', () => {
          saveMeetings(getMeetings().filter((m) => m.id !== btn.dataset.delMeeting));
          showToast('Meeting deleted');
          render();
          refreshAfterChange();
        });
      });
    });
  }

  render();
  openModal(dateLabel, body);
}

function refreshAfterChange() {
  renderGrid();
}

function openMeetingModal(defaultDate, onSaved) {
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-field"><label>Title</label><input type="text" id="mTitle" placeholder="e.g. Call with client"></div>
      <div class="form-field"><label>Client (optional)</label><input type="text" id="mClient"></div>
      <div class="form-field"><label>Date</label><input type="date" id="mDate" value="${defaultDate || new Date().toISOString().slice(0, 10)}"></div>
      <div class="form-field"><label>Time (optional)</label><input type="time" id="mTime"></div>
      <div class="form-field full"><label>Notes (optional)</label><textarea id="mNotes"></textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="mCancelBtn">Cancel</button>
        <button class="btn btn-primary" id="mSaveBtn">Save Meeting</button>
      </div>
    </div>
  `;
  openModal('Add Client Meeting', body);
  body.querySelector('#mCancelBtn').addEventListener('click', closeModal);
  body.querySelector('#mSaveBtn').addEventListener('click', () => {
    const title = body.querySelector('#mTitle').value.trim();
    const date = body.querySelector('#mDate').value;
    if (!title || !date) { showToast('Title and date are required'); return; }
    const list = getMeetings();
    list.push({
      id: uid(),
      title,
      client: body.querySelector('#mClient').value.trim(),
      date,
      time: body.querySelector('#mTime').value,
      notes: body.querySelector('#mNotes').value.trim(),
    });
    saveMeetings(list);
    showToast('Meeting added');
    closeModal();
    if (onSaved) onSaved(); else refreshAfterChange();
  });
}

export function init() {
  document.getElementById('calPrevBtn').addEventListener('click', () => {
    view.month -= 1;
    if (view.month < 0) { view.month = 11; view.year -= 1; }
    renderGrid();
  });
  document.getElementById('calNextBtn').addEventListener('click', () => {
    view.month += 1;
    if (view.month > 11) { view.month = 0; view.year += 1; }
    renderGrid();
  });
  document.getElementById('calTodayBtn').addEventListener('click', () => {
    const now = new Date();
    view = { year: now.getFullYear(), month: now.getMonth() };
    renderGrid();
  });
  document.getElementById('calAddMeetingBtn').addEventListener('click', () => openMeetingModal(null, refreshAfterChange));
  renderGrid();
}
