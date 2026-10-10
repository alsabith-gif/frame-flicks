// pages/clientDirectory.js — every client in one place, whichever door they
// came in through (Outreach "Closed" or added manually on the Dashboard).

import { getClients, getIncome } from '../storage.js';
import { escHtml, formatDate, currency } from '../format.js';

let state = { search: '', sort: 'recent' };

function projectsForClient(client) {
  return getIncome().filter((e) => (
    (client.id && e.clientId === client.id) ||
    (e.client || '').trim().toLowerCase() === (client.name || '').trim().toLowerCase()
  ));
}

function revenueFor(projects) {
  return projects.filter((p) => p.status === 'Paid').reduce((s, p) => s + Number(p.amount || 0), 0);
}

function filteredSortedClients() {
  const q = state.search.trim().toLowerCase();
  let rows = getClients()
    .map((c) => {
      const projects = projectsForClient(c);
      return { ...c, projectCount: projects.length, revenue: revenueFor(projects) };
    })
    .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.source || '').toLowerCase().includes(q));

  if (state.sort === 'source') rows = rows.sort((a, b) => (a.source || '').localeCompare(b.source || '') || a.name.localeCompare(b.name));
  else if (state.sort === 'revenue') rows = rows.sort((a, b) => b.revenue - a.revenue);
  else if (state.sort === 'name') rows = rows.sort((a, b) => a.name.localeCompare(b.name));
  else rows = rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  return rows;
}

function renderList() {
  const rows = filteredSortedClients();
  const tbody = document.getElementById('cdTbody');
  const mobileWrap = document.getElementById('cdMobileCards');
  const emptyEl = document.getElementById('cdEmpty');

  if (!getClients().length) {
    tbody.innerHTML = '';
    mobileWrap.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  tbody.innerHTML = rows.map((c) => `
    <tr class="cell-link" data-id="${c.id}">
      <td>${escHtml(c.name)}</td>
      <td><span class="badge badge-blue">${escHtml(c.source || 'Other')}</span></td>
      <td>${formatDate(c.createdAt)}</td>
      <td>${c.projectCount}</td>
      <td>${currency(c.revenue)}</td>
    </tr>`).join('');

  mobileWrap.innerHTML = rows.map((c) => `
    <div class="mcard cell-link" data-id="${c.id}">
      <div class="mcard-top"><div class="mcard-name">${escHtml(c.name)}</div><span class="badge badge-blue">${escHtml(c.source || 'Other')}</span></div>
      <div class="mcard-row"><span>Since</span><span>${formatDate(c.createdAt)}</span></div>
      <div class="mcard-row"><span>Projects</span><span>${c.projectCount}</span></div>
      <div class="mcard-row"><span>Revenue</span><span>${currency(c.revenue)}</span></div>
    </div>`).join('');

  [...tbody.querySelectorAll('[data-id]'), ...mobileWrap.querySelectorAll('[data-id]')].forEach((el) => {
    el.addEventListener('click', () => openProfile(el.dataset.id));
  });
}

const stageCls = { Received: 'badge-blue', 'Rough Cut': 'badge-blue', 'Color & Sound': 'badge-purple', 'Motion & VFX': 'badge-purple', 'AI Elements': 'badge-purple', Review: 'badge-amber', Delivered: 'badge-green' };
const statusCls = { Paid: 'badge-green', Pending: 'badge-amber', Partial: 'badge-blue' };

function openProfile(id) {
  const client = getClients().find((c) => c.id === id);
  if (!client) return;
  const projects = projectsForClient(client).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const revenue = revenueFor(projects);
  const pending = projects.filter((p) => p.status !== 'Paid').reduce((s, p) => s + Number(p.amount || 0), 0);

  document.getElementById('cdListView').style.display = 'none';
  const view = document.getElementById('cdProfileView');
  view.style.display = '';
  view.innerHTML = `
    <button class="btn btn-ghost" id="cdBackBtn">← Back to Clients</button>
    <div class="card mt-16">
      <div class="cd-profile-head">
        <div>
          <div class="cd-profile-name">${escHtml(client.name)}</div>
          <span class="badge badge-blue">${escHtml(client.source || 'Other')}</span>
          <span class="muted" style="margin-left:8px;">Client since ${formatDate(client.createdAt)}</span>
        </div>
      </div>
      <div class="cd-profile-stats">
        <div class="cd-stat"><span class="cd-stat-label">Total revenue (paid)</span><span class="cd-stat-value">${currency(revenue)}</span></div>
        <div class="cd-stat"><span class="cd-stat-label">Outstanding</span><span class="cd-stat-value">${currency(pending)}</span></div>
        <div class="cd-stat"><span class="cd-stat-label">Projects</span><span class="cd-stat-value">${projects.length}</span></div>
      </div>
    </div>
    <div class="card mt-16">
      <div class="card-title">Projects</div>
      ${projects.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Project</th><th>Stage</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              ${projects.map((p) => `
                <tr>
                  <td>${escHtml(p.project)}</td>
                  <td><span class="badge ${stageCls[p.stage] || 'badge-muted'}">${escHtml(p.stage || 'Received')}</span></td>
                  <td>${formatDate(p.date)}</td>
                  <td>${currency(p.amount)}</td>
                  <td><span class="badge ${statusCls[p.status] || 'badge-muted'}">${escHtml(p.status || 'Pending')}</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="field-hint">Edit any project's details from the Dashboard.</p>
      ` : '<p class="muted">No projects linked to this client yet.</p>'}
    </div>
  `;
  view.querySelector('#cdBackBtn').addEventListener('click', closeProfile);
}

function closeProfile() {
  document.getElementById('cdProfileView').style.display = 'none';
  document.getElementById('cdProfileView').innerHTML = '';
  document.getElementById('cdListView').style.display = '';
  renderList();
}

export function init() {
  document.getElementById('cdSearch').addEventListener('input', (e) => { state.search = e.target.value; renderList(); });
  document.getElementById('cdSort').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); });
  renderList();
}
