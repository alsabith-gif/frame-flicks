// pages/workers.js — admin-only: add, edit, deactivate and reset your crew's
// logins. Reading the list is a normal database query (only an admin is
// allowed to read other people's profiles). Anything that creates or changes
// an account goes through the admin-create-worker edge function, which holds
// the admin key on the server — never in this browser.

import { supabase, callWorkerAdmin } from '../cloud.js';
import { openModal, closeModal, openConfirm } from '../modal.js';
import { showToast } from '../toast.js';
import { escHtml } from '../format.js';
import { localToday, fmtDay, fmtTime, relDay, STATUS_LABEL, STATUS_CLASS } from '../worker/workerView.js';
import { summarize, groupByWorker, filterJobs, isOverdue, wasMarkedDoneRecently, fmtStamp } from '../crewOverview.js';

const ROLE_LABEL = { camera: 'Camera', editor: 'Editor' };
// Pay columns are deliberately not requested here (Phase 5 adds the earnings view).
const TASK_COLS = 'id, project_id, worker_id, role, title, client_name, location, shoot_date, shoot_time, due_date, status, done_at, updated_at';
let workers = [];
let lastSignIn = {};
let tasks = [];
let tasksLoaded = false;
let tasksError = '';
let tasksLoadedAt = null;
let filters = { worker: '', status: '', when: '' };
let focusWired = false;

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function setNotice(message, { error = false } = {}) {
  const box = document.getElementById('wkNotice');
  if (!box) return;
  if (!message) { box.style.display = 'none'; box.textContent = ''; return; }
  box.className = 'wk-notice' + (error ? ' error' : '');
  box.innerHTML = `<span>${escHtml(message)}</span><button type="button" aria-label="Dismiss">✕</button>`;
  box.querySelector('button').addEventListener('click', () => setNotice(''));
  box.style.display = '';
}

function loginLine(w) {
  if (!w.active) return 'Deactivated — cannot log in';
  const when = fmtDate(lastSignIn[w.user_id]);
  return when ? `Last logged in ${when}` : "Hasn't logged in yet";
}

function summaryHtml(w, today) {
  if (!tasksLoaded) return '';
  const mine = groupByWorker(tasks)[w.user_id] || [];
  if (!mine.length) return '<div class="wk-sum wk-sum-none">No jobs assigned</div>';
  const s = summarize(mine, today);
  const last = s.lastDone
    ? `<div class="wk-lastdone">✅ Last marked done: <b>${escHtml(s.lastDone.title)}</b> · ${escHtml(fmtStamp(s.lastDone.done_at))}</div>` : '';
  return `
    <div class="wk-sum">
      <span class="wk-pill">To do <b>${s.todo}</b></span>
      <span class="wk-pill wk-pill-blue">In progress <b>${s.in_progress}</b></span>
      <span class="wk-pill wk-pill-green">Done <b>${s.done}</b></span>
      ${s.overdue ? `<span class="wk-pill wk-pill-red">${s.overdue} overdue</span>` : ''}
    </div>${last}`;
}

function render() {
  const list = document.getElementById('wkList');
  const empty = document.getElementById('wkEmpty');
  if (!list) return;
  if (!workers.length) { list.innerHTML = ''; empty.style.display = ''; return; }
  empty.style.display = 'none';
  const today = localToday();

  list.innerHTML = `<div class="wk-grid">${workers.map((w) => `
    <div class="card wk-card${w.active ? '' : ' is-off'}" data-id="${escHtml(w.user_id)}">
      <div>
        <div class="wk-name">${escHtml(w.name || 'Unnamed')}
          <span class="badge badge-purple">${escHtml(ROLE_LABEL[w.job_role] || 'No role')}</span>
          <span class="badge ${w.active ? 'badge-green' : 'badge-red'}">${w.active ? 'Active' : 'Deactivated'}</span>
        </div>
        <div class="wk-email">${escHtml(w.email || '')}</div>
        <div class="wk-login">${escHtml(loginLine(w))}</div>
        ${summaryHtml(w, today)}
      </div>
      <div class="wk-actions">
        ${tasksLoaded && (groupByWorker(tasks)[w.user_id] || []).length ? '<button class="btn btn-ghost btn-sm" data-act="jobs">View jobs</button>' : ''}
        <button class="btn btn-ghost btn-sm" data-act="edit">Edit</button>
        ${w.active ? '<button class="btn btn-ghost btn-sm" data-act="resend">Send new code</button>' : ''}
        ${w.active ? '<button class="btn btn-ghost btn-sm" data-act="reset">Reset access</button>' : ''}
        ${w.active
          ? '<button class="btn btn-danger btn-sm" data-act="deactivate">Deactivate</button>'
          : '<button class="btn btn-primary btn-sm" data-act="reactivate">Reactivate</button>'}
      </div>
    </div>`).join('')}</div>`;
}

