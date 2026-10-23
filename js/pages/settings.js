// pages/settings.js — app mode switcher + on-device Face ID lock toggle.

import { getAppMode, getNotifPrefs, saveNotifPrefs, getContentTypes, saveContentTypes } from '../storage.js';
import { EVENT_TYPES } from '../reminderRules.js';
import * as push from '../push.js';
import { showToast } from '../toast.js';
import * as facelock from '../facelock.js';
import { logout, supabase } from '../cloud.js';
import { getRoles, loadRoles, slugRole } from '../roles.js';
import { escHtml } from '../format.js';
import { APP_VERSION, APP_BUILD } from '../version.js';

function renderModeSwitcher() {
  const mode = getAppMode();
  document.querySelectorAll('#settingsModeSwitcher .mode-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function wireModeSwitcher() {
  document.querySelectorAll('#settingsModeSwitcher .mode-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (window.ctSetMode) window.ctSetMode(btn.dataset.mode);
      renderModeSwitcher();
    });
  });
}

function renderFaceLock() {
  const toggle = document.getElementById('faceLockToggle');
  const status = document.getElementById('faceLockStatus');
  const note = document.getElementById('faceLockNote');

  if (!facelock.isSupported()) {
    toggle.disabled = true;
    status.textContent = 'Not available';
    note.textContent = "This browser/device doesn't support Face ID or Touch ID.";
    return;
  }

  const on = facelock.isEnabled();
  toggle.classList.toggle('on', on);
  toggle.setAttribute('aria-checked', String(on));
  status.textContent = on ? 'On' : 'Off';
  note.textContent = on ? 'Face ID lock is set up on this device.' : '';
}

function wireFaceLock() {
  const toggle = document.getElementById('faceLockToggle');
  const note = document.getElementById('faceLockNote');

  toggle.addEventListener('click', async () => {
    if (toggle.disabled) return;
    const currentlyOn = facelock.isEnabled();

    if (currentlyOn) {
      facelock.disable();
      renderFaceLock();
      showToast('Face ID lock turned off');
      return;
    }

    toggle.disabled = true;
    note.textContent = 'Follow the prompt on your device…';
    try {
      await facelock.enable();
      showToast('Face ID lock enabled');
    } catch (err) {
      showToast(err.message || 'Could not set up Face ID');
    } finally {
      toggle.disabled = false;
      renderFaceLock();
    }
  });
}

function wireLogoutButton() {
  const btn = document.getElementById('settingsLogoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Logging out…';
    await logout();
    window.location.reload();
  });
}

const MINS = [0, 15, 30, 60, 120, 180, 1440];
const minLabel = (m) => (m === 0 ? 'No extra reminder' : m >= 1440 ? '1 day before' : m >= 60 ? `${m / 60} hr before` : `${m} min before`);

