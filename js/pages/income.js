// pages/income.js — Dashboard: project table, KPIs, filters, sort, and
// bottom charts. (Page id/module name stays "income" internally — only the
// visible label changed to "Dashboard" — so nothing else has to be renamed.)

import { getIncome, saveIncome, getContentTypes, getPricing, uid } from '../storage.js';
import { showToast } from '../toast.js';
import { openModal, closeModal, openConfirm } from '../modal.js';
import {
  escHtml, formatDate, currency, daysBetween, STAGE_CLASS, SERVICE_OPTIONS, getProjectStages,
  isServiceTicked, isServiceCompleted, getCountdown,
  PROJECT_PRIORITIES, PROJECT_PRIORITY_CLASS, priorityRank, CLIENT_SOURCES,
} from '../format.js';
import { trackLinkFor, openLinkShareModal } from '../tracklink.js';
import { findOrCreateClient } from '../clients.js';
import { crewSectionHtml, initCrewSection } from '../crewForm.js';
import { deleteCrewForProject, paidJobsForProject } from '../crew.js';

let state = { month: '', status: '', priority: '', contentType: '', sort: 'newest' };
let countdownTimer = null;
let outsideClickWired = false;

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
  let rows = getIncome().filter((e) => {
    if (state.month && monthKey(e.date) !== state.month) return false;
    if (state.status && e.status !== state.status) return false;
    if (state.priority && (e.priority || 'Normal') !== state.priority) return false;
    if (state.contentType && (e.contentType || '') !== state.contentType) return false;
    return true;
  });

  if (state.sort === 'priority') {
    rows = rows.sort((a, b) => priorityRank(a.priority || 'Normal') - priorityRank(b.priority || 'Normal'));
  } else if (state.sort === 'due') {
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

function isOverdue(e) {
  return !!e.dueDate && (e.status === 'Pending' || e.status === 'Partial') && daysBetween(e.dueDate) < 0;
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

function populateOtherFilters() {
  const prioritySel = document.getElementById('incPriorityFilter');
  if (prioritySel.options.length <= 1) {
    PROJECT_PRIORITIES.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      prioritySel.appendChild(opt);
    });
  }
  const ctSel = document.getElementById('incContentTypeFilter');
  const types = getContentTypes();
  const existing = new Set([...ctSel.options].map((o) => o.value));
  types.forEach((t) => {
    if (!existing.has(t)) {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      ctSel.appendChild(opt);
    }
  });
}

/* ---------------- Revisions badge ("1/3", flags when over) ---------------- */
function revisionsBadgeHtml(e) {
  const used = Number(e.revisions || 0);
  const limit = Number(e.revisionLimit ?? 3);
  const over = used > limit;
  return `<button class="rev-pill${over ? ' rev-over' : ''}" data-action="rev-plus" data-id="${e.id}" title="${over ? 'Over the free-revision budget — tap to log another' : 'Tap to log a revision round'}">
    <span class="rev-icon">↻</span>Rev ${used}/${limit}${over ? ' ⚠️' : ''}
  </button>`;
}

/* ---------------- Priority badge (read-only in the table — change it via ✏️ Edit) ---------------- */
function priorityBadgeHtml(e) {
  const p = e.priority || 'Normal';
  if (p === 'Normal') return ''; // don't clutter the row for the common case
  return `<span class="badge ${PROJECT_PRIORITY_CLASS[p] || 'badge-muted'} priority-badge" title="Priority — change this from ✏️ Edit">${p}</span>`;
}

/* ---------------- Internal services indicator (small dots, glance view) --- */
function servicesDotsHtml(e) {
  const ticked = SERVICE_OPTIONS.filter((s) => isServiceTicked(e.services, s.key));
  if (!ticked.length) return '';
  return `<div class="svc-dots">${ticked.map((s) => {
    const done = isServiceCompleted(e.services, s.key);
    return `<span class="svc-dot ${done ? 'done' : ''}" title="${escHtml(s.label)}${done ? ' — completed' : ' — in progress'}"></span>`;
  }).join('')}</div>`;
}

