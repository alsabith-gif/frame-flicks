// main.js — app bootstrap: wires nav clicks, hamburger drawer, pipeline
// mini-stats, and loads the initial page.

import { showPage } from './router.js';
import { initModalSystem } from './modal.js';
import { getProspects, getAppMode, saveAppMode } from './storage.js';

const DEFAULT_PAGE = { outreach: 'prospects', clients: 'income' };

function updatePipelineMini() {
  const list = getProspects();
  const total = list.length;
  const sent = list.filter((p) => p.status && p.status !== 'Not Sent').length;
  const interested = list.filter((p) => p.status === 'Interested').length;
  const closed = list.filter((p) => p.status === 'Closed').length;

  document.getElementById('pmTotal').textContent = total;
  document.getElementById('pmSent').textContent = sent;
  document.getElementById('pmInterested').textContent = interested;
  document.getElementById('pmClosed').textContent = closed;
}

// Any page module can call this after mutating prospects to refresh the
// sidebar mini-stats without a full reload.
window.ctRefreshPipelineMini = updatePipelineMini;

let currentMode = 'outreach';

function applyMode(mode, { navigate = true } = {}) {
  currentMode = mode;
  document.querySelectorAll('.mode-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  document.querySelectorAll('.nav-item').forEach((btn) => {
    const btnMode = btn.dataset.mode;
    btn.style.display = (!btnMode || btnMode === mode) ? '' : 'none';
  });
  document.getElementById('pipelineMini').style.display = mode === 'outreach' ? '' : 'none';
  document.body.dataset.mode = mode;
  saveAppMode(mode);
  if (navigate) showPage(DEFAULT_PAGE[mode]);
}

// Settings page (pages/settings.js) calls this when the user taps a mode tab.
window.ctSetMode = applyMode;

function wireNav() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      showPage(btn.dataset.page);
    });
  });
}

function wireDrawer() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('drawerOverlay');
  const hamburger = document.getElementById('hamburgerBtn');

  hamburger.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  });

  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  });
}

function wireRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.addEventListener('click', () => {
    window.location.reload();
  });
}

export function boot() {
  initModalSystem();
  wireNav();
  wireDrawer();
  wireRefresh();
  updatePipelineMini();
  const savedMode = getAppMode();
  applyMode(savedMode, { navigate: false });
  showPage(DEFAULT_PAGE[savedMode]);
}
