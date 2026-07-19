// pages/income.js — income tracker table, KPIs, filters, and bottom charts.

import { getIncome, saveIncome, uid } from '../storage.js';
import { showToast } from '../toast.js';
import { openModal, closeModal, openConfirm } from '../modal.js';
import { escHtml, formatDate, currency, daysBetween, PROJECT_STAGES, STAGE_CLASS } from '../format.js';
import { trackLinkFor, openLinkShareModal } from '../tracklink.js';

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

function isOverdue(e) {
  return !!e.dueDate && (e.status === 'Pending' || e.status === 'Partial') && daysBetween(e.dueDate) < 0;
}

function dueBadge(e) {
  if (!e.dueDate) return { text: '—', cls: 'badge-muted' };
  const diff = daysBetween(e.dueDate);
  if (e.stage === 'Delivered' && e.status === 'Paid') return { text: formatDate(e.dueDate), cls: 'badge-muted' };
  if (diff < 0) return { text: `Overdue (${Math.abs(diff)}d)`, cls: 'badge-red' };
  if (diff === 0) return { text: 'Today!', cls: 'badge-red' };
  if (diff <= 3) return { text: `In ${diff}d`, cls: 'badge-amber' };
  return { text: formatDate(e.dueDate), cls: 'badge-muted' };
}