async function renderNotifs() {
  const box = document.getElementById('notifCard');
  if (!box) return;
  const prefs = getNotifPrefs();
  const sub = await push.currentSubscription().catch(() => null);
  const perm = 'Notification' in window ? Notification.permission : 'denied';
  const on = !!sub && perm === 'granted' && prefs.enabled;
  let hint = '';
  if (push.isIOS() && !push.isStandalone()) hint = 'On iPhone: tap Share → Add to Home Screen, then open the app from the Home Screen icon to enable notifications.';
  else if (!push.pushSupported()) hint = "This browser doesn't support push notifications.";
  else if (!push.vapidConfigured()) hint = 'Push is not set up yet — see SETUP.md → Push notifications.';
  else if (perm === 'denied') hint = 'Notifications are blocked for this app — allow them in your phone settings.';
  const rows = Object.entries(EVENT_TYPES).map(([k, t]) => {
    const p = prefs[k];
    return `<div class="notif-type" data-k="${k}">
      <div class="settings-row"><span class="settings-row-label">${t.main ? '⭐ ' : ''}${t.label}${t.main ? ' (main)' : ''}</span>
        <button class="toggle-switch${p.on ? ' on' : ''}" data-f="on" role="switch" aria-checked="${p.on}"><span class="toggle-knob"></span></button></div>
      ${p.on ? `<div class="notif-opts">
        <label><input type="checkbox" data-f="dayBefore" ${p.dayBefore ? 'checked' : ''}> Day before at <input type="time" data-f="dayBeforeTime" value="${p.dayBeforeTime}"></label>
        <label><input type="checkbox" data-f="sameDay" ${p.sameDay ? 'checked' : ''}> Same day at <input type="time" data-f="sameDayTime" value="${p.sameDayTime}"></label>
        ${t.hasTime ? `<label>Before start time <select data-f="minutesBefore">${MINS.map((m) => `<option value="${m}" ${Number(p.minutesBefore) === m ? 'selected' : ''}>${minLabel(m)}</option>`).join('')}</select></label>` : ''}
      </div>` : ''}</div>`;
  }).join('');
  box.innerHTML = `<h2 class="settings-title">Notifications</h2>
    <p class="settings-desc">Choose which calendar events send you a push notification, and when.</p>
    ${hint ? `<p class="settings-note">${hint}</p>` : ''}
    <div class="settings-row"><span class="settings-row-label">${on ? 'On for this device' : 'Off'}</span>
      <button class="toggle-switch${on ? ' on' : ''}" id="notifMaster" role="switch" aria-checked="${on}"><span class="toggle-knob"></span></button></div>
    ${on ? `<div class="notif-types">${rows}</div><button class="btn btn-ghost btn-sm" id="notifTest">Send test notification</button>` : ''}`;

  box.querySelector('#notifMaster').addEventListener('click', async () => {
    try {
      if (on) { await push.disablePush(); const p = getNotifPrefs(); p.enabled = false; saveNotifPrefs(p); showToast('Notifications off'); }
      else { await push.enablePush(); const p = getNotifPrefs(); p.enabled = true; saveNotifPrefs(p); showToast('Notifications on'); }
    } catch (err) { showToast(err.message || 'Could not change notifications'); }
    renderNotifs();
  });
  const test = box.querySelector('#notifTest');
  if (test) test.addEventListener('click', async () => {
    try { await push.sendTestPush(); showToast('Test sent'); } catch (err) { showToast(err.message); }
  });
  box.querySelectorAll('.notif-type [data-f]').forEach((el) => {
    el.addEventListener(el.tagName === 'BUTTON' ? 'click' : 'change', () => {
      const p = getNotifPrefs();
      const k = el.closest('.notif-type').dataset.k;
      const f = el.dataset.f;
      p[k][f] = el.tagName === 'BUTTON' ? !p[k][f] : el.type === 'checkbox' ? el.checked : el.type === 'time' ? el.value : Number(el.value);
      saveNotifPrefs(p);
      renderNotifs();
    });
  });
}

// ---- Crew roles: the list of jobs a worker can have (Camera, Editor + your own) ----
const MAIN_DATE_TEXT = { shoot: 'works to the shoot day', deadline: 'works to the deadline' };

function roleError(error) {
  const msg = (error && error.message) || 'Something went wrong.';
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) return 'The roles table is missing — run the roles SQL file first (SETUP.md → Roles update).';
  if (error && error.code === '23505') return 'A role with that name already exists.';
  return msg;
}

async function renderRoles(note = '') {
  const box = document.getElementById('rolesCard');
  if (!box) return;
  const res = await loadRoles(supabase);
  const rows = getRoles();
  const err = res.ok ? '' : roleError(res.error);
  box.innerHTML = `<h2 class="settings-title">Crew roles</h2>
    <p class="settings-desc">The jobs your workers do. Camera and Editor are always there. Add your own (Drone, Photographer, Colorist…) and then tick them when you add or edit a worker.</p>
    ${err ? `<p class="settings-note" id="rolesErr">${escHtml(err)}</p>` : ''}
    <div class="roles-list">${rows.map((r) => `
      <div class="settings-row roles-row" data-key="${escHtml(r.key)}">
        <span class="settings-row-label"><b>${escHtml(r.label)}</b><br><small>${escHtml(MAIN_DATE_TEXT[r.main_date])}${r.builtin ? ' · built in' : ''}</small></span>
        <span class="roles-actions">
          <button class="btn btn-ghost btn-sm" data-act="rename">Rename</button>
          ${r.builtin ? '' : '<button class="btn btn-ghost btn-sm" data-act="remove">Remove</button>'}
        </span>
      </div>`).join('')}</div>
    <form id="roleAddForm" class="roles-add">
      <input type="text" id="roleName" maxlength="30" placeholder="New role, e.g. Drone" required>
      <select id="roleDate" aria-label="Which date matters most">
        <option value="shoot">Works to the shoot day</option>
        <option value="deadline">Works to the deadline</option>
      </select>
      <button type="submit" class="btn btn-primary btn-sm">Add role</button>
    </form>
    <p class="settings-note" id="rolesMsg">${escHtml(note)}</p>`;
  const msg = (t) => { box.querySelector('#rolesMsg').textContent = t || ''; };

  box.querySelector('#roleAddForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const label = box.querySelector('#roleName').value.trim();
    const key = slugRole(label);
    if (!label || !key) { msg('Type a name for the role (letters or numbers).'); return; }
    const dupe = getRoles().find((r) => r.key === key || r.label.toLowerCase() === label.toLowerCase());
    if (dupe) { msg(`"${dupe.label}" already exists.`); return; }
    const { error } = await supabase.from('crew_roles').insert({
      key, label, main_date: box.querySelector('#roleDate').value, sort_order: 100,
    });
    if (error) { msg(roleError(error)); return; }
    showToast('Role added');
    renderRoles();
  });

  box.querySelectorAll('.roles-row [data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const key = btn.closest('.roles-row').dataset.key;
    const role = getRoles().find((r) => r.key === key);
    if (!role) return;
    if (btn.dataset.act === 'rename') {
      const label = (window.prompt(`New name for "${role.label}":`, role.label) || '').trim();
      if (!label || label === role.label) return;
      const { error } = await supabase.from('crew_roles').update({ label }).eq('key', key);
      if (error) { msg(roleError(error)); return; }
      showToast('Renamed');
      renderRoles();
    } else if (window.confirm(`Remove the role "${role.label}"?`)) {
      const { error } = await supabase.from('crew_roles').delete().eq('key', key);
      if (error) { msg(roleError(error)); return; }      // e.g. "Some workers still have this role"
      showToast('Role removed');
      renderRoles();
    }
  }));
}

