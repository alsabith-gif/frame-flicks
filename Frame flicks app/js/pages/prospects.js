// pages/prospects.js — core CRM: render, filters, pagination, pipeline
// checkboxes, add/edit modal, groups modal, Gmail compose modal.

import { getProspects, saveProspects, getGroups, saveGroups, getScripts, getFuSettings, uid } from '../storage.js';
import { showToast } from '../toast.js';
import { openModal, closeModal, openConfirm } from '../modal.js';
import { escHtml, formatDate, todayStr, STATUS_CLASS, PRIORITY_CLASS, PLATFORMS, STATUSES, PRIORITIES, followupBadge } from '../format.js';
import { findOrCreateClient } from '../clients.js';

// A Prospect closing is one of the two doors into the shared Clients list
// (the other is adding a client manually on the Dashboard). Their outreach
// platform carries over as the client's source. Safe to call repeatedly —
// findOrCreateClient just links back to the existing client if one's
// already there for this name.
function syncClientForClosedProspect(p) {
  if (p.status !== 'Closed') return;
  const client = findOrCreateClient(p.name, p.platform);
  if (client) p.clientId = client.id;
}

const PAGE_SIZE = 15;

let state = {
  search: '',
  status: '',
  platform: '',
  priority: '',
  niche: '',
  groupId: '',
  page: 1,
};

function refreshPipelineMini() {
  if (window.ctRefreshPipelineMini) window.ctRefreshPipelineMini();
}

// Auto-suggests a follow-up date using the Follow-up 1 offset saved on the
// Follow-ups settings page, counted from a given base date (defaults today).
function autoFollowupDate(fromDateStr) {
  const settings = getFuSettings();
  const base = fromDateStr ? new Date(fromDateStr) : new Date();
  base.setDate(base.getDate() + (settings.day1 || 3));
  return base.toISOString().slice(0, 10);
}

