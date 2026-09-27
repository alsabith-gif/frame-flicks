// bootstrap.js — runs before the rest of the app.
//
// Flow on every open:
//  1. No Supabase session yet -> show the email/password login screen
//     (this only happens once per device, ever, unless you log out — the
//     session is saved and refreshes itself automatically after that).
//  2. Session exists, but Face ID lock is turned on for this device ->
//     show a quick "Unlock with Face ID" screen instead of the password
//     form.
//  3. Otherwise -> pull your latest data down from the cloud and open the
//     app straight away.

import { getSession, login, pullAllFromCloud } from './cloud.js';
import * as facelock from './facelock.js';

const gate = document.getElementById('authGate');
const lockGate = document.getElementById('lockGate');
const loading = document.getElementById('authLoading');
const shell = document.querySelector('.shell');
const form = document.getElementById('authForm');
const errorEl = document.getElementById('authError');
const unlockBtn = document.getElementById('unlockBtn');
const lockDesc = document.getElementById('lockDesc');

function hideAllScreens() {
  gate.style.display = 'none';
  lockGate.style.display = 'none';
  loading.style.display = 'none';
  shell.style.display = 'none';
}

function showGate() {
  hideAllScreens();
  gate.style.display = 'flex';
}

function showLockGate() {
  hideAllScreens();
  lockGate.style.display = 'flex';
  lockDesc.textContent = 'Unlock with Face ID to continue.';
  unlockBtn.disabled = false;
  unlockBtn.textContent = 'Unlock';
  attemptUnlock();
}

function showLoading() {
  hideAllScreens();
  loading.style.display = 'flex';
}

function showApp() {
  hideAllScreens();
  shell.style.display = '';
}

// Whether this device has any cached data at all yet. If so we can boot
// straight from it — no need to make the user stare at "Loading…" on every
// single open while we wait on the network.
function hasLocalData() {
  return !!localStorage.getItem('ve_ct_prospects');
}

function syncCloudInBackground() {
  pullAllFromCloud()
    .then(async (changed) => {
      if (!changed) return;
      const { refreshCurrentPage } = await import('./router.js');
      refreshCurrentPage();
      if (window.ctRefreshPipelineMini) window.ctRefreshPipelineMini();
    })
    .catch((err) => console.error('background sync failed', err));
}

async function finishBoot() {
  if (hasLocalData()) {
    // Returning device: show the app instantly with what's cached, then
    // quietly refresh it with anything newer from the cloud.
    const { boot } = await import('./main.js');
    boot();
    showApp();
    syncCloudInBackground();
  } else {
    // First time on this device: nothing to show yet, so we do need to
    // wait — but a bounded wait (see PULL_TIMEOUT_MS in cloud.js) rather
    // than an indefinite one.
    showLoading();
    await pullAllFromCloud();
    const { boot } = await import('./main.js');
    boot();
    showApp();
  }
}

// If Face ID lock is on for this device, gate app access behind it;
// otherwise go straight in.
async function proceedPastLogin() {
  if (facelock.isEnabled()) {
    showLockGate();
  } else {
    await finishBoot();
  }
}

async function attemptUnlock() {
  const ok = await facelock.verify();
  if (ok) {
    await finishBoot();
  } else {
    lockDesc.textContent = "Couldn't verify — try again.";
  }
}

unlockBtn.addEventListener('click', attemptUnlock);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.classList.remove('show');
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in…';
  try {
    await login(email, password);
    // Just proved identity with the password — go straight in without
    // also demanding Face ID on the same visit.
    await finishBoot();
  } catch (err) {
    errorEl.textContent = err.message || 'Login failed';
    errorEl.classList.add('show');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log in';
  }
});

window.addEventListener('ct-sync-error', () => {
  import('./toast.js').then(({ showToast }) => {
    showToast('⚠️ Could not sync to cloud — check your connection');
  });
});

(async function init() {
  const session = await getSession();
  if (session) {
    await proceedPastLogin();
  } else {
    showGate();
  }
})();
