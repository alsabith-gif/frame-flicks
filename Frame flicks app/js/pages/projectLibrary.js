// pages/projectLibrary.js — the permanent archive of every project ever
// done, active or delivered. Reads the same underlying project records as
// the Dashboard (finishing a project never deletes it — only the trash
// icon does), just presented as a browsable, filterable visual grid
// instead of a working table.

import { getIncome } from '../storage.js';
import { escHtml, formatDate, currency, STAGE_CLASS, PROJECT_PRIORITIES, PROJECT_PRIORITY_CLASS } from '../format.js';

let state = { search: '', client: '', status: '', priority: '', stage: '', sort: 'recent' };

const PALETTE = ['#e7ded0', '#dde3d4', '#e3dcea', '#e9dcdc', '#dbe2e6', '#eae0d0'];
function tileColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function isActive(p) {
  return (p.stage || 'Received') !== 'Delivered';
}

function populateFilters() {
  const all = getIncome();
  const clientSel = document.getElementById('plClientFilter');
  const clients = [...new Set(all.map((p) => p.client).filter(Boolean))].sort();
  const existingClients = new Set([...clientSel.options].map((o) => o.value));
  clients.forEach((c) => {
    if (!existingClients.has(c)) {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      clientSel.appendChild(opt);
    }
  });

  const prioritySel = document.getElementById('plPriorityFilter');
  if (prioritySel.options.length <= 1) {
    PROJECT_PRIORITIES.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      prioritySel.appendChild(opt);
    });
  }
}

function filtered() {
  const q = state.search.trim().toLowerCase();
  let rows = getIncome().filter((p) => {
    if (q && !`${p.project} ${p.client}`.toLowerCase().includes(q)) return false;
    if (state.client && p.client !== state.client) return false;
    if (state.status && p.status !== state.status) return false;
    if (state.priority && (p.priority || 'Normal') !== state.priority) return false;
    if (state.stage === 'active' && !isActive(p)) return false;
    if (state.stage === 'delivered' && isActive(p)) return false;
    return true;
  });

  if (state.sort === 'deadline') {
    rows = rows.sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
  } else {
    rows = rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  return rows;
}

function tileHtml(p) {
  const color = tileColor(p.project || p.id);
  const initial = (p.project || '?').trim().charAt(0).toUpperCase();
  const stage = p.stage || 'Received';
  const priority = p.priority || 'Normal';
  return `
    <div class="pl-card">
      <div class="pl-thumb" style="background:${color};">
        <span class="pl-thumb-initial">${escHtml(initial)}</span>
        ${priority !== 'Normal' ? `<span class="badge ${PROJECT_PRIORITY_CLASS[priority] || 'badge-muted'} pl-thumb-priority">${priority}</span>` : ''}
      </div>
      <div class="pl-card-body">
        <div class="pl-card-title" title="${escHtml(p.project || '')}">${escHtml(p.project || 'Untitled project')}</div>
        <div class="pl-card-client">${escHtml(p.client || '—')}</div>
        <div class="pl-card-meta">
          <span class="badge ${STAGE_CLASS[stage] || 'badge-muted'}">${escHtml(stage)}</span>
          ${p.dueDate ? `<span class="pl-card-due">Due ${formatDate(p.dueDate)}</span>` : ''}
        </div>
        <div class="pl-card-amount">${currency(p.amount)}</div>
      </div>
    </div>`;
}

function render() {
  populateFilters();
  const rows = filtered();
  const grid = document.getElementById('plGrid');
  const emptyEl = document.getElementById('plEmpty');

  if (!rows.length) {
    grid.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';
  grid.innerHTML = rows.map(tileHtml).join('');
}

export function init() {
  document.getElementById('plSearch').addEventListener('input', (e) => { state.search = e.target.value; render(); });
  document.getElementById('plClientFilter').addEventListener('change', (e) => { state.client = e.target.value; render(); });
  document.getElementById('plStatusFilter').addEventListener('change', (e) => { state.status = e.target.value; render(); });
  document.getElementById('plPriorityFilter').addEventListener('change', (e) => { state.priority = e.target.value; render(); });
  document.getElementById('plStageFilter').addEventListener('change', (e) => { state.stage = e.target.value; render(); });
  document.getElementById('plSort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  render();
}
