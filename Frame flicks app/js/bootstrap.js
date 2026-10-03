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
//
// On top of that, every sign-in is checked against the `profiles` table:
//  - admin  -> the app exactly as before
//  - worker -> the (separate) worker app, built in a later phase
//  - no profile / deactivated -> signed out with a clear message
// This is only about which screen to show. The database itself refuses to
// hand out admin data to anyone who isn't an admin (see supabase/worker-setup.sql).

import {
  getSession, login, logout, pullAllFromCloud,
  fetchProfile, setRole, claimDevice, cachedOwner, onSignedOut,
} from './cloud.js';
import * as facelock from './facelock.js';

const gate = document.getElementById('authGate');
const lockGate = document.getElementById('lockGate');
const loading = document.getElementById('authLoading');
const shell = document.querySelector('.shell');
const form = document.getElementById('authForm');
const errorEl = document.getElementById('authError');
const unlockBtn = document.getElementById('unlockBtn');
const lockDesc = document.getElementById('lockDesc');
const accessGate = document.getElementById('accessGate');
const accessTitle = document.getElementById('accessTitle');
const accessDesc = document.getElementById('accessDesc');
const accessRetryBtn = document.getElementById('accessRetryBtn');
const accessLogoutBtn = document.getElementById('accessLogoutBtn');

function hideAllScreens() {
  accessGate.style.display = 'none';
  gate.style.display = 'none';
  lockGate.style.display = 'none';
  loading.style.display = 'none';
  shell.style.display = 'none';
}

function showGate(message) {
  hideAllScreens();
  gate.style.display = 'flex';
  if (message) {
    errorEl.textContent = message;
    errorEl.classList.add('show');
  }
}

function showAccessProblem(title, desc, { retry = true } = {}) {
  hideAllScreens();
  accessGate.style.display = 'flex';
  accessTitle.textContent = title;
  accessDesc.textContent = desc;
  accessRetryBtn.style.display = retry ? '' : 'none';
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

// Who is this, and what are they allowed to see? Runs after every sign-in and
// every app open. Returns after showing the right screen.
async function enterApp({ justLoggedIn = false } = {}) {
  showLoading();
  const session = await getSession();
  if (!session) { showGate(); return; }

  let profile;
  try {
    profile = await fetchProfile(session.user.id);
  } catch (err) {
    const missingTable = err && (err.code === '42P01' || err.code === 'PGRST205');
    if (missingTable) {
      showAccessProblem(
        'Setup not finished',
        'The roles table does not exist yet. Run supabase/worker-setup.sql (SETUP.md, step 1), then try again.'
      );
      return;
    }
    // Couldn't reach the server. Trust the last role we verified for this
    // exact user so the app still opens offline; otherwise ask to retry.
    const owner = cachedOwner();
    if (owner && owner.uid === session.user.id) {
      profile = { role: owner.role, active: true };
    } else {
      showAccessProblem('Can\'t check your account', 'Check your connection and try again.');
      return;
    }
  }

  if (!profile) {
    showAccessProblem(
      'No access yet',
      'This account has not been set up for Frame Flicks. Ask the admin to add you.',
      { retry: false }
    );
    return;
  }

  if (!profile.active) {
    await logout();
    showGate('This account has been deactivated. Contact the admin.');
    return;
  }

  claimDevice(session.user.id, profile.role);
  setRole(profile.role);

  if (profile.role === 'admin') {
    if (justLoggedIn) await finishBoot();   // password just proved identity — no Face ID on top
    else await proceedPastLogin();
    return;
  }

  // Worker app arrives in a later phase. Until then, show a holding screen
  // (no admin data is pulled or shown for a worker).
  showAccessProblem(
    'Worker app coming soon',
    'Your account is ready. The worker app is not switched on yet.',
    { retry: true }
  );
}

accessRetryBtn.addEventListener('click', () => enterApp());
accessLogoutBtn.addEventListener('click', async () => {
  accessLogoutBtn.disabled = true;
  await logout();
  window.location.reload();
});

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
  } catch (err) {
    errorEl.textContent = err.message || 'Login failed';
    errorEl.classList.add('show');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log in';
    return;
  }
  try {
    await enterApp({ justLoggedIn: true });
  } catch (err) {
    console.error(err);
    showGate(err.message || 'Something went wrong');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log in';
  }
});

window.addEventListener('ct-sync-error', () => {
  import('./toast.js').then(({ showToast }) => {
    showToast('⚠️ Could not sync to cloud — check your connection');
  });
});

// If the session ends while the app is open (logged out elsewhere, account
// deactivated, token revoked) cached data is wiped and we go back to login.
onSignedOut(() => {
  if (shell.style.display !== 'none') window.location.reload();
});

(async function init() {
  const session = await getSession();
  if (session) {
    await enterApp();
  } else {
    showGate();
  }
})();