async function load() {
  const { data, error } = await supabase
    .from('profiles').select('*').eq('role', 'worker').order('name', { ascending: true });
  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205';
    setNotice(missing
      ? 'The roles table is missing — run supabase/worker-setup.sql (SETUP.md).'
      : 'Could not load workers: ' + error.message, { error: true });
    workers = [];
    render();
    return;
  }
  workers = data || [];
  render();
  loadTasks();

  // Nice-to-have: last login times. Fine if the function isn't deployed yet.
  try {
    const res = await callWorkerAdmin('list_status');
    lastSignIn = (res && res.last_sign_in) || {};
    render();
  } catch (e) {
    lastSignIn = {};
  }
}

// ---- Crew jobs: every worker's jobs and their status (admin only; the database enforces it)
async function loadTasks() {
  const { data, error } = await supabase.from('worker_tasks').select(TASK_COLS).order('shoot_date', { ascending: true });
  if (error) {
    const missingTable = error.code === '42P01' || error.code === 'PGRST205';
    const missingCol = error.code === '42703' || /done_at/i.test(error.message || '');
    tasksError = missingTable ? 'The worker jobs table is missing — run PART 3 and PART 4 of supabase/worker-setup.sql (SETUP.md).'
      : missingCol ? 'The database needs PART 4 of supabase/worker-setup.sql (SETUP.md, Phase 4) before crew status can show.'
      : 'Could not load crew jobs: ' + error.message;
    tasks = []; tasksLoaded = false;
  } else {
    tasks = data || []; tasksLoaded = true; tasksError = ''; tasksLoadedAt = new Date();
  }
  render();
  renderJobs();
}

const workerName = (id) => (workers.find((w) => w.user_id === id) || {}).name || 'Unknown worker';

function jobRow(t, today) {
  const done = t.status === 'done';
  const dates = [];
  if (t.shoot_date) {
    const when = [fmtDay(t.shoot_date), t.shoot_time ? fmtTime(t.shoot_time) : ''].filter(Boolean).join(' · ');
    dates.push(`🎬 ${escHtml(when)}${done ? '' : ` <span class="wk-rel">(${escHtml(relDay(t.shoot_date, today))})</span>`}`);
  }
  if (t.due_date) dates.push(`⏰ Deadline ${escHtml(fmtDay(t.due_date))}${done ? '' : ` <span class="wk-rel">(${escHtml(relDay(t.due_date, today))})</span>`}`);
  const late = isOverdue(t, today);
  const fresh = wasMarkedDoneRecently(t);
  const s = STATUS_LABEL[t.status] ? t.status : 'todo';
  return `
    <div class="card wk-job${done ? ' is-done' : ''}${fresh ? ' is-fresh' : ''}">
      <div class="wk-job-top">
        <div class="wk-job-title">${escHtml(t.title)}</div>
        <div class="wk-job-badges">
          ${fresh ? '<span class="badge badge-green">New ✓</span>' : ''}
          ${late ? '<span class="badge badge-red">Overdue</span>' : ''}
          <span class="badge ${STATUS_CLASS[s]}">${STATUS_LABEL[s]}</span>
        </div>
      </div>
      <div class="wk-job-sub">${escHtml(workerName(t.worker_id))} · ${escHtml(ROLE_LABEL[t.role] || t.role)}${t.client_name ? ` · ${escHtml(t.client_name)}` : ''}</div>
      ${dates.length ? `<div class="wk-job-dates">${dates.join('<span class="wk-sep">·</span>')}</div>` : ''}
      ${done ? `<div class="wk-job-done">✅ ${escHtml(workerName(t.worker_id))} marked this done${t.done_at ? ` on ${escHtml(fmtStamp(t.done_at))}` : ''}</div>` : ''}
    </div>`;
}

