// bootstrap.js — runs before the rest of the app.
//
// Flow on every open:
//  1. No Supabase session yet -> show the email/password login screen
//     (this only happens once per device, ever, unless you log out — the
//     session is saved and refreshes itself automatically after that).
//     "First time here, or forgot your password?" -> email a 6-digit code.
//  2. Signed in with a code -> must choose a password before going on.
//  3. Session exists, but Face ID lock is turned on for this device ->
//     show a quick "Unlock with Face ID" screen instead of the password
//     form.
//  4. Otherwise -> open the app straight away.
//
// Every sign-in is checked against the `profiles` table:
//  - admin  -> the admin app, exactly as before (pulls your data from the cloud)
//  - worker -> the worker app (built in a later phase; a holding screen for now)
//  - no profile / deactivated -> signed out with a clear message
// This is only about which screen to show. The database itself refuses to
// hand out admin data to anyone who isn't an admin (see supabase/worker-setup.sql).

import {
  getSession, login, logout, pullAllFromCloud,
  fetchProfile, setRole, getRole, claimDevice, cachedOwner, onSignedOut,
  requestLoginCode, verifyLoginCode, setNewPassword, isPasswordPending, setPasswordPending,
} from './cloud.js';
import * as facelock from './facelock.js';
import { showToast } from './toast.js';

const $ = (id) => document.getElementById(id);

const gate = $('authGate');
const lockGate = $('lockGate');
const loading = $('authLoading');
const shell = document.querySelector('.shell');
const form = $('authForm');
const errorEl = $('authError');
const unlockBtn = $('unlockBtn');
const lockDesc = $('lockDesc');
const accessGate = $('accessGate');
const accessTitle = $('accessTitle');
const accessDesc = $('accessDesc');
const accessRetryBtn = $('accessRetryBtn');
const accessLogoutBtn = $('accessLogoutBtn');
const otpGate = $('otpGate');
const passwordGate = $('passwordGate');
const faceGate = $('faceGate');

let workerName = '';

function hideAllScreens() {
  [accessGate, gate, lockGate, loading, otpGate, passwordGate, faceGate].forEach((el) => { el.style.display = 'none'; });
  shell.style.display = 'none';
}

function showError(el, message) {
  el.textContent = message;
  el.classList.toggle('show', !!message);
}

function showGate(message) {
  hideAllScreens();
  gate.style.display = 'flex';
  showError(errorEl, message || '');
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

// Opens the ADMIN app. Hard rule: never for anyone but an admin.
async function finishBoot() {
  if (getRole() !== 'admin') { showWorkerHome(); return; }
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

// Worker app arrives in a later phase. Until then, a holding screen — no
// admin data is pulled or shown for a worker.
function showWorkerHome() {
  showAccessProblem(
    workerName ? `Hi ${workerName}` : 'Welcome',
    'Your account is ready. Your jobs will show up here once the worker app is switched on.',
    { retry: false }
  );
}

// Opens whichever app this person's role gets.
async function bootForRole() {
  if (getRole() === 'admin') await finishBoot();
  else showWorkerHome();
}

// If Face ID lock is on for this device, gate app access behind it;
// otherwise go straight in.
async function proceedPastLogin() {
  if (facelock.isEnabled()) {
    showLockGate();
  } else {
    await bootForRole();
  }
}

async function attemptUnlock() {
  const ok = await facelock.verify();
  if (ok) {
    await bootForRole();
  } else {
    lockDesc.textContent = "Couldn't verify — try again.";
  }
}

unlockBtn.addEventListener('click', attemptUnlock);

// ---------------------------------------------------------------------------
// Who is this, and what are they allowed to see? Runs after every sign-in and
// every app open. Returns after showing the right screen.
async function enterApp({ justLoggedIn = false, viaOtp = false } = {}) {
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
  workerName = profile.name || '';

  // Signed in with an emailed code (first login or forgotten password)?
  // They must choose a password before anything else. Remembered across
  // app restarts so it can't be skipped by closing the app.
  const meta = session.user.user_metadata || {};
  const needsPassword = viaOtp || isPasswordPending() || (profile.role === 'worker' && meta.password_set !== true);
  if (needsPassword) {
    setPasswordPending(true);
    showPasswordGate();
    return;
  }

  if (justLoggedIn) await bootForRole();   // password just proved identity — no Face ID on top
  else await proceedPastLogin();
}

accessRetryBtn.addEventListener('click', () => enterApp());
accessLogoutBtn.addEventListener('click', async () => {
  accessLogoutBtn.disabled = true;
  await logout();
  window.location.reload();
});

// ---------------------------------------------------------------------------
// Normal email + password login
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(errorEl, '');
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in…';
  try {
    await login(email, password);
  } catch (err) {
    showError(errorEl, err.message || 'Login failed');
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

// ---------------------------------------------------------------------------
// Email code login: step 1 ask for a code, step 2 type it in
const otpEmailForm = $('otpEmailForm');
const otpCodeForm = $('otpCodeForm');
const otpError = $('otpError');
const otpResendBtn = $('otpResendBtn');
let otpEmail = '';
let resendTimer = null;

function startResendCountdown(seconds = 60) {
  clearInterval(resendTimer);
  let left = seconds;
  otpResendBtn.disabled = true;
  otpResendBtn.textContent = `Resend code in ${left}s`;
  resendTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(resendTimer);
      otpResendBtn.disabled = false;
      otpResendBtn.textContent = 'Resend code';
    } else {
      otpResendBtn.textContent = `Resend code in ${left}s`;
    }
  }, 1000);
}

