// bootstrap.js — runs before the rest of the app. Shows a login screen if
// there's no active Supabase session, pulls your data down from the cloud
// once you're logged in, then hands off to main.js's boot().

import { getSession, login, logout, pullAllFromCloud } from './cloud.js';

const gate = document.getElementById('authGate');
const loading = document.getElementById('authLoading');
const shell = document.querySelector('.shell');
const form = document.getElementById('authForm');
const errorEl = document.getElementById('authError');

function showGate() {
  loading.style.display = 'none';
  gate.style.display = 'flex';
  shell.style.display = 'none';
}

function showLoading() {
  gate.style.display = 'none';
  loading.style.display = 'flex';
  shell.style.display = 'none';
}

function showApp() {
  loading.style.display = 'none';
  gate.style.display = 'none';
  shell.style.display = '';
}

async function startApp() {
  showLoading();
  await pullAllFromCloud();
  const { boot } = await import('./main.js');
  boot();
  showApp();
  wireLogout();
}

function wireLogout() {
  const btn = document.getElementById('logoutBtn');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = 'true';
  btn.addEventListener('click', async () => {
    await logout();
    window.location.reload();
  });
}

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
    await startApp();
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
    await startApp();
  } else {
    showGate();
  }
})();