function renderJobs() {
  const bar = document.getElementById('wkFilters');
  const box = document.getElementById('wkJobs');
  const stamp = document.getElementById('wkUpdated');
  if (!bar || !box) return;

  if (tasksError) {
    bar.innerHTML = ''; stamp.textContent = '';
    box.innerHTML = `<div class="wk-notice error"><span>${escHtml(tasksError)}</span></div>`;
    return;
  }
  if (!tasksLoaded) { bar.innerHTML = ''; box.innerHTML = '<p class="wk-muted">Loading crew jobs…</p>'; return; }

  stamp.textContent = tasksLoadedAt ? `Updated ${tasksLoadedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : '';
  const opt = (v, label, cur) => `<option value="${escHtml(v)}"${cur === v ? ' selected' : ''}>${escHtml(label)}</option>`;
  bar.innerHTML = `
    <select data-filter="worker" aria-label="Worker">${opt('', 'All workers', filters.worker)}${workers.map((w) => opt(w.user_id, w.name || 'Unnamed', filters.worker)).join('')}</select>
    <select data-filter="status" aria-label="Status">${opt('', 'Any status', filters.status)}${opt('todo', 'To do', filters.status)}${opt('in_progress', 'In progress', filters.status)}${opt('done', 'Done', filters.status)}</select>
    <select data-filter="when" aria-label="When">${opt('', 'Any time', filters.when)}${opt('overdue', 'Overdue', filters.when)}${opt('upcoming', 'Upcoming', filters.when)}${opt('recent', 'Marked done recently', filters.when)}</select>
    ${filters.worker || filters.status || filters.when ? '<button type="button" class="btn btn-ghost btn-sm" data-filter-clear>Clear</button>' : ''}`;

  const today = localToday();
  const rows = filterJobs(tasks, filters, today);
  if (!tasks.length) box.innerHTML = '<p class="wk-muted">No jobs are assigned to any worker yet. Assign crew from a project (Dashboard → project → Assign crew).</p>';
  else if (!rows.length) box.innerHTML = '<p class="wk-muted">No jobs match these filters.</p>';
  else box.innerHTML = `<div class="wk-jobs">${rows.map((t) => jobRow(t, today)).join('')}</div>`;
}

// Runs a server call. On failure, shows the reason — inside the popup when a
// form is open (otherwise it would hide behind the popup), else on the page.
async function run(label, fn, errorEl) {
  try {
    const res = await fn();
    if (errorEl) errorEl.textContent = '';
    return res || {};
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message;
    else {
      // The server sometimes starts its message with the same words as our label; don't say it twice.
      const same = err.message.toLowerCase().startsWith(label.toLowerCase());
      setNotice(same ? err.message : `${label}: ${err.message}`, { error: true });
    }
    return null;
  }
}

function openAdd() {
  const body = document.createElement('div');
  body.innerHTML = `
    <form id="wkAddForm">
      <div class="form-grid">
        <div class="form-field full"><label>Name</label><input type="text" id="wkName" maxlength="80" required></div>
        <div class="form-field full"><label>Email (they log in with this)</label><input type="email" id="wkEmail" autocomplete="off" required></div>
        <div class="form-field full"><label>Role</label>
          <select id="wkRole"><option value="camera">Camera</option><option value="editor">Editor</option></select>
        </div>
      </div>
      <p class="wk-note-small">We'll email them a 6-digit code. After entering it they choose their own password.</p>
      <p class="wk-form-error" id="wkFormError"></p>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="wkCancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="wkSave">Add worker</button>
      </div>
    </form>`;
  openModal('Add Worker', body);
  body.querySelector('#wkCancel').addEventListener('click', closeModal);
  body.querySelector('#wkAddForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = body.querySelector('#wkSave');
    btn.disabled = true; btn.textContent = 'Adding…';
    const res = await run('Could not add worker', () => callWorkerAdmin('create', {
      name: body.querySelector('#wkName').value,
      email: body.querySelector('#wkEmail').value,
      job_role: body.querySelector('#wkRole').value,
    }), body.querySelector('#wkFormError'));
    if (!res) { btn.disabled = false; btn.textContent = 'Add worker'; return; }
    closeModal();
    if (res.warning) setNotice(res.warning + ' Use "Send new code" once email is working.', { error: true });
    else { setNotice(''); showToast('Worker added — code emailed'); }
    load();
  });
}

function openEdit(w) {
  const body = document.createElement('div');
  body.innerHTML = `
    <form id="wkEditForm">
      <div class="form-grid">
        <div class="form-field full"><label>Name</label><input type="text" id="wkName" maxlength="80" required value="${escHtml(w.name || '')}"></div>
        <div class="form-field full"><label>Email</label><input type="email" value="${escHtml(w.email || '')}" disabled></div>
        <div class="form-field full"><label>Role</label>
          <select id="wkRole">
            <option value="camera" ${w.job_role === 'camera' ? 'selected' : ''}>Camera</option>
            <option value="editor" ${w.job_role === 'editor' ? 'selected' : ''}>Editor</option>
          </select>
        </div>
      </div>
      <p class="wk-note-small">To change someone's email, add them again with the new email and deactivate the old one.</p>
      <p class="wk-form-error" id="wkFormError"></p>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" id="wkCancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="wkSave">Save</button>
      </div>
    </form>`;
  openModal('Edit Worker', body);
  body.querySelector('#wkCancel').addEventListener('click', closeModal);
  body.querySelector('#wkEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = body.querySelector('#wkSave');
    btn.disabled = true; btn.textContent = 'Saving…';
    const res = await run('Could not save', () => callWorkerAdmin('update', {
      user_id: w.user_id,
      name: body.querySelector('#wkName').value,
      job_role: body.querySelector('#wkRole').value,
    }), body.querySelector('#wkFormError'));
    if (!res) { btn.disabled = false; btn.textContent = 'Save'; return; }
    closeModal(); showToast('Saved'); load();
  });
}

async function onAction(act, w) {
  setNotice('');
  if (act === 'edit') return openEdit(w);

  if (act === 'jobs') {
    filters = { worker: w.user_id, status: '', when: '' };
    renderJobs();
    const wrap = document.getElementById('wkJobsWrap');
    if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return undefined;
  }

  if (act === 'resend') {
    const res = await run('Could not send the code', () => callWorkerAdmin('resend_code', { user_id: w.user_id }));
    if (res) showToast(`Code emailed to ${w.email}`);
    return undefined;
  }

  if (act === 'reset') {
    return openConfirm(
      `Reset access for ${w.name}? They'll be signed out everywhere, their old password stops working, and they'll get a new code by email.`,
      async () => {
        const res = await run('Could not reset access', () => callWorkerAdmin('reset_access', { user_id: w.user_id }));
        if (!res) return;
        if (res.warning) setNotice(res.warning, { error: true }); else showToast('Access reset — new code emailed');
      },
      null,
      'Reset access'
    );
  }

  if (act === 'deactivate') {
    return openConfirm(
      `Deactivate ${w.name}? They'll be signed out and can't log in or see any jobs until you reactivate them.`,
      async () => {
        const res = await run('Could not deactivate', () => callWorkerAdmin('set_active', { user_id: w.user_id, active: false }));
        if (res) { showToast(`${w.name} deactivated`); load(); }
      },
      null,
      'Deactivate'
    );
  }

  if (act === 'reactivate') {
    const res = await run('Could not reactivate', () => callWorkerAdmin('set_active', { user_id: w.user_id, active: true }));
    if (res) { showToast(`${w.name} reactivated — use "Send new code" if they need to log in again`); load(); }
  }
  return undefined;
}

export function onAddClick() { openAdd(); }

export function init() {
  const list = document.getElementById('wkList');
  if (list && !list.dataset.wired) {
    list.dataset.wired = '1';
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const card = btn.closest('[data-id]');
      const w = workers.find((x) => x.user_id === card.dataset.id);
      if (w) onAction(btn.dataset.act, w);
    });
  }
  const wrap = document.getElementById('wkJobsWrap');
  if (wrap && !wrap.dataset.wired) {
    wrap.dataset.wired = '1';
    wrap.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-filter]');
      if (!sel) return;
      filters = { ...filters, [sel.dataset.filter]: sel.value };
      renderJobs();
    });
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-filter-clear]')) { filters = { worker: '', status: '', when: '' }; renderJobs(); }
      if (e.target.closest('#wkJobsRefresh')) { setNotice(''); loadTasks(); }
    });
  }
  // Coming back to the app should show what workers did meanwhile.
  if (!focusWired) {
    focusWired = true;
    const again = () => { if (document.visibilityState !== 'hidden' && document.getElementById('wkJobs')) loadTasks(); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
  }
  load();
}
