// worker/workerApp.js — the worker's own, lighter app shell. It is only ever
// opened for a signed-in worker (see bootstrap.js). It shares the Frame Flicks
// look but has none of the admin menu, and never loads admin code or data.
//
// Pages are listed in PAGES so later phases (Earnings) just add an entry here.

import { showToast } from '../toast.js';
import { escHtml } from '../format.js';
import { getSession, fetchProfile, logout } from '../cloud.js';
import { cachedTasks, fetchMyTasks, saveCachedTasks, setTaskStatus } from './workerData.js';
import { renderMyWork } from './myWork.js';
import { renderWorkerCalendar, resetCalendarView } from './workerCalendar.js';
import { renderWorkerSettings } from './workerSettings.js';
import { localToday, isClosed, ROLE_LABEL, STATUS_LABEL } from './workerView.js';

const PAGES = [
  { id: 'work', label: 'My Work', icon: '🎬' },
  { id: 'calendar', label: 'My Calendar', icon: '📅' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

const REFRESH_EVERY_MS = 60000;

let profile = null;
let page = 'work';
let wired = false;
let refreshing = false;
let state = { tasks: null, loading: true, error: null, offline: false, today: localToday(), pending: new Set() };
// Status changes that are being saved right now: job id -> the status we are saving.
// While one is in flight, a background refresh must not put the old status back.
const pendingOps = new Map();

const $ = (id) => document.getElementById(id);

function renderTabs() {
  $('waTabs').innerHTML = PAGES.map((p) => `
    <button class="wa-tab${p.id === page ? ' active' : ''}" data-page="${p.id}">
      <span class="wa-tab-ico">${p.icon}</span><span>${escHtml(p.label)}</span>
    </button>`).join('');
}

function renderPage() {
  const main = $('waMain');
  state.today = localToday();
  state.pending = new Set(pendingOps.keys());
  if (page === 'work') renderMyWork(main, state);
  else if (page === 'calendar') renderWorkerCalendar(main, state);
  else if (page === 'settings') renderWorkerSettings(main, { profile });
  if (page === 'work') showCardMsg();
}

function go(id) {
  if (!PAGES.some((p) => p.id === id)) return;
  page = id;
  renderTabs();
  renderPage();
  window.scrollTo(0, 0);
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  const spin = $('waRefresh');
  if (spin) spin.classList.add('spinning');
  try {
    const had = state.tasks !== null;
    const before = new Set((state.tasks || []).map((t) => t.id));
    const tasks = await fetchMyTasks();
    // An empty list is also what the database returns once the admin deactivates
    // this worker — so in that case, check, and sign them out if so.
    if (!tasks.length && await accountIsClosed()) {
      await logout();
      window.location.reload();
      return;
    }
    // Keep any status change that is still being saved (the server may not have it yet).
    const merged = tasks.map((t) => (pendingOps.has(t.id) ? { ...t, ...pendingOps.get(t.id) } : t));
    state = { ...state, tasks: merged, loading: false, error: null, offline: false };
    if (had) {
      const fresh = tasks.filter((t) => !before.has(t.id));
      if (fresh.length) showToast(fresh.length === 1 ? `New job: ${fresh[0].title}` : `${fresh.length} new jobs assigned to you`);
    }
  } catch (err) {
    state = { ...state, loading: false, error: err.message, offline: state.tasks !== null };
  } finally {
    refreshing = false;
    if (spin) spin.classList.remove('spinning');
    if (page === 'work' || page === 'calendar') renderPage();   // never redraw Settings: it would wipe a half-typed password
  }
}

// A short message on one job card. It is remembered for a few seconds so that a
// background refresh (which redraws the page) does not wipe it before it is read.
let cardMsg = null;   // { id, text, until }
const MSG_MS = 6000;

function showCardMsg() {
  if (!cardMsg) return false;
  if (Date.now() > cardMsg.until) { cardMsg = null; return false; }
  const card = Array.from(document.querySelectorAll('#waMain .wa-card')).find((c) => c.dataset.id === cardMsg.id);
  const box = card && card.querySelector('.wa-card-msg');
  if (!box) return false;
  box.textContent = cardMsg.text;
  box.hidden = false;
  return true;
}

function flash(id, text) {
  cardMsg = { id, text, until: Date.now() + MSG_MS };
  if (!showCardMsg()) { showToast(text); cardMsg = null; return; }
  setTimeout(() => {
    if (cardMsg && cardMsg.text === text && cardMsg.id === id) {
      const box = Array.from(document.querySelectorAll('#waMain .wa-card')).find((c) => c.dataset.id === id);
      const m = box && box.querySelector('.wa-card-msg');
      if (m) { m.hidden = true; m.textContent = ''; }
      cardMsg = null;
    }
  }, MSG_MS);
}

// A worker taps To do / In progress / Done. The card changes at once; if the
// server says no (or there is no internet) it goes back and says why.
async function changeStatus(id, status) {
  const t = (state.tasks || []).find((x) => x.id === id);
  if (!t || pendingOps.has(id) || t.status === status || !STATUS_LABEL[status]) return;
  if (isClosed(t)) { flash(id, 'This job is closed. Ask the admin if it needs to be re-opened.'); return; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    flash(id, 'You need internet to change status.');
    return;
  }

  const prev = { status: t.status, done_at: t.done_at || null, updated_at: t.updated_at };
  const next = { status, done_at: status === 'done' ? new Date().toISOString() : null };
  Object.assign(t, next);
  pendingOps.set(id, next);
  renderPage();

  try {
    const r = await setTaskStatus(id, status);
    pendingOps.delete(id);
    const cur = (state.tasks || []).find((x) => x.id === id);
    if (cur) Object.assign(cur, { status: r.status, done_at: r.done_at, updated_at: r.updated_at });
    saveCachedTasks(state.tasks || []);
    renderPage();
    showToast(`${t.title}: ${STATUS_LABEL[status]}`);
  } catch (err) {
    pendingOps.delete(id);
    const cur = (state.tasks || []).find((x) => x.id === id);
    if (cur) Object.assign(cur, prev);
    renderPage();
    flash(id, err.message || 'Could not change the status.');
    // If the account was closed or the job was removed, find out and update the screen.
    if (err.code === '42501' || err.code === 'P0002' || err.code === '55000') refresh();
  }
}

// True only when we can positively see the account is deactivated/removed.
// Any doubt (offline, error) means "not closed", so a flaky connection never logs anyone out.
async function accountIsClosed() {
  try {
    const session = await getSession();
    if (!session) return false;
    const me = await fetchProfile(session.user.id);
    return !me || me.active === false;
  } catch (e) { return false; }
}

const shellVisible = () => $('workerShell') && $('workerShell').style.display !== 'none';

function wireOnce() {
  if (wired) return;
  wired = true;
  $('waTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b) go(b.dataset.page);
  });
  $('waRefresh').addEventListener('click', () => refresh());
  $('waMain').addEventListener('click', (e) => {
    const b = e.target.closest('[data-set-status]');
    if (!b || b.disabled) return;
    const card = b.closest('.wa-card');
    if (card) changeStatus(card.dataset.id, b.dataset.setStatus);
  });
  // A newly assigned job should appear without anyone reloading:
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && shellVisible()) refresh(); });
  window.addEventListener('focus', () => { if (shellVisible()) refresh(); });
  window.addEventListener('online', () => { if (shellVisible()) refresh(); });
  setInterval(() => { if (document.visibilityState === 'visible' && shellVisible()) refresh(); }, REFRESH_EVERY_MS);
}

// Called by bootstrap.js. The caller shows the shell afterwards.
export async function bootWorker({ profile: p }) {
  profile = p;
  page = 'work';
  const cached = cachedTasks();
  pendingOps.clear();
  resetCalendarView();
  state = { tasks: cached, loading: cached === null, error: null, offline: false, today: localToday(), pending: new Set() };
  $('waHello').textContent = p.name ? `Hi ${p.name}` : 'Welcome';
  $('waRole').textContent = ROLE_LABEL[p.job_role] || '';
  $('waRole').style.display = p.job_role ? '' : 'none';
  wireOnce();
  renderTabs();
  renderPage();
  refresh();
}