function showOtpGate(prefillEmail = '') {
  hideAllScreens();
  otpGate.style.display = 'flex';
  otpEmailForm.style.display = '';
  otpCodeForm.style.display = 'none';
  showError(otpError, '');
  clearInterval(resendTimer);
  $('otpEmail').value = prefillEmail;
  $('otpCode').value = '';
}

function showCodeStep() {
  otpEmailForm.style.display = 'none';
  otpCodeForm.style.display = '';
  $('otpCodeDesc').textContent = `If ${otpEmail} has an account, a 6-digit code is on its way. Check your inbox (and spam).`;
  $('otpCode').value = '';
  $('otpCode').focus();
}

$('firstTimeBtn').addEventListener('click', () => showOtpGate($('authEmail').value.trim()));

$('otpBackBtn').addEventListener('click', () => {
  clearInterval(resendTimer);
  showGate();
});

otpEmailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(otpError, '');
  otpEmail = $('otpEmail').value.trim().toLowerCase();
  const btn = $('otpSendBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await requestLoginCode(otpEmail);
    showCodeStep();
    startResendCountdown(60);
  } catch (err) {
    showError(otpError, err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send code';
  }
});

// Keep only digits in the code box (people paste "123 456").
$('otpCode').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
});

otpResendBtn.addEventListener('click', async () => {
  showError(otpError, '');
  otpResendBtn.disabled = true;
  try {
    await requestLoginCode(otpEmail);
    showToast('New code sent');
    startResendCountdown(60);
  } catch (err) {
    showError(otpError, err.message);
    startResendCountdown(30);
  }
});

otpCodeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(otpError, '');
  const code = $('otpCode').value.replace(/\D/g, '');
  if (code.length < 6) { showError(otpError, 'Enter the 6-digit code from the email.'); return; }
  const btn = $('otpVerifyBtn');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  try {
    await verifyLoginCode(otpEmail, code);
  } catch (err) {
    showError(otpError, err.message);
    btn.disabled = false;
    btn.textContent = 'Verify';
    return;
  }
  clearInterval(resendTimer);
  try {
    await enterApp({ justLoggedIn: true, viaOtp: true });
  } catch (err) {
    console.error(err);
    showOtpGate(otpEmail);
    showError(otpError, err.message || 'Something went wrong');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify';
  }
});

// ---------------------------------------------------------------------------
// Choose a password (always after a code login)
const passwordForm = $('passwordForm');
const passwordError = $('passwordError');

function showPasswordGate() {
  hideAllScreens();
  passwordGate.style.display = 'flex';
  $('newPassword').value = '';
  $('newPassword2').value = '';
  showError(passwordError, '');
}

passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(passwordError, '');
  const pw = $('newPassword').value;
  const pw2 = $('newPassword2').value;
  if (pw.length < 8) { showError(passwordError, 'Use at least 8 characters.'); return; }
  if (pw !== pw2) { showError(passwordError, 'The two passwords do not match.'); return; }
  const btn = $('passwordSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await setNewPassword(pw);
  } catch (err) {
    showError(passwordError, err.message);
    btn.disabled = false;
    btn.textContent = 'Save password';
    return;
  }
  setPasswordPending(false);
  btn.disabled = false;
  btn.textContent = 'Save password';
  showToast('Password saved');
  // Workers are offered Face ID once, right after setting their password.
  if (getRole() !== 'admin' && facelock.isSupported() && !facelock.isEnabled()) showFaceGate();
  else await bootForRole();
});

$('passwordLogoutBtn').addEventListener('click', async () => {
  await logout();
  window.location.reload();
});

// ---------------------------------------------------------------------------
// Optional Face ID offer
const faceError = $('faceError');

function showFaceGate() {
  hideAllScreens();
  faceGate.style.display = 'flex';
  showError(faceError, '');
}

$('faceYesBtn').addEventListener('click', async () => {
  showError(faceError, '');
  const btn = $('faceYesBtn');
  btn.disabled = true;
  try {
    await facelock.enable();
    showToast('Face ID turned on');
    await bootForRole();
  } catch (err) {
    showError(faceError, err.message || 'Could not set up Face ID. You can try later in Settings.');
  } finally {
    btn.disabled = false;
  }
});

$('faceSkipBtn').addEventListener('click', () => bootForRole());

// ---------------------------------------------------------------------------
window.addEventListener('ct-sync-error', () => {
  showToast('⚠️ Could not sync to cloud — check your connection');
});

// Version label on the login screen. Loaded separately and defensively so it
// can never stop the app from starting.
import('./version.js')
  .then(({ APP_VERSION, APP_BUILD }) => {
    $('authVersion').textContent = `${APP_VERSION} · ${APP_BUILD}`;
  })
  .catch(() => { /* label is optional */ });

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