function renderKpis() {
  const all = getIncome();
  const paid = all.filter((e) => e.status === 'Paid').reduce((s, e) => s + Number(e.amount || 0), 0);
  const pending = all.filter((e) => e.status === 'Pending' || e.status === 'Partial').reduce((s, e) => s + Number(e.amount || 0), 0);
  const active = all.filter((e) => (e.stage || 'Received') !== 'Delivered').length;
  const overdue = all.filter(isOverdue).length;

  document.getElementById('incTotalEarned').textContent = currency(paid);
  document.getElementById('incPending').textContent = currency(pending);
  document.getElementById('incActive').textContent = active;
  document.getElementById('incOverdue').textContent = overdue;
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

function rowActionsHtml(e, size) {
  const sz = size ? ' btn-sm' : '';
  return `
    <div class="row-actions">
      <button class="btn btn-icon${sz}" data-action="link" data-id="${e.id}" title="Share client progress link">🔗</button>
      <button class="btn btn-icon${sz}" data-action="edit" data-id="${e.id}" title="Edit">✏️</button>
      <button class="btn btn-icon${sz}" data-action="delete" data-id="${e.id}" title="Delete">🗑️</button>
    </div>`;
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

    tbody.innerHTML = rows.map((e) => {
      const stage = e.stage || 'Received';
      const due = dueBadge(e);
      return `
      <tr>
        <td>${escHtml(e.client)}</td>
        <td>${escHtml(e.project)}</td>
        <td><span class="badge ${STAGE_CLASS[stage] || 'badge-muted'}">${escHtml(stage)}</span></td>
        <td>${formatDate(e.date)}</td>
        <td><span class="badge ${due.cls}">${due.text}</span></td>
        <td>${currency(e.amount)}</td>
        <td><span class="badge ${statusCls[e.status] || 'badge-muted'}">${escHtml(e.status)}</span></td>
        <td class="cell-truncate" title="${escHtml(e.notes || '')}">${escHtml(e.notes || '—')}</td>
        <td>${rowActionsHtml(e)}</td>
      </tr>`;
    }).join('');

    mobileWrap.innerHTML = rows.map((e) => {
      const stage = e.stage || 'Received';
      const due = dueBadge(e);
      return `
      <div class="mcard">
        <div class="mcard-top">
          <div class="mcard-name">${escHtml(e.client)} — ${escHtml(e.project)}</div>
          <span class="badge ${statusCls[e.status] || 'badge-muted'}">${escHtml(e.status)}</span>
        </div>
        <div class="mcard-row"><span>Stage</span><span class="badge ${STAGE_CLASS[stage] || 'badge-muted'}">${escHtml(stage)}</span></div>
        <div class="mcard-row"><span>Date</span><span>${formatDate(e.date)}</span></div>
        <div class="mcard-row"><span>Due</span><span class="badge ${due.cls}">${due.text}</span></div>
        <div class="mcard-row"><span>Amount</span><span>${currency(e.amount)}</span></div>
        <div class="mcard-row">
          <span>Actions</span>
          <span>${rowActionsHtml(e, true)}</span>
        </div>
      </div>`;
    }).join('');
  }

  function wireActions(root) {
    root.querySelectorAll('[data-action="edit"]').forEach((b) => b.addEventListener('click', () => openIncomeModal(b.dataset.id)));
    root.querySelectorAll('[data-action="delete"]').forEach((b) => b.addEventListener('click', () => {
      openConfirm('Delete this income entry? This action cannot be undone.', () => {
        const entry = getIncome().find((x) => x.id === b.dataset.id);
        saveIncome(getIncome().filter((x) => x.id !== b.dataset.id));
        if (entry?.trackCode) import('../cloud.js').then(({ deleteProjectStatus }) => deleteProjectStatus(entry.trackCode));
        showToast('Entry deleted');
        renderAll();
      });
    }));
    root.querySelectorAll('[data-action="link"]').forEach((b) => b.addEventListener('click', () => {
      const list = getIncome();
      const idx = list.findIndex((x) => x.id === b.dataset.id);
      if (idx === -1) return;
      if (!list[idx].trackCode) {
        list[idx].trackCode = uid() + uid();
        saveIncome(list);
        syncTrackerStatus(list[idx]);
      }
      openLinkShareModal(list[idx]);
    }));
  }
  wireActions(tbody);
  wireActions(mobileWrap);
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
  if (existing && !existing.trackCode) {
    existing.trackCode = uid() + uid();
    saveIncome(list);
    syncTrackerStatus(existing);
  }

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-field"><label>Client</label><input type="text" id="iClient" value="${escHtml(existing?.client || '')}"></div>
      <div class="form-field"><label>Project</label><input type="text" id="iProject" value="${escHtml(existing?.project || '')}"></div>
      <div class="form-field"><label>Stage</label>
        <select id="iStage">${PROJECT_STAGES.map((s) => `<option value="${s}" ${(existing?.stage || 'Received') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>Start Date</label><input type="date" id="iDate" value="${existing?.date || new Date().toISOString().slice(0, 10)}"></div>
      <div class="form-field"><label>Due Date</label><input type="date" id="iDue" value="${existing?.dueDate || ''}"></div>
      <div class="form-field"><label>Completed Date</label><input type="date" id="iCompleted" value="${existing?.completedDate || ''}"></div>
      <div class="form-field"><label>Amount (₹)</label><input type="number" id="iAmount" value="${existing?.amount || ''}"></div>
      <div class="form-field"><label>Status</label>
        <select id="iStatus">
          <option value="Paid" ${existing?.status === 'Paid' ? 'selected' : ''}>Paid</option>
          <option value="Pending" ${existing?.status === 'Pending' ? 'selected' : ''}>Pending</option>
          <option value="Partial" ${existing?.status === 'Partial' ? 'selected' : ''}>Partial</option>
        </select>
      </div>
      <div class="form-field"><label>Revisions so far</label><input type="number" id="iRevisions" min="0" value="${existing?.revisions ?? 0}"></div>
      <div class="form-field">
        <label>Referral?</label>
        <select id="iReferral">
          <option value="no" ${!existing?.referral ? 'selected' : ''}>No</option>
          <option value="yes" ${existing?.referral ? 'selected' : ''}>Yes — came from a referral</option>
        </select>
      </div>
      <div class="form-field full"><label>Notes</label><textarea id="iNotes">${escHtml(existing?.notes || '')}</textarea></div>
      <div class="form-field full"><label>Note shown to client on their progress link</label><textarea id="iClientNote" placeholder="e.g. Sent you the rough cut — check your email!">${escHtml(existing?.clientNote || '')}</textarea></div>
      ${existing ? `<div class="form-field full"><label>Client progress link</label><input type="text" id="iTrackLink" value="${escHtml(trackLinkFor(existing))}" readonly></div>` : ''}
      <div class="form-actions">
        <button class="btn btn-ghost" id="cancelIncomeBtn">Cancel</button>
        ${existing ? '<button class="btn btn-ghost" id="copyLinkBtn">🔗 Share with Client</button>' : ''}
        <button class="btn btn-primary" id="saveIncomeBtn">${existing ? 'Save Changes' : 'Add Project'}</button>
      </div>
    </div>
  `;
  openModal(existing ? 'Edit Income Entry' : 'Add Project', body);

  body.querySelector('#cancelIncomeBtn').addEventListener('click', closeModal);
  if (existing) {
    body.querySelector('#copyLinkBtn').addEventListener('click', () => openLinkShareModal(existing));
    body.querySelector('#iTrackLink').addEventListener('click', (e) => e.target.select());
  }
  body.querySelector('#saveIncomeBtn').addEventListener('click', () => {
    const client = body.querySelector('#iClient').value.trim();
    const project = body.querySelector('#iProject').value.trim();
    if (!client || !project) { showToast('Client and project are required'); return; }

    const data = {
      client, project,
      stage: body.querySelector('#iStage').value,
      date: body.querySelector('#iDate').value,
      dueDate: body.querySelector('#iDue').value,
      completedDate: body.querySelector('#iCompleted').value,
      amount: Number(body.querySelector('#iAmount').value) || 0,
      status: body.querySelector('#iStatus').value,
      revisions: Number(body.querySelector('#iRevisions').value) || 0,
      referral: body.querySelector('#iReferral').value === 'yes',
      notes: body.querySelector('#iNotes').value.trim(),
      clientNote: body.querySelector('#iClientNote').value.trim(),
    };

    const current = getIncome();
    let saved;

    // Auto-capture the date each stage is first reached, so the client
    // tracker page can show a date under each step without you having to
    // type anything extra.
    const today = new Date().toISOString().slice(0, 10);
    const history = { ...(existing?.stageHistory || {}) };
    if (!history.Received) history.Received = data.date || today;
    if (data.stage === 'Delivered' && data.completedDate) {
      history.Delivered = data.completedDate;
    } else if (!history[data.stage]) {
      history[data.stage] = today;
    }
    data.stageHistory = history;

    if (existing) {
      const idx = current.findIndex((x) => x.id === existing.id);
      saved = { ...current[idx], ...data };
      current[idx] = saved;
      saveIncome(current);
      showToast('Entry updated');
    } else {
      saved = { id: uid(), trackCode: uid() + uid(), ...data };
      current.push(saved);
      saveIncome(current);
      showToast('Project added');
    }
    syncTrackerStatus(saved);
    closeModal();
    renderAll();
  });
}

// Pushes the client-visible fields (not the money/notes) to the public
// tracker table so their progress link stays current. Fire-and-forget —
// this shouldn't block or fail the local save.
async function syncTrackerStatus(entry) {
  if (!entry.trackCode) return;
  const { pushProjectStatus } = await import('../cloud.js');
  pushProjectStatus(entry.trackCode, {
    client: entry.client,
    project: entry.project,
    stage: entry.stage || 'Received',
    note: entry.clientNote || '',
    due_date: entry.dueDate || null,
    stage_history: entry.stageHistory || {},
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