function rowActionsHtml(e, size) {
  const sz = size ? ' btn-sm' : '';
  return `
    <div class="row-actions">
      <button class="btn btn-icon${sz}" data-action="link" data-id="${e.id}" title="Share client progress link">🔗</button>
      <div class="kebab-wrap">
        <button class="btn btn-icon${sz} kebab-btn" data-id="${e.id}" title="More actions">⋮</button>
        <div class="kebab-menu">
          <button data-action="links" data-id="${e.id}">📎 Saved links</button>
          <button data-action="edit" data-id="${e.id}">✏️ Edit</button>
          <button data-action="rev-reset" data-id="${e.id}">↺ Reset revisions</button>
          <button data-action="delete" data-id="${e.id}" class="kebab-danger">🗑️ Delete</button>
        </div>
      </div>
    </div>`;
}

function dueBadgeSpanHtml(e) {
  const c = getCountdown(e.dueDate);
  if (e.stage === 'Delivered' && e.status === 'Paid') {
    return `<span class="badge badge-muted">${formatDate(e.dueDate)}</span>`;
  }
  return `<span class="badge ${c.cls} due-badge" data-due="${e.dueDate || ''}" data-delivered="0">${c.text}</span>`;
}

function renderTable() {
  const rows = filtered();
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
    const statusOptions = ['Paid', 'Pending', 'Partial'];

    tbody.innerHTML = rows.map((e) => {
      const stages = getProjectStages(e.services);
      const stage = stages.includes(e.stage) ? e.stage : 'Received';
      return `
      <tr>
        <td>${escHtml(e.client)}</td>
        <td>
          ${escHtml(e.project)} ${priorityBadgeHtml(e)}
          ${e.contentType ? `<div class="cell-sub">${escHtml(e.contentType)}</div>` : ''}
          ${servicesDotsHtml(e)}
        </td>
        <td>
          <select class="inline-select stage-select badge ${STAGE_CLASS[stage] || 'badge-muted'}" data-id="${e.id}">
            ${stages.map((s) => `<option value="${s}" ${stage === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </td>
        <td>${formatDate(e.date)}</td>
        <td>${dueBadgeSpanHtml(e)}</td>
        <td>${currency(e.amount)}</td>
        <td>
          <select class="inline-select proj-status-select badge ${statusCls[e.status] || 'badge-muted'}" data-id="${e.id}">
            ${statusOptions.map((s) => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </td>
        <td>${revisionsBadgeHtml(e)}</td>
        <td>${rowActionsHtml(e)}</td>
      </tr>`;
    }).join('');

    mobileWrap.innerHTML = rows.map((e) => {
      const stages = getProjectStages(e.services);
      const stage = stages.includes(e.stage) ? e.stage : 'Received';
      return `
      <div class="mcard">
        <div class="mcard-top">
          <div class="mcard-name">${escHtml(e.client)} — ${escHtml(e.project)} ${priorityBadgeHtml(e)}${e.contentType ? `<div class="cell-sub">${escHtml(e.contentType)}</div>` : ''}</div>
          <select class="inline-select proj-status-select badge ${statusCls[e.status] || 'badge-muted'}" data-id="${e.id}">
            ${statusOptions.map((s) => `<option value="${s}" ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="mcard-row"><span>Stage</span>
          <select class="inline-select stage-select badge ${STAGE_CLASS[stage] || 'badge-muted'}" data-id="${e.id}">
            ${stages.map((s) => `<option value="${s}" ${stage === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="mcard-row"><span>Date</span><span>${formatDate(e.date)}</span></div>
        <div class="mcard-row"><span>Due</span>${dueBadgeSpanHtml(e)}</div>
        <div class="mcard-row"><span>Amount</span><span>${currency(e.amount)}</span></div>
        <div class="mcard-row"><span>Revisions</span>${revisionsBadgeHtml(e)}</div>
        <div class="mcard-row">${servicesDotsHtml(e)}</div>
        <div class="mcard-row">
          <span>Actions</span>
          <span>${rowActionsHtml(e, true)}</span>
        </div>
      </div>`;
    }).join('');
  }

  function wireActions(root) {
    root.querySelectorAll('.kebab-btn').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const menu = btn.nextElementSibling;
        const wasOpen = menu.classList.contains('open');
        document.querySelectorAll('.kebab-menu.open').forEach((m) => m.classList.remove('open'));
        if (!wasOpen) menu.classList.add('open');
      });
    });
    root.querySelectorAll('[data-action="edit"]').forEach((b) => b.addEventListener('click', () => openIncomeModal(b.dataset.id)));
    root.querySelectorAll('[data-action="delete"]').forEach((b) => b.addEventListener('click', () => {
      // Removes the project for real (after any warnings below).
      const finishDelete = async (entry, id) => {
        // Workers must not keep a job for a project that no longer exists. Remove
        // their jobs FIRST; if that fails (e.g. offline) keep the project, so
        // nothing is ever left behind on a worker's phone.
        if (entry?.hasCrew) {
          try {
            await deleteCrewForProject(entry.id);
          } catch (err) {
            showToast("Not deleted — couldn't remove the crew's jobs. Check your internet and try again.");
            return;
          }
        }
        saveIncome(getIncome().filter((x) => x.id !== id));
        if (entry?.trackCode) import('../cloud.js').then(({ deleteProjectStatus }) => deleteProjectStatus(entry.trackCode));
        showToast('Entry deleted');
        renderAll();
      };
      openConfirm('Delete this income entry? This action cannot be undone.', async () => {
        const entry = getIncome().find((x) => x.id === b.dataset.id);
        // Deleting a project also deletes its crew jobs — including any you have
        // already marked PAID, which would erase that pay record. Ask first.
        if (entry?.hasCrew) {
          let paid;
          try {
            paid = await paidJobsForProject(entry.id);
          } catch (err) {
            showToast("Not deleted — couldn't check the crew's jobs. Check your internet and try again.");
            return;
          }
          if (paid.length) {
            openConfirm(
              `${paid.length} crew job${paid.length === 1 ? ' on this project is' : 's on this project are'} already marked PAID. Deleting the project also deletes ${paid.length === 1 ? 'that pay record' : 'those pay records'}. Delete anyway?`,
              () => finishDelete(entry, b.dataset.id),
              null,
              'Delete anyway'
            );
            return;
          }
        }
        await finishDelete(entry, b.dataset.id);
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
    root.querySelectorAll('[data-action="links"]').forEach((b) => b.addEventListener('click', () => openLinksModal(b.dataset.id)));
    root.querySelectorAll('[data-action="rev-plus"]').forEach((b) => b.addEventListener('click', () => {
      const list = getIncome();
      const entry = list.find((x) => x.id === b.dataset.id);
      if (!entry) return;
      entry.revisions = Number(entry.revisions || 0) + 1;
      saveIncome(list);
      const over = entry.revisions > Number(entry.revisionLimit ?? 3);
      showToast(over ? `Revision logged — over your ${entry.revisionLimit ?? 3}-revision budget` : 'Revision logged');
      renderAll();
    }));
    root.querySelectorAll('[data-action="rev-reset"]').forEach((b) => b.addEventListener('click', () => {
      openConfirm('Reset the revision count back to 0 for this project?', () => {
        const list = getIncome();
        const entry = list.find((x) => x.id === b.dataset.id);
        if (!entry) return;
        entry.revisions = 0;
        saveIncome(list);
        showToast('Revision count reset');
        renderAll();
      });
    }));
    root.querySelectorAll('.stage-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const list = getIncome();
        const entry = list.find((x) => x.id === sel.dataset.id);
        if (!entry) return;
        entry.stage = sel.value;
        const today = new Date().toISOString().slice(0, 10);
        entry.stageHistory = { ...(entry.stageHistory || {}) };
        if (!entry.stageHistory[entry.stage]) entry.stageHistory[entry.stage] = today;
        if (entry.stage === 'Delivered' && !entry.completedDate) entry.completedDate = today;
        saveIncome(list);
        syncTrackerStatus(entry);
        showToast('Stage updated');
        renderAll();
      });
    });
    root.querySelectorAll('.proj-status-select').forEach((sel) => {
      sel.addEventListener('change', () => {
        const list = getIncome();
        const entry = list.find((x) => x.id === sel.dataset.id);
        if (!entry) return;
        entry.status = sel.value;
        saveIncome(list);
        showToast('Status updated');
        renderAll();
      });
    });
  }
  wireActions(tbody);
  wireActions(mobileWrap);
}

// Re-computes just the countdown badges' text/color every 30s, without a
// full table re-render (so nothing else flickers or loses scroll position).
function tickCountdowns() {
  document.querySelectorAll('.due-badge').forEach((el) => {
    const due = el.dataset.due;
    if (!due) return;
    const c = getCountdown(due);
    el.textContent = c.text;
    el.className = `badge ${c.cls} due-badge`;
    el.dataset.due = due;
  });
}
function startCountdownTimer() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(tickCountdowns, 30000);
}

/* ---------------- Saved links modal (Drive/Dropbox/etc.) ---------------- */
function openLinksModal(id) {
  const list = getIncome();
  const entry = list.find((x) => x.id === id);
  if (!entry) return;
  entry.links = entry.links || [];

  const body = document.createElement('div');

  function render() {
    body.innerHTML = `
      <div id="linksList">
        ${entry.links.length ? entry.links.map((l) => `
          <div class="link-row" data-lid="${l.id}">
            <a href="${escHtml(l.url)}" target="_blank" rel="noopener" class="link-open" title="${escHtml(l.url)}">🔗 ${escHtml(l.label || l.url)}</a>
            <button class="btn btn-icon btn-sm" data-del-link="${l.id}" title="Remove">🗑️</button>
          </div>`).join('') : '<p class="muted">No links saved yet.</p>'}
      </div>
      <div class="form-grid mt-16">
        <div class="form-field"><label>Label</label><input type="text" id="newLinkLabel" placeholder="e.g. Rough Cut — Drive"></div>
        <div class="form-field"><label>URL</label><input type="text" id="newLinkUrl" placeholder="https://drive.google.com/…"></div>
      </div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="closeLinksBtn">Close</button>
        <button class="btn btn-primary" id="addLinkBtn">+ Add Link</button>
      </div>
    `;

    body.querySelector('#closeLinksBtn').addEventListener('click', closeModal);
    body.querySelectorAll('[data-del-link]').forEach((btn) => {
      btn.addEventListener('click', () => {
        entry.links = entry.links.filter((l) => l.id !== btn.dataset.delLink);
        saveIncome(list);
        render();
        renderAll();
      });
    });
    body.querySelector('#addLinkBtn').addEventListener('click', () => {
      const urlInput = body.querySelector('#newLinkUrl');
      let url = urlInput.value.trim();
      if (!url) { showToast('Paste a link first'); return; }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      const label = body.querySelector('#newLinkLabel').value.trim();
      entry.links.push({ id: uid(), label, url });
      saveIncome(list);
      showToast('Link saved');
      render();
      renderAll();
    });
  }

  render();
  openModal(`Links — ${entry.project || 'Project'}`, body);
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
}

function renderAll() {
  renderKpis();
  populateMonthFilter();
  populateOtherFilters();
  renderTable();
  renderCharts();
}

/* ---------------- Add / Edit Project modal ---------------- */

function openIncomeModal(id) {
  const list = getIncome();
  const existing = id ? list.find((x) => x.id === id) : null;
  if (existing && !existing.trackCode) {
    existing.trackCode = uid() + uid();
    saveIncome(list);
    syncTrackerStatus(existing);
  }

  const initialServices = existing?.services || {};
  const initialStages = getProjectStages(initialServices);
  const initialStage = initialStages.includes(existing?.stage) ? existing.stage : 'Received';
  const contentTypes = getContentTypes();
  const workingLinks = (existing?.links || []).slice();

  function serviceRowHtml(opt) {
    const ticked = isServiceTicked(initialServices, opt.key);
    const completed = isServiceCompleted(initialServices, opt.key);
    return `
      <div class="service-row" data-service="${opt.key}">
        <label class="service-check">
          <input type="checkbox" class="svc-ticked" data-service="${opt.key}" ${ticked ? 'checked' : ''}>
          <span>${opt.label}</span>
        </label>
        <label class="service-check svc-completed-wrap" style="${ticked ? '' : 'display:none;'}">
          <input type="checkbox" class="svc-completed" data-service="${opt.key}" ${completed ? 'checked' : ''}>
          <span>Completed</span>
        </label>
      </div>`;
  }

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-field"><label>Client</label><input type="text" id="iClient" value="${escHtml(existing?.client || '')}"></div>
      <div class="form-field"><label>Client Source <span class="field-hint-inline">(only used if this is a brand-new client)</span></label>
        <select id="iClientSource">${CLIENT_SOURCES.map((s) => `<option value="${s}" ${(existing?.clientSource || '') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>Project</label><input type="text" id="iProject" value="${escHtml(existing?.project || '')}"></div>
      <div class="form-field"><label>Content Type</label>
        <select id="iContentType">
          <option value="">—</option>
          ${contentTypes.map((t) => `<option value="${escHtml(t)}" ${existing?.contentType === t ? 'selected' : ''}>${escHtml(t)}</option>`).join('')}
        </select>
      </div>
      <div class="form-field full">
        <label>Services for this project</label>
        <div class="service-check-grid" id="iServices">
          ${SERVICE_OPTIONS.map(serviceRowHtml).join('')}
        </div>
        <p class="field-hint">Tick a service to add it to your internal tracking and (grouped) to the client's checklist. Tick "Completed" once that service is actually done — the client's checklist item only shows complete once every ticked service in its group is completed. Color Grading &amp; Sound Design share one step. Motion Graphics &amp; Visual Effects share one step. Untick a service and its step disappears from the client's link.</p>
      </div>
      <div class="form-field"><label>Stage</label>
        <select id="iStage">${initialStages.map((s) => `<option value="${s}" ${initialStage === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>Priority</label>
        <select id="iPriority">${PROJECT_PRIORITIES.map((p) => `<option value="${p}" ${(existing?.priority || 'Normal') === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>Start Date</label><input type="date" id="iDate" value="${existing?.date || new Date().toISOString().slice(0, 10)}"></div>
      <div class="form-field"><label>🎬 Shoot Date</label><input type="date" id="iShoot" value="${existing?.shootDate || ''}"></div>
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
      <div class="form-field"><label>Free revisions included</label><input type="number" id="iRevisionLimit" min="0" value="${existing?.revisionLimit ?? 3}"></div>
      <div class="form-field">
        <label>Referral?</label>
        <select id="iReferral">
          <option value="no" ${!existing?.referral ? 'selected' : ''}>No</option>
          <option value="yes" ${existing?.referral ? 'selected' : ''}>Yes — came from a referral</option>
        </select>
      </div>
      ${crewSectionHtml()}
      <div class="form-field full"><label>Notes</label><textarea id="iNotes">${escHtml(existing?.notes || '')}</textarea></div>
      <div class="form-field full"><label>Note shown to client on their progress link</label><textarea id="iClientNote" placeholder="e.g. Sent you the rough cut — check your email!">${escHtml(existing?.clientNote || '')}</textarea></div>

      <div class="form-field full">
        <label>Saved links (Drive, Dropbox, etc.)</label>
        <div id="modalLinksList" class="modal-links-list"></div>
        <div class="modal-links-add">
          <input type="text" id="mlLabel" placeholder="Label (optional)">
          <input type="text" id="mlUrl" placeholder="https://…">
          <button type="button" class="btn btn-ghost btn-sm" id="mlAddBtn">+ Add</button>
        </div>
      </div>

      ${existing ? `<div class="form-field full"><label>Client progress link</label><input type="text" id="iTrackLink" value="${escHtml(trackLinkFor(existing))}" readonly></div>` : ''}
      <div class="form-actions">
        <button class="btn btn-ghost" id="cancelIncomeBtn">Cancel</button>
        ${existing ? '<button class="btn btn-ghost" id="copyLinkBtn">🔗 Share with Client</button>' : ''}
        <button class="btn btn-primary" id="saveIncomeBtn">${existing ? 'Save Changes' : 'Add Project'}</button>
      </div>
    </div>
  `;
  openModal(existing ? 'Edit Project' : 'Add Project', body);

  const crew = initCrewSection(body, {
    projectId: existing?.id || null,
    distribution: getPricing().distribution,
    getAmount: () => body.querySelector('#iAmount').value,
    getReferral: () => body.querySelector('#iReferral').value === 'yes',
  });
  crew.init();
  // Suggested pay follows the amount and the referral choice as you type.
  body.querySelector('#iAmount').addEventListener('input', () => crew.recalc());
  body.querySelector('#iReferral').addEventListener('change', () => crew.recalc());
  // After the first save of a NEW project this holds it, so pressing Save again
  // (e.g. to retry the crew) updates that project instead of making a second one.
  let target = existing;

  function currentServices() {
    const services = {};
    body.querySelectorAll('.service-row').forEach((row) => {
      const key = row.dataset.service;
      const ticked = row.querySelector('.svc-ticked').checked;
      const completed = row.querySelector('.svc-completed').checked;
      services[key] = { ticked, completed: ticked ? completed : false };
    });
    return services;
  }
  function rebuildStageOptions() {
    const stages = getProjectStages(currentServices());
    const stageSel = body.querySelector('#iStage');
    const prev = stageSel.value;
    const keep = stages.includes(prev) ? prev : stages[Math.min(stages.indexOf('Rough Cut') + 1, stages.length - 1)] || 'Received';
    stageSel.innerHTML = stages.map((s) => `<option value="${s}" ${keep === s ? 'selected' : ''}>${s}</option>`).join('');
  }
  body.querySelectorAll('.svc-ticked').forEach((cb) => cb.addEventListener('change', () => {
    const row = cb.closest('.service-row');
    const wrap = row.querySelector('.svc-completed-wrap');
    wrap.style.display = cb.checked ? '' : 'none';
    if (!cb.checked) row.querySelector('.svc-completed').checked = false;
    rebuildStageOptions();
  }));
  body.querySelectorAll('.svc-completed').forEach((cb) => cb.addEventListener('change', rebuildStageOptions));

  function renderModalLinks() {
    const wrap = body.querySelector('#modalLinksList');
    wrap.innerHTML = workingLinks.length
      ? workingLinks.map((l) => `
        <div class="link-row" data-lid="${l.id}">
          <a href="${escHtml(l.url)}" target="_blank" rel="noopener" class="link-open" title="${escHtml(l.url)}">🔗 ${escHtml(l.label || l.url)}</a>
          <button type="button" class="btn btn-icon btn-sm" data-del-ml="${l.id}" title="Remove">🗑️</button>
        </div>`).join('')
      : '<p class="muted">No links saved yet.</p>';
    wrap.querySelectorAll('[data-del-ml]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = workingLinks.findIndex((l) => l.id === btn.dataset.delMl);
        if (idx !== -1) workingLinks.splice(idx, 1);
        renderModalLinks();
      });
    });
  }
  renderModalLinks();
  body.querySelector('#mlAddBtn').addEventListener('click', () => {
    const urlInput = body.querySelector('#mlUrl');
    let url = urlInput.value.trim();
    if (!url) { showToast('Paste a link first'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const label = body.querySelector('#mlLabel').value.trim();
    workingLinks.push({ id: uid(), label, url });
    body.querySelector('#mlLabel').value = '';
    body.querySelector('#mlUrl').value = '';
    renderModalLinks();
  });

  body.querySelector('#cancelIncomeBtn').addEventListener('click', closeModal);
  if (existing) {
    body.querySelector('#copyLinkBtn').addEventListener('click', () => openLinkShareModal(existing));
    body.querySelector('#iTrackLink').addEventListener('click', (e) => e.target.select());
  }
  body.querySelector('#saveIncomeBtn').addEventListener('click', async () => {
    const client = body.querySelector('#iClient').value.trim();
    const project = body.querySelector('#iProject').value.trim();
    if (!client || !project) { showToast('Client and project are required'); return; }
    const crewProblem = crew.validate();   // check the crew BEFORE saving anything
    if (crewProblem) { crew.showError(crewProblem); body.querySelector('.crew-section').scrollIntoView({ block: 'center' }); return; }

    const clientSource = body.querySelector('#iClientSource').value;
    const clientRecord = findOrCreateClient(client, clientSource);

    const data = {
      client, project,
      clientId: clientRecord?.id,
      clientSource,
      contentType: body.querySelector('#iContentType').value,
      services: currentServices(),
      stage: body.querySelector('#iStage').value,
      priority: body.querySelector('#iPriority').value,
      date: body.querySelector('#iDate').value,
      shootDate: body.querySelector('#iShoot').value,
      dueDate: body.querySelector('#iDue').value,
      completedDate: body.querySelector('#iCompleted').value,
      amount: Number(body.querySelector('#iAmount').value) || 0,
      status: body.querySelector('#iStatus').value,
      revisions: Number(body.querySelector('#iRevisions').value) || 0,
      revisionLimit: Number(body.querySelector('#iRevisionLimit').value) || 0,
      referral: body.querySelector('#iReferral').value === 'yes',
      notes: body.querySelector('#iNotes').value.trim(),
      clientNote: body.querySelector('#iClientNote').value.trim(),
      links: workingLinks,
    };

    const current = getIncome();
    let saved;

    const today = new Date().toISOString().slice(0, 10);
    const history = { ...(target?.stageHistory || {}) };
    if (!history.Received) history.Received = data.date || today;
    if (data.stage === 'Delivered' && data.completedDate) {
      history.Delivered = data.completedDate;
    } else if (!history[data.stage]) {
      history[data.stage] = today;
    }
    data.stageHistory = history;

    // Remember whether this project has crew jobs, so deleting it can clean them up.
    // (Only set when the crew was actually read; otherwise leave the old value.)
    if (crew.isLoaded()) data.hasCrew = crew.count() > 0 || crew.existingCount() > 0;

    let toastMsg;
    if (target) {
      const idx = current.findIndex((x) => x.id === target.id);
      saved = { ...current[idx], ...data };
      current[idx] = saved;
      saveIncome(current);
      toastMsg = 'Entry updated';
    } else {
      saved = { id: uid(), trackCode: uid() + uid(), ...data };
      current.push(saved);
      saveIncome(current);
      toastMsg = 'Project added';
    }
    target = saved;
    syncTrackerStatus(saved);
    renderAll();

    if (crew.needsSync()) {
      const saveBtn = body.querySelector('#saveIncomeBtn');
      saveBtn.disabled = true;
      try {
        const res = await crew.sync(saved);
        if (res.changed) toastMsg += ' · crew updated';
        // The whole crew was removed and the server confirms none are left:
        // the project no longer has crew jobs to clean up later.
        if (crew.count() === 0 && crew.existingCount() === 0 && saved.hasCrew) {
          const list = getIncome();
          const i = list.findIndex((x) => x.id === saved.id);
          if (i !== -1) { list[i] = { ...list[i], hasCrew: false }; saveIncome(list); }
        }
      } catch (err) {
        saveBtn.disabled = false;
        crew.showError(`Project saved, but the crew could not be saved: ${err.message} Press Save again to retry.`);
        return;   // keep the form open so nothing is lost
      }
    }
    showToast(toastMsg);
    closeModal();
    renderAll();
  });
}

async function syncTrackerStatus(entry) {
  if (!entry.trackCode) return;
  const { pushProjectStatus } = await import('../cloud.js');
  pushProjectStatus(entry.trackCode, {
    client: entry.client,
    project: entry.project,
    stage: entry.stage || 'Received',
    stages: getProjectStages(entry.services),
    services: entry.services || {},
    note: entry.clientNote || '',
    due_date: entry.dueDate || null,
    stage_history: entry.stageHistory || {},
  });
}

export function init() {
  document.getElementById('incMonthFilter').addEventListener('change', (e) => { state.month = e.target.value; renderTable(); });
  document.getElementById('incStatusFilter').addEventListener('change', (e) => { state.status = e.target.value; renderTable(); });
  document.getElementById('incPriorityFilter').addEventListener('change', (e) => { state.priority = e.target.value; renderTable(); });
  document.getElementById('incContentTypeFilter').addEventListener('change', (e) => { state.contentType = e.target.value; renderTable(); });
  document.getElementById('incSort').addEventListener('change', (e) => { state.sort = e.target.value; renderTable(); });
  renderAll();
  startCountdownTimer();
  if (!outsideClickWired) {
    document.addEventListener('click', () => {
      document.querySelectorAll('.kebab-menu.open').forEach((m) => m.classList.remove('open'));
    });
    outsideClickWired = true;
  }
}

export function getAddButton() {
  return { label: '+ Add Project', onClick: () => openIncomeModal(null) };
}
