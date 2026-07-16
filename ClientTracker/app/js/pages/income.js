// pages/income.js — income tracker table, KPIs, filters, and bottom charts.

import { getIncome, saveIncome, uid } from '../storage.js';
import { showToast } from '../toast.js';
import { openModal, closeModal, openConfirm } from '../modal.js';
import { escHtml, formatDate, currency } from '../format.js';

let state = { month: '', status: '' };

function monthKey(dateStr) {
  if (!dateStr) return '';
  return dateStr.slice(0, 7); // YYYY-MM
}
function monthLabel(key) {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function filtered() {
  return getIncome().filter((e) => {
    if (state.month && monthKey(e.date) !== state.month) return false;
    if (state.status && e.status !== state.status) return false;
    return true;
  });
}

function renderKpis() {
  const all = getIncome();
  const paid = all.filter((e) => e.status === 'Paid').reduce((s, e) => s + Number(e.amount || 0), 0);
  const pending = all.filter((e) => e.status === 'Pending' || e.status === 'Partial').reduce((s, e) => s + Number(e.amount || 0), 0);
  const count = all.length;
  const avg = count ? Math.round(all.reduce((s, e) => s + Number(e.amount || 0), 0) / count) : 0;

  document.getElementById('incTotalEarned').textContent = currency(paid);
  document.getElementById('incPending').textContent = currency(pending);
  document.getElementById('incProjects').textContent = count;
  document.getElementById('incAvg').textContent = currency(avg);
}

function populateMonthFilter() {
  const sel = document.getElementById('incMonthFilter');
  const months = [...new Set(getIncome().map((e) => monthKey(e.date)).filter(Boolean))].sort().reverse();
  const existing = new Set([...sel.options].map((o) => o.value));
  months.forEach((m) => {
    if (!existing.has(m)) {
      const opt = document.createElement('option');
      opt.value = m; opt.textContent = monthLabel(m);
      sel.appendChild(opt);
    }
  });
}

function renderTable() {
  const rows = filtered().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const tbody = document.getElementById('incomeTbody');
  const mobileWrap = document.getElementById('incomeMobileCards');
  const emptyEl = document.getElementById('incomeEmpty');

  if (!rows.length) {
    tbody.innerHTML = '';
    mobileWrap.innerHTML = '';
    emptyEl.style.display = '';
  } else {
    emptyEl.style.display = 'none';
    const statusCls = { Paid: 'badge-green', Pending: 'badge-amber', Partial: 'badge-blue' };

    tbody.innerHTML = rows.map((e) => `
      <tr>
        <td>${escHtml(e.client)}</td>
        <td>${escHtml(e.project)}</td>
        <td>${formatDate(e.date)}</td>
        <td>${currency(e.amount)}</td>
        <td><span class="badge ${statusCls[e.status] || 'badge-muted'}">${escHtml(e.status)}</span></td>
        <td class="cell-truncate" title="${escHtml(e.notes || '')}">${escHtml(e.notes || '—')}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-icon" data-action="edit" data-id="${e.id}">✏️</button>
            <button class="btn btn-icon" data-action="delete" data-id="${e.id}">🗑️</button>
          </div>
        </td>
      </tr>`).join('');

    mobileWrap.innerHTML = rows.map((e) => `
      <div class="mcard">
        <div class="mcard-top">
          <div class="mcard-name">${escHtml(e.client)} — ${escHtml(e.project)}</div>
          <span class="badge ${statusCls[e.status] || 'badge-muted'}">${escHtml(e.status)}</span>
        </div>
        <div class="mcard-row"><span>Date</span><span>${formatDate(e.date)}</span></div>
        <div class="mcard-row"><span>Amount</span><span>${currency(e.amount)}</span></div>
        <div class="mcard-row">
          <span>Actions</span>
          <span class="row-actions">
            <button class="btn btn-icon btn-sm" data-action="edit" data-id="${e.id}">✏️</button>
            <button class="btn btn-icon btn-sm" data-action="delete" data-id="${e.id}">🗑️</button>
          </span>
        </div>
      </div>`).join('');
  }

  tbody.querySelectorAll('[data-action="edit"]').forEach((b) => b.addEventListener('click', () => openIncomeModal(b.dataset.id)));
  tbody.querySelectorAll('[data-action="delete"]').forEach((b) => b.addEventListener('click', () => {
    openConfirm('Delete this income entry? This action cannot be undone.', () => {
      saveIncome(getIncome().filter((x) => x.id !== b.dataset.id));
      showToast('Entry deleted');
      renderAll();
    });
  }));
  mobileWrap.querySelectorAll('[data-action="edit"]').forEach((b) => b.addEventListener('click', () => openIncomeModal(b.dataset.id)));
  mobileWrap.querySelectorAll('[data-action="delete"]').forEach((b) => b.addEventListener('click', () => {
    openConfirm('Delete this income entry? This action cannot be undone.', () => {
      saveIncome(getIncome().filter((x) => x.id !== b.dataset.id));
      showToast('Entry deleted');
      renderAll();
    });
  }));
}

function renderCharts() {
  const all = getIncome();

  // Monthly income bar chart
  const byMonth = {};
  all.forEach((e) => {
    const k = monthKey(e.date);
    if (!k) return;
    byMonth[k] = (byMonth[k] || 0) + Number(e.amount || 0);
  });
  const months = Object.keys(byMonth).sort();
  const maxMonth = Math.max(1, ...Object.values(byMonth));
  document.getElementById('monthlyIncomeChart').innerHTML = months.length
    ? months.map((m) => `
      <div class="bar-row">
        <span class="bar-label">${monthLabel(m)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(byMonth[m] / maxMonth) * 100}%; background:var(--green);"></span></span>
        <span class="bar-value">${currency(byMonth[m])}</span>
      </div>`).join('')
    : '<p class="muted">No data yet.</p>';

  // Income by client
  const byClient = {};
  all.forEach((e) => { byClient[e.client] = (byClient[e.client] || 0) + Number(e.amount || 0); });
  const clients = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxClient = Math.max(1, ...clients.map((c) => c[1]));
  document.getElementById('incomeByClient').innerHTML = clients.length
    ? clients.map(([name, amt]) => `
      <div class="bar-row">
        <span class="bar-label">${escHtml(name)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(amt / maxClient) * 100}%; background:var(--accent);"></span></span>
        <span class="bar-value">${currency(amt)}</span>
      </div>`).join('')
    : '<p class="muted">No data yet.</p>';

  // Income split by status
  const paid = all.filter((e) => e.status === 'Paid').length;
  const pending = all.filter((e) => e.status === 'Pending').length;
  const partial = all.filter((e) => e.status === 'Partial').length;
  const maxSplit = Math.max(1, paid, pending, partial);
  document.getElementById('incomeSplit').innerHTML = `
    <div class="bar-row"><span class="bar-label">Paid</span><span class="bar-track"><span class="bar-fill" style="width:${(paid / maxSplit) * 100}%; background:var(--green);"></span></span><span class="bar-value">${paid}</span></div>
    <div class="bar-row"><span class="bar-label">Pending</span><span class="bar-track"><span class="bar-fill" style="width:${(pending / maxSplit) * 100}%; background:var(--amber);"></span></span><span class="bar-value">${pending}</span></div>
    <div class="bar-row"><span class="bar-label">Partial</span><span class="bar-track"><span class="bar-fill" style="width:${(partial / maxSplit) * 100}%; background:var(--blue);"></span></span><span class="bar-value">${partial}</span></div>
  `;
}

function renderAll() {
  renderKpis();
  populateMonthFilter();
  renderTable();
  renderCharts();
}

function openIncomeModal(id) {
  const list = getIncome();
  const existing = id ? list.find((x) => x.id === id) : null;

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-field"><label>Client</label><input type="text" id="iClient" value="${escHtml(existing?.client || '')}"></div>
      <div class="form-field"><label>Project</label><input type="text" id="iProject" value="${escHtml(existing?.project || '')}"></div>
      <div class="form-field"><label>Date</label><input type="date" id="iDate" value="${existing?.date || new Date().toISOString().slice(0, 10)}"></div>
      <div class="form-field"><label>Amount (₹)</label><input type="number" id="iAmount" value="${existing?.amount || ''}"></div>
      <div class="form-field"><label>Status</label>
        <select id="iStatus">
          <option value="Paid" ${existing?.status === 'Paid' ? 'selected' : ''}>Paid</option>
          <option value="Pending" ${existing?.status === 'Pending' ? 'selected' : ''}>Pending</option>
          <option value="Partial" ${existing?.status === 'Partial' ? 'selected' : ''}>Partial</option>
        </select>
      </div>
      <div class="form-field full"><label>Notes</label><textarea id="iNotes">${escHtml(existing?.notes || '')}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="cancelIncomeBtn">Cancel</button>
        <button class="btn btn-primary" id="saveIncomeBtn">${existing ? 'Save Changes' : 'Add Project'}</button>
      </div>
    </div>
  `;
  openModal(existing ? 'Edit Income Entry' : 'Add Project', body);

  body.querySelector('#cancelIncomeBtn').addEventListener('click', closeModal);
  body.querySelector('#saveIncomeBtn').addEventListener('click', () => {
    const client = body.querySelector('#iClient').value.trim();
    const project = body.querySelector('#iProject').value.trim();
    if (!client || !project) { showToast('Client and project are required'); return; }

    const data = {
      client, project,
      date: body.querySelector('#iDate').value,
      amount: Number(body.querySelector('#iAmount').value) || 0,
      status: body.querySelector('#iStatus').value,
      notes: body.querySelector('#iNotes').value.trim(),
    };

    const current = getIncome();
    if (existing) {
      const idx = current.findIndex((x) => x.id === existing.id);
      current[idx] = { ...current[idx], ...data };
      saveIncome(current);
      showToast('Entry updated');
    } else {
      current.push({ id: uid(), ...data });
      saveIncome(current);
      showToast('Project added');
    }
    closeModal();
    renderAll();
  });
}

export function init() {
  document.getElementById('incMonthFilter').addEventListener('change', (e) => { state.month = e.target.value; renderTable(); });
  document.getElementById('incStatusFilter').addEventListener('change', (e) => { state.status = e.target.value; renderTable(); });
  renderAll();
}

export function getAddButton() {
  return { label: '+ Add Project', onClick: () => openIncomeModal(null) };
}