// Opens the prospect's saved profile link. Falls back to a platform search
// for their name/handle when no URL has been saved yet.
function openProspectProfile(p) {
  if (p.url) {
    let href = p.url.trim();
    if (!/^https?:\/\//i.test(href)) href = 'https://' + href;
    window.open(href, '_blank', 'noopener');
    return;
  }
  const query = encodeURIComponent(p.name || '');
  const siteMap = {
    Instagram: `https://www.instagram.com/${query.replace(/^@/, '')}`,
    YouTube: `https://www.youtube.com/results?search_query=${query}`,
    TikTok: `https://www.tiktok.com/search?q=${query}`,
    LinkedIn: `https://www.linkedin.com/search/results/all/?keywords=${query}`,
    Facebook: `https://www.facebook.com/search/top?q=${query}`,
  };
  const url = siteMap[p.platform] || `https://www.google.com/search?q=${query}`;
  window.open(url, '_blank', 'noopener');
  showToast('No profile URL saved — searching instead. Add one via ✏️ Edit.');
}

function filteredProspects() {
  const all = getProspects();
  const q = state.search.trim().toLowerCase();
  return all.filter((p) => {
    if (state.status && p.status !== state.status) return false;
    if (state.platform && p.platform !== state.platform) return false;
    if (state.priority && p.priority !== state.priority) return false;
    if (state.niche && p.niche !== state.niche) return false;
    if (state.groupId && p.groupId !== state.groupId) return false;
    if (q) {
      const hay = `${p.name} ${p.niche} ${p.email} ${p.notes}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderKpis() {
  const all = getProspects();
  const count = (fn) => all.filter(fn).length;
  document.getElementById('kpiTotal').textContent = all.length;
  document.getElementById('kpiReplied').textContent = count((p) => p.status === 'Replied');
  document.getElementById('kpiVideoSent').textContent = count((p) => p.pipe_video);
  document.getElementById('kpiMeetings').textContent = count((p) => p.pipe_meeting);
  document.getElementById('kpiInterested').textContent = count((p) => p.status === 'Interested');
  document.getElementById('kpiClosed').textContent = count((p) => p.status === 'Closed');
}

function renderNicheChips() {
  const all = getProspects();
  const niches = [...new Set(all.map((p) => p.niche).filter(Boolean))];
  const bar = document.getElementById('nicheChipBar');
  if (!niches.length) {
    bar.innerHTML = '';
    return;
  }
  const chips = ['<button class="chip ' + (state.niche === '' ? 'active' : '') + '" data-niche="">All niches</button>']
    .concat(niches.map((n) => `<button class="chip ${state.niche === n ? 'active' : ''}" data-niche="${escHtml(n)}">${escHtml(n)}</button>`));
  bar.innerHTML = chips.join('');
  bar.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.niche = chip.dataset.niche;
      state.page = 1;
      renderAll();
    });
  });
}

function renderGroupChips() {
  const groups = getGroups();
  const bar = document.getElementById('groupChipBar');
  const chips = ['<button class="chip ' + (state.groupId === '' ? 'active' : '') + '" data-gid="">All groups</button>']
    .concat(groups.map((g) => `<button class="chip ${state.groupId === g.id ? 'active' : ''}" data-gid="${g.id}"><span class="group-chip-dot" style="background:${g.color}"></span>${escHtml(g.name)}</button>`));
  bar.innerHTML = chips.join('');
  bar.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.groupId = chip.dataset.gid;
      state.page = 1;
      renderAll();
    });
  });
}

function populateFilterSelects() {
  const statusSel = document.getElementById('statusFilter');
  const platformSel = document.getElementById('platformFilter');
  const prioritySel = document.getElementById('priorityFilter');

  if (statusSel.options.length <= 1) {
    STATUSES.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      statusSel.appendChild(opt);
    });
  }
  if (platformSel.options.length <= 1) {
    PLATFORMS.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      platformSel.appendChild(opt);
    });
  }
  if (prioritySel.options.length <= 1) {
    PRIORITIES.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p; opt.textContent = p;
      prioritySel.appendChild(opt);
    });
  }
}

// The 4 pipeline milestones every prospect moves through, each shown as a
// small lettered circle. Hovering (or long-pressing on mobile) reveals the
// full label via the native title tooltip.
const PIPE_STAGES = [
  { field: 'pipe_email', letter: 'P', label: 'Initial Pitch Sent' },
  { field: 'pipe_video', letter: 'S', label: 'Sample Video Sent' },
  { field: 'pipe_meeting', letter: 'C', label: 'Video Call Done' },
  { field: 'pipe_booked', letter: 'B', label: 'Booked Paid Client' },
];

function pipeCheckHtml(p, field, letter, label) {
  const on = !!p[field];
  return `<span class="pipe-check ${on ? 'checked' : ''}" data-id="${p.id}" data-field="${field}" title="${label}${on ? ' ✓' : ''}">${letter}</span>`;
}

function pipeChecksRow(p) {
  return `<div class="pipe-checks">${PIPE_STAGES.map((s) => pipeCheckHtml(p, s.field, s.letter, s.label)).join('')}</div>`;
}

function renderTable() {
  const all = filteredProspects();
  const total = all.length;
  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = all.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById('prospectsTbody');
  const mobileWrap = document.getElementById('prospectsMobileCards');
  const emptyEl = document.getElementById('prospectsEmpty');

  if (!pageItems.length) {
    tbody.innerHTML = '';
    mobileWrap.innerHTML = '';
    emptyEl.style.display = '';
  } else {
    emptyEl.style.display = 'none';

    tbody.innerHTML = pageItems.map((p, i) => {
      const fu = followupBadge(p.followup);
      const statusCls = STATUS_CLASS[p.status] || 'badge-muted';
      return `
        <tr>
          <td>${start + i + 1}</td>
          <td class="cell-truncate cell-link" data-action="profile" data-id="${p.id}" title="Open ${escHtml(p.platform || 'profile')}: ${escHtml(p.name)}">${escHtml(p.name || '—')}</td>
          <td><span class="badge badge-muted">${escHtml(p.platform || '—')}</span></td>
          <td>
            <select class="inline-select status-select badge ${statusCls}" data-id="${p.id}">
              ${STATUSES.map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </td>
          <td><span class="badge ${fu.cls}">${fu.text}</span></td>
          <td>${pipeChecksRow(p)}</td>
          <td><input type="text" class="inline-input next-action-input" data-id="${p.id}" value="${escHtml(p.next || '')}" placeholder="Next action…"></td>
          <td>
            <div class="row-actions">
              <button class="btn btn-icon" data-action="edit" data-id="${p.id}" title="Edit prospect">✏️</button>
              <button class="btn btn-icon" data-action="gmail" data-id="${p.id}" title="Compose in Gmail">✉️</button>
              <button class="btn btn-icon" data-action="delete" data-id="${p.id}" title="Remove (no reply / declined)">🗑️</button>
            </div>
          </td>
        </tr>`;
    }).join('');

    mobileWrap.innerHTML = pageItems.map((p) => {
      const fu = followupBadge(p.followup);
      const statusCls = STATUS_CLASS[p.status] || 'badge-muted';
      return `
        <div class="mcard">
          <div class="mcard-top">
            <div class="mcard-name cell-link" data-action="profile" data-id="${p.id}">${escHtml(p.name || '—')}</div>
            <span class="badge ${statusCls}">${escHtml(p.status || '—')}</span>
          </div>
          <div class="mcard-row"><span>Platform</span><span>${escHtml(p.platform || '—')}</span></div>
          <div class="mcard-row"><span>Follow-up</span><span class="badge ${fu.cls}">${fu.text}</span></div>
          <div class="mcard-row"><span>Pipeline</span>${pipeChecksRow(p)}</div>
          <div class="mcard-row"><span>Next Action</span><span>${escHtml(p.next || '—')}</span></div>
          <div class="mcard-row">
            <span>Actions</span>
            <span class="row-actions">
              <button class="btn btn-icon btn-sm" data-action="edit" data-id="${p.id}" title="Edit prospect">✏️</button>
              <button class="btn btn-icon btn-sm" data-action="gmail" data-id="${p.id}" title="Compose in Gmail">✉️</button>
              <button class="btn btn-icon btn-sm" data-action="delete" data-id="${p.id}" title="Remove">🗑️</button>
            </span>
          </div>
        </div>`;
    }).join('');
  }

  const info = document.getElementById('pagerInfo');
  const shownStart = total === 0 ? 0 : start + 1;
  const shownEnd = Math.min(start + PAGE_SIZE, total);
  info.textContent = `${shownStart}–${shownEnd} of ${total}`;
  document.getElementById('pagerPrev').disabled = state.page <= 1;
  document.getElementById('pagerNext').disabled = shownEnd >= total;

  wireTableEvents();
}

function wireTableEvents() {
  document.querySelectorAll('.status-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const list = getProspects();
      const p = list.find((x) => x.id === sel.dataset.id);
      if (p) {
        p.status = sel.value;
        // Auto-fill a follow-up date (based on Follow-up settings) the
        // first time a prospect moves to Sent/Replied, if none is set yet.
        if (!p.followup && (sel.value === 'Sent' || sel.value === 'Replied')) {
          p.followup = autoFollowupDate(p.date);
        }
        syncClientForClosedProspect(p);
        saveProspects(list);
        showToast(sel.value === 'Closed' ? 'Status updated — added to Clients' : 'Status updated');
        renderAll();
        refreshPipelineMini();
      }
    });
  });

  document.querySelectorAll('[data-action="profile"]').forEach((el) => {
    el.addEventListener('click', () => {
      const p = getProspects().find((x) => x.id === el.dataset.id);
      if (p) openProspectProfile(p);
    });
  });

  document.querySelectorAll('.pipe-check').forEach((chk) => {
    chk.addEventListener('click', () => {
      const list = getProspects();
      const p = list.find((x) => x.id === chk.dataset.id);
      if (p) {
        p[chk.dataset.field] = !p[chk.dataset.field];
        saveProspects(list);
        renderAll();
      }
    });
  });

  document.querySelectorAll('.next-action-input').forEach((inp) => {
    inp.addEventListener('blur', () => {
      const list = getProspects();
      const p = list.find((x) => x.id === inp.dataset.id);
      if (p && p.next !== inp.value) {
        p.next = inp.value;
        saveProspects(list);
        showToast('Saved ✓');
      }
    });
  });

  document.querySelectorAll('[data-action="edit"]').forEach((el) => {
    el.addEventListener('click', () => openProspectModal(el.dataset.id));
  });

  document.querySelectorAll('[data-action="delete"]').forEach((el) => {
    el.addEventListener('click', () => {
      openConfirm('Delete this prospect? This action cannot be undone.', () => {
        const list = getProspects().filter((x) => x.id !== el.dataset.id);
        saveProspects(list);
        showToast('Prospect deleted');
        renderAll();
        refreshPipelineMini();
      });
    });
  });

  document.querySelectorAll('[data-action="gmail"]').forEach((el) => {
    el.addEventListener('click', () => openGmailModal(el.dataset.id));
  });
}

function renderAll() {
  renderKpis();
  renderNicheChips();
  renderGroupChips();
  renderTable();
}

/* ---------------- Add / Edit modal ---------------- */

function openProspectModal(id) {
  const list = getProspects();
  const existing = id ? list.find((x) => x.id === id) : null;
  const groups = getGroups();

  const body = document.createElement('div');
  body.innerHTML = `
    <div class="form-grid">
      <div class="form-field"><label>Name</label><input type="text" id="fName" value="${escHtml(existing?.name || '')}"></div>
      <div class="form-field"><label>Platform</label>
        <select id="fPlatform">${PLATFORMS.map((p) => `<option value="${p}" ${existing?.platform === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>Niche</label><input type="text" id="fNiche" value="${escHtml(existing?.niche || '')}"></div>
      <div class="form-field"><label>Followers</label><input type="text" id="fFollowers" value="${escHtml(existing?.followers || '')}"></div>
      <div class="form-field"><label>Email</label><input type="email" id="fEmail" value="${escHtml(existing?.email || '')}"></div>
      <div class="form-field"><label>Profile URL</label><input type="text" id="fUrl" value="${escHtml(existing?.url || '')}"></div>
      <div class="form-field"><label>Status</label>
        <select id="fStatus">${STATUSES.map((s) => `<option value="${s}" ${(existing?.status || 'Not Sent') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>Priority</label>
        <select id="fPriority">${PRIORITIES.map((p) => `<option value="${p}" ${(existing?.priority || 'Medium') === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      </div>
      <div class="form-field"><label>Follow-up Date</label><input type="date" id="fFollowup" value="${existing?.followup || (existing ? '' : autoFollowupDate())}"></div>
      <div class="form-field"><label>Group</label>
        <select id="fGroup">
          <option value="">No group</option>
          ${groups.map((g) => `<option value="${g.id}" ${existing?.groupId === g.id ? 'selected' : ''}>${escHtml(g.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-field full"><label>Next Action</label><input type="text" id="fNext" value="${escHtml(existing?.next || '')}"></div>
      <div class="form-field full"><label>Notes</label><textarea id="fNotes">${escHtml(existing?.notes || '')}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-ghost" id="cancelProspectBtn">Cancel</button>
        <button class="btn btn-primary" id="saveProspectBtn">${existing ? 'Save Changes' : 'Add Prospect'}</button>
      </div>
    </div>
  `;

  openModal(existing ? 'Edit Prospect' : 'Add Prospect', body);

  body.querySelector('#cancelProspectBtn').addEventListener('click', closeModal);
  body.querySelector('#saveProspectBtn').addEventListener('click', () => {
    const name = body.querySelector('#fName').value.trim();
    if (!name) {
      showToast('Name is required');
      return;
    }
    const data = {
      name,
      platform: body.querySelector('#fPlatform').value,
      niche: body.querySelector('#fNiche').value.trim(),
      followers: body.querySelector('#fFollowers').value.trim(),
      email: body.querySelector('#fEmail').value.trim(),
      url: body.querySelector('#fUrl').value.trim(),
      status: body.querySelector('#fStatus').value,
      priority: body.querySelector('#fPriority').value,
      followup: body.querySelector('#fFollowup').value,
      groupId: body.querySelector('#fGroup').value,
      next: body.querySelector('#fNext').value.trim(),
      notes: body.querySelector('#fNotes').value.trim(),
    };

    const current = getProspects();
    if (existing) {
      const idx = current.findIndex((x) => x.id === existing.id);
      const merged = { ...current[idx], ...data };
      syncClientForClosedProspect(merged);
      current[idx] = merged;
      saveProspects(current);
      showToast(data.status === 'Closed' ? 'Prospect updated — added to Clients' : 'Prospect updated');
    } else {
      const fresh = {
        id: uid(),
        date: new Date().toISOString().slice(0, 10),
        pipe_email: false, pipe_video: false, pipe_meeting: false, pipe_booked: false,
        aiGroup: '',
        ...data,
      };
      syncClientForClosedProspect(fresh);
      current.push(fresh);
      saveProspects(current);
      showToast(fresh.status === 'Closed' ? 'Prospect added — added to Clients' : 'Prospect added');
    }
    closeModal();
    renderAll();
    refreshPipelineMini();
  });
}

/* ---------------- Groups modal ---------------- */

function openGroupsModal() {
  const body = document.createElement('div');
  const colors = ['#7c6af7', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#f472b6'];
  let pickedColor = colors[0];

  function render() {
    const groups = getGroups();
    body.innerHTML = `
      <div class="form-field">
        <label>New Group Name</label>
        <input type="text" id="newGroupName" placeholder="e.g. Fitness Creators">
        <div class="group-swatches" id="swatches">
          ${colors.map((c) => `<span class="swatch ${c === pickedColor ? 'selected' : ''}" data-color="${c}" style="background:${c}"></span>`).join('')}
        </div>
        <button class="btn btn-primary btn-sm mt-16" id="addGroupBtn" style="align-self:flex-start;">+ Add Group</button>
      </div>
      <div class="mt-16">
        ${groups.length ? groups.map((g) => `
          <div class="group-list-item">
            <span class="dot" style="background:${g.color}"></span>
            <span class="gname">${escHtml(g.name)}</span>
            <button class="btn btn-icon btn-sm" data-edit="${g.id}">✏️</button>
            <button class="btn btn-icon btn-sm" data-del="${g.id}">🗑️</button>
          </div>`).join('') : '<p class="muted">No groups yet.</p>'}
      </div>
    `;

    body.querySelectorAll('.swatch').forEach((s) => {
      s.addEventListener('click', () => { pickedColor = s.dataset.color; render(); });
    });

    body.querySelector('#addGroupBtn').addEventListener('click', () => {
      const nameInput = body.querySelector('#newGroupName');
      const name = nameInput.value.trim();
      if (!name) { showToast('Enter a group name'); return; }
      const list = getGroups();
      list.push({ id: uid(), name, color: pickedColor });
      saveGroups(list);
      showToast('Group added');
      render();
      renderGroupChips();
    });

    body.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const list = getGroups();
        const g = list.find((x) => x.id === btn.dataset.edit);
        const newName = prompt('Rename group', g.name);
        if (newName && newName.trim()) {
          g.name = newName.trim();
          saveGroups(list);
          render();
          renderGroupChips();
        }
      });
    });

    body.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openConfirm('Delete this group? Prospects keep their data but lose the group tag.', () => {
          const list = getGroups().filter((x) => x.id !== btn.dataset.del);
          saveGroups(list);
          showToast('Group deleted');
          render();
          renderGroupChips();
        });
      });
    });
  }

  render();
  openModal('Manage Groups', body);
}

/* ---------------- Gmail compose modal ---------------- */

function openGmailModal(id) {
  const p = getProspects().find((x) => x.id === id);
  if (!p) return;
  const scripts = getScripts() || [];

  const body = document.createElement('div');
  let selectedScriptId = scripts[0]?.id || null;

  function fillFromScript() {
    const s = scripts.find((x) => x.id === selectedScriptId);
    const subjectEl = body.querySelector('#gmSubject');
    const bodyEl = body.querySelector('#gmBody');
    if (s) {
      subjectEl.value = s.title || 'Quick question';
      bodyEl.value = (s.text || '').replaceAll('[Name]', p.name || 'there');
    }
  }

  body.innerHTML = `
    <p class="muted" style="margin-bottom:14px;">To: <b>${escHtml(p.name)}</b> &lt;${escHtml(p.email || 'no email on file')}&gt;</p>
    <div class="label-sm" style="margin-bottom:8px;">Start from a script</div>
    <div id="scriptPickList">
      ${scripts.length ? scripts.map((s) => `
        <div class="script-pick-card ${s.id === selectedScriptId ? 'selected' : ''}" data-sid="${s.id}">
          <div class="spc-title">${s.emoji || ''} ${escHtml(s.title || 'Untitled')}</div>
          <div class="spc-sub">${escHtml(s.subtitle || '')}</div>
        </div>`).join('') : '<p class="muted">No scripts saved yet — head to DM Scripts to add one.</p>'}
    </div>
    <div class="form-field mt-16"><label>Subject</label><input type="text" id="gmSubject"></div>
    <div class="form-field mt-16"><label>Body</label><textarea id="gmBody" style="min-height:160px;"></textarea></div>
    <div class="form-actions">
      <button class="btn btn-ghost" id="gmCancelBtn">Cancel</button>
      <button class="btn btn-danger" id="gmOpenBtn">✉️ Open in Gmail</button>
    </div>
  `;

  openModal('Compose in Gmail', body);
  fillFromScript();

  body.querySelectorAll('.script-pick-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedScriptId = card.dataset.sid;
      body.querySelectorAll('.script-pick-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      fillFromScript();
    });
  });

  body.querySelector('#gmCancelBtn').addEventListener('click', closeModal);
  body.querySelector('#gmOpenBtn').addEventListener('click', () => {
    const subject = encodeURIComponent(body.querySelector('#gmSubject').value);
    const bodyText = encodeURIComponent(body.querySelector('#gmBody').value);
    const to = encodeURIComponent(p.email || '');
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${bodyText}`;
    window.open(url, '_blank');
    closeModal();
    showToast('Opened in Gmail');
  });
}

/* ---------------- Init ---------------- */

export function init() {
  populateFilterSelects();
  state.page = 1;

  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.search = e.target.value;
    state.page = 1;
    renderTable();
  });
  document.getElementById('statusFilter').addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; renderTable(); });
  document.getElementById('platformFilter').addEventListener('change', (e) => { state.platform = e.target.value; state.page = 1; renderTable(); });
  document.getElementById('priorityFilter').addEventListener('change', (e) => { state.priority = e.target.value; state.page = 1; renderTable(); });

  document.getElementById('pagerPrev').addEventListener('click', () => { if (state.page > 1) { state.page--; renderTable(); } });
  document.getElementById('pagerNext').addEventListener('click', () => { state.page++; renderTable(); });

  document.getElementById('groupsBtn').addEventListener('click', openGroupsModal);

  renderAll();
}

export function getAddButton() {
  return { label: '+ Add Prospect', onClick: () => openProspectModal(null) };
}

export function onAddClick() {
  openProspectModal(null);
}