// ---- Contact number: what your crew's "Call admin" button dials ----
const PHONE_OK = /^[0-9+() -]{5,20}$/;

async function renderContact() {
  const box = document.getElementById('contactCard');
  if (!box) return;
  const { data, error } = await supabase.from('crew_contact').select('phone').eq('id', 1);
  const missing = error && (error.code === '42P01' || error.code === 'PGRST205');
  const phone = (data && data[0] && data[0].phone) || '';
  box.innerHTML = `<h2 class="settings-title">Crew contact number</h2>
    <p class="settings-desc">Your workers get a <b>Call admin</b> button on their Profile tab that dials this number. Leave it empty to hide the button.</p>
    ${error ? `<p class="settings-note">${escHtml(missing ? 'Run the Phase 2 SQL first (SETUP.md → Phase 2).' : 'Could not load: ' + error.message)}</p>` : ''}
    <form id="contactForm" class="roles-add">
      <input type="tel" id="contactPhone" maxlength="20" inputmode="tel" placeholder="e.g. +91 98765 43210" value="${escHtml(phone)}"${error ? ' disabled' : ''}>
      <button type="submit" class="btn btn-primary btn-sm"${error ? ' disabled' : ''}>Save number</button>
    </form>
    <p class="settings-note" id="contactMsg"></p>`;
  const form = box.querySelector('#contactForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = box.querySelector('#contactMsg');
    const v = box.querySelector('#contactPhone').value.trim();
    if (v && !PHONE_OK.test(v)) { msg.textContent = 'Use only numbers, +, spaces, ( ) and - (5 to 20 characters).'; return; }
    const { error: err } = await supabase.from('crew_contact').update({ phone: v || null, updated_at: new Date().toISOString() }).eq('id', 1);
    if (err) { msg.textContent = err.message || 'Could not save.'; return; }
    showToast(v ? 'Number saved' : 'Number removed');
    msg.textContent = '';
  });
}

// The list of choices shown as "Content type" in the project form (one per line).
function renderContentTypes() {
  const box = document.getElementById('ctypesCard');
  if (!box) return;
  box.innerHTML = `<h2 class="settings-title">Project content types</h2>
    <p class="settings-desc">The choices in the "Content type" box when you add a project. One per line. Projects that already have a type keep it.</p>
    <textarea id="ctypesText" rows="6" style="width:100%"></textarea>
    <div class="form-actions" style="margin-top:8px"><button class="btn btn-primary btn-sm" id="ctypesSave">Save</button></div>`;
  const ta = document.getElementById('ctypesText');
  ta.value = getContentTypes().join('\n');
  document.getElementById('ctypesSave').addEventListener('click', () => {
    const seen = new Set();
    const list = ta.value.split('\n').map((x) => x.trim()).filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
    saveContentTypes(list);
    ta.value = list.join('\n');
    showToast('Content types saved');
  });
}

export function init() {
  const v = document.getElementById('appVersion');
  if (v) v.textContent = `Version: ${APP_VERSION} · ${APP_BUILD}`;
  renderNotifs();
  renderRoles();
  renderContact();
  renderContentTypes();
  renderModeSwitcher();
  wireModeSwitcher();
  renderFaceLock();
  wireFaceLock();
  wireLogoutButton();
}
