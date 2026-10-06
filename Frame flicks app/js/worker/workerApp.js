// worker/workerApp.js — the worker's own, lighter app shell. It is only ever
// opened for a signed-in worker (see bootstrap.js). It shares the Frame Flicks
// look but has none of the admin menu, and never loads admin code or data.
//
// Pages are listed in PAGES so later phases (Calendar, Earnings) just add an
// entry here.

import { showToast } from '../toast.js';
import { escHtml } from '../format.js';
import { getSession, fetchProfile, logout } from '../cloud.js';
import { cachedTasks, fetchMyTasks } from './workerData.js';
import { renderMyWork } from './myWork.js';
import { renderWorkerSettings } from './workerSettings.js';
import { localToday, ROLE_LABEL } from './workerView.js';

const PAGES = [
  { id: 'work', label: 'My Work', icon: '🎬' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

const REFRESH_EVERY_MS = 60000;

let profile = null;
let page = 'work';
let wired = false;
let refreshing = false;
let state = { tasks: null, loading: true, error: null, offline: false, today: localToday() };

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
  if (page === 'work') renderMyWork(main, state);
  else if (page === 'settings') renderWorkerSettings(main, { profile });
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
    state = { ...state, tasks, loading: false, error: null, offline: false };
    if (had) {
      const fresh = tasks.filter((t) => !before.has(t.id));
      if (fresh.length) showToast(fresh.length === 1 ? `New job: ${fresh[0].title}` : `${fresh.length} new jobs assigned to you`);
    }
  } catch (err) {
    state = { ...state, loading: false, error: err.message, offline: state.tasks !== null };
  } finally {
    refreshing = false;
    if (spin) spin.classList.remove('spinning');
    if (page === 'work') renderPage();   // never redraw Settings: it would wipe a half-typed password
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
  state = { tasks: cached, loading: cached === null, error: null, offline: false, today: localToday() };
  $('waHello').textContent = p.name ? `Hi ${p.name}` : 'Welcome';
  $('waRole').textContent = ROLE_LABEL[p.job_role] || '';
  $('waRole').style.display = p.job_role ? '' : 'none';
  wireOnce();
  renderTabs();
  renderPage();
  refresh();
}
