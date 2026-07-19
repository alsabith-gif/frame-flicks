// pages/settings.js — app mode switcher + on-device Face ID lock toggle.

import { getAppMode } from '../storage.js';
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

export function init() {
  renderModeSwitcher();
  wireModeSwitcher();
  renderFaceLock();
  wireFaceLock();
  wireLogoutButton();
}
