// pages/workers.js — admin-only: add, edit, deactivate and reset your crew's
// logins. Reading the list is a normal database query (only an admin is
// allowed to read other people's profiles). Anything that creates or changes
// an account goes through the admin-create-worker edge function, which holds
// the admin key on the server — never in this browser.

import { supabase, callWorkerAdmin } from '../cloud.js';
import { openModal, closeModal, openConfirm } from '../modal.js';
import { showToast } from '../toast.js';
import { escHtml } from '../format.js';

const ROLE_LABEL = { camera: 'Camera', editor: 'Editor' };
let workers = [];
let lastSignIn = {};

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

function render() {
  const list = document.getElementById('wkList');
  const empty = document.getElementById('wkEmpty');
  if (!list) return;
  if (!workers.length) { list.innerHTML = ''; empty.style.display = ''; return; }
  empty.style.display = 'none';

  list.innerHTML = `<div class="wk-grid">${workers.map((w) => `
    <div class="card wk-card${w.active ? '' : ' is-off'}" data-id="${escHtml(w.user_id)}">
      <div>
        <div class="wk-name">${escHtml(w.name || 'Unnamed')}
          <span class="badge badge-purple">${escHtml(ROLE_LABEL[w.job_role] || 'No role')}</span>
          <span class="badge ${w.active ? 'badge-green' : 'badge-red'}">${w.active ? 'Active' : 'Deactivated'}</span>
        </div>
        <div class="wk-email">${escHtml(w.email || '')}</div>
        <div class="wk-login">${escHtml(loginLine(w))}</div>
      </div>
      <div class="wk-actions">
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

  // Nice-to-have: last login times. Fine if the function isn't deployed yet.
  try {
    const res = await callWorkerAdmin('list_status');
    lastSignIn = (res && res.last_sign_in) || {};
    render();
  } catch (e) {
    lastSignIn = {};
  }
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
  load();
}
