// pages/settings.js — app mode switcher + on-device Face ID lock toggle.

import { getAppMode, getNotifPrefs, saveNotifPrefs } from '../storage.js';
import { EVENT_TYPES } from '../reminderRules.js';
import * as push from '../push.js';
import { showToast } from '../toast.js';
import * as facelock from '../facelock.js';
import { logout } from '../cloud.js';

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

export function init() {
  renderNotifs();
  renderModeSwitcher();
  wireModeSwitcher();
  renderFaceLock();
  wireFaceLock();
  wireLogoutButton();
}
