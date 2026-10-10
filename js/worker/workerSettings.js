// worker/workerSettings.js — the worker's Settings page: who they are,
// Face ID on/off for this device, change password, log out.

import { escHtml } from '../format.js';
import { logout, setNewPassword } from '../cloud.js';
import * as facelock from '../facelock.js';
import { showToast } from '../toast.js';
import { ROLE_LABEL } from './workerView.js';

export function renderWorkerSettings(root, { profile }) {
  const supported = facelock.isSupported();
  root.innerHTML = `
    <section class="wa-panel">
      <h2 class="wa-h2">Account</h2>
      <div class="wa-kv"><span>Name</span><b>${escHtml(profile.name || '')}</b></div>
      <div class="wa-kv"><span>Email</span><b>${escHtml(profile.email || '')}</b></div>
      <div class="wa-kv"><span>Role</span><b>${escHtml(ROLE_LABEL[profile.job_role] || '—')}</b></div>
    </section>

    <section class="wa-panel">
      <h2 class="wa-h2">Face ID / fingerprint</h2>
      ${supported ? `
        <p class="muted" id="waFaceDesc"></p>
        <p class="wa-error" id="waFaceErr"></p>
        <button class="btn btn-ghost" id="waFaceBtn"></button>`
    : '<p class="muted">Not available on this device or browser.</p>'}
    </section>

    <section class="wa-panel">
      <h2 class="wa-h2">Change password</h2>
      <form id="waPwForm" autocomplete="off">
        <div class="form-field"><label for="waPw1">New password</label><input type="password" id="waPw1" autocomplete="new-password" minlength="8" required></div>
        <div class="form-field"><label for="waPw2">Type it again</label><input type="password" id="waPw2" autocomplete="new-password" minlength="8" required></div>
        <p class="wa-error" id="waPwErr"></p>
        <button type="submit" class="btn btn-primary" id="waPwBtn">Save password</button>
      </form>
    </section>

    <section class="wa-panel">
      <button class="btn btn-ghost wa-logout" id="waLogout">Log out</button>
    </section>`;

  if (supported) {
    const desc = root.querySelector('#waFaceDesc');
    const btn = root.querySelector('#waFaceBtn');
    const err = root.querySelector('#waFaceErr');
    const paint = () => {
      const on = facelock.isEnabled();
      desc.textContent = on ? 'Face ID is ON for this device. The app asks for it every time you open it.' : 'Open the app with Face ID or fingerprint on this device.';
      btn.textContent = on ? 'Turn off Face ID' : 'Turn on Face ID';
    };
    paint();
    btn.addEventListener('click', async () => {
      err.textContent = '';
      btn.disabled = true;
      try {
        if (facelock.isEnabled()) { facelock.disable(); showToast('Face ID turned off'); }
        else { await facelock.enable(); showToast('Face ID turned on'); }
      } catch (e) {
        err.textContent = e.message || 'Could not change Face ID.';
      }
      btn.disabled = false;
      paint();
    });
  }

  const form = root.querySelector('#waPwForm');
  const pwErr = root.querySelector('#waPwErr');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    pwErr.textContent = '';
    const a = root.querySelector('#waPw1').value;
    const b = root.querySelector('#waPw2').value;
    if (a.length < 8) { pwErr.textContent = 'Use at least 8 characters.'; return; }
    if (a !== b) { pwErr.textContent = 'The two passwords do not match.'; return; }
    const btn = root.querySelector('#waPwBtn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await setNewPassword(a);
      form.reset();
      showToast('Password changed');
    } catch (err) {
      pwErr.textContent = err.message;
    }
    btn.disabled = false; btn.textContent = 'Save password';
  });

  root.querySelector('#waLogout').addEventListener('click', async () => {
    await logout();
    window.location.reload();
  });
}
