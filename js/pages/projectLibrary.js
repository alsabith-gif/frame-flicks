// pages/projectLibrary.js — the permanent archive of every project ever
// done, active or delivered. Reads the same underlying project records as
// the Dashboard (finishing a project never deletes it — only the trash
// icon does), just presented as a browsable, filterable visual grid
// instead of a working table.

import { getIncome, saveIncome, getInvoices, getPricing, uid } from '../storage.js';
import {
  escHtml, formatDate, currency, STAGE_CLASS, PROJECT_PRIORITIES, PROJECT_PRIORITY_CLASS,
  getProjectStages, SERVICE_OPTIONS, isServiceTicked,
} from '../format.js';
import { splitPrice } from '../pricing.js';
import { loadWorkers, loadCrewForProject } from '../crew.js';
import { trackLinkFor, openLinkShareModal } from '../tracklink.js';
import { ROLE_LABEL, roleMainDate } from '../roles.js';

let detailId = null;      // the project whose page is open (null = the grid)

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
    <div class="pl-card" data-id="${escHtml(p.id)}" role="button" tabindex="0" title="Open this project">
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
  if (detailId) { renderDetail(); return; }
  showView();
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

// ---------------------------------------------------------------------------
// Project detail page: everything about ONE project, read from the same records the
// Dashboard uses (nothing is copied). Edit / Delete / Saved links reuse the Dashboard's own
// code (income.js), so the rules (paid-crew warning, crew sync, tracker) are the same.

function showView() {
  const d = !!detailId;
  const set = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? '' : 'none'; };
  set('plToolbar', !d); set('plGrid', !d); set('plDetail', d);
  if (d) set('plEmpty', false);
}

// Only normal web links are ever made clickable (never javascript: or data: addresses).
const safeHref = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '#');
const dateOrDash = (d) => (d ? formatDate(d) : '—');
const row = (k, v) => `<div class="pd-kv"><span>${escHtml(k)}</span><b>${v}</b></div>`;
const secHtml = (title, inner, id = '') => `<section class="card pd-sec"${id ? ` id="${id}"` : ''}><h2 class="pd-h2">${escHtml(title)}</h2>${inner}</section>`;

function openDetail(id) { detailId = id; renderDetail(); window.scrollTo(0, 0); }
function closeDetail() { detailId = null; render(); }

function paymentsHtml(p) {
  const inv = getInvoices().find((x) => x.id === p.invoiceId || x.projectId === p.id);
  const amount = Number(p.amount || 0);
  const status = p.status || 'Pending';
  const advance = inv ? Number(inv.advance || 0) : 0;
  const cls = status === 'Paid' ? 'badge-green' : status === 'Partial' ? 'badge-amber' : 'badge-muted';
  let html = row('Project amount', escHtml(currency(amount)));
  html += row('Payment status', `<span class="badge ${cls}">${escHtml(status)}</span>`);
  if (inv && advance > 0) {
    html += row('Advance recorded on the invoice', escHtml(currency(advance)));
    html += row('Balance', escHtml(currency(Math.max(0, amount - advance))));
  }
  return html;
}

function invoicesHtml(p) {
  const list = getInvoices().filter((x) => x.id === p.invoiceId || x.projectId === p.id);
  if (!list.length && !p.invoiceNo) return '<p class="muted">No invoice for this project. Make one in the Invoice Maker.</p>';
  if (!list.length) return row('Invoice', `#${escHtml(p.invoiceNo)}`);
  return list.map((x) => row(`Invoice #${escHtml(x.no || p.invoiceNo || '')}`, escHtml(x.date ? formatDate(x.date) : ''))).join('')
    + '<p class="muted">Open the Invoice Maker (menu) to view or print it.</p>';
}

function splitHtml(p, shootPeople) {
  const amount = Number(p.amount || 0);
  if (!amount) return '<p class="muted">Add a project amount to see the split.</p>';
  const dist = getPricing().distribution;
  const r = splitPrice(amount, dist, { referral: !!p.referral, crew: shootPeople || 1 });
  return r.rows.map((x) => row(`${x.label}${x.unused ? ' (not used — no referral)' : ''}`, escHtml(currency(x.amount)))).join('');
}

function linksHtml(p) {
  const links = p.links || [];
  const trk = p.trackCode ? trackLinkFor(p) : '';
  return `${links.length ? links.map((l) => `<div class="pd-link"><a href="${escHtml(safeHref(l.url))}" target="_blank" rel="noopener">🔗 ${escHtml(l.label || l.url)}</a></div>`).join('') : '<p class="muted">No saved links.</p>'}
    <div class="pd-actions"><button type="button" class="btn btn-ghost btn-sm" data-pd="links">📎 Manage saved links</button></div>
    <h3 class="pd-h3">Client progress link</h3>
    ${trk ? `<div class="pd-link"><input type="text" readonly class="pd-linkbox" value="${escHtml(trk)}"></div>` : '<p class="muted">No client link yet.</p>'}
    <div class="pd-actions"><button type="button" class="btn btn-ghost btn-sm" data-pd="share">${trk ? '🔗 Share link / QR' : '🔗 Create client link'}</button></div>`;
}

// Crew: read from the database (admin only). Filled in after the page is drawn.
async function fillCrew(projectId) {
  const box = document.getElementById('plCrewBody');
  if (!box) return;
  try {
    const [rows, workers] = await Promise.all([loadCrewForProject(projectId), loadWorkers()]);
    if (detailId !== projectId || !document.getElementById('plCrewBody')) return;
    const name = (id) => (workers.find((w) => w.user_id === id) || {}).name || 'Unknown worker';
    if (!rows.length) { box.innerHTML = '<p class="muted">No crew assigned. Use Edit → Assign crew.</p>'; return; }
    const first = rows[0];
    const money = (n) => currency(Number(n || 0));
    box.innerHTML = `<div class="pd-crew">${rows.map((t) => `
      <div class="pd-crewrow">
        <div><b>${escHtml(name(t.worker_id))}</b> <span class="badge ${roleMainDate(t.role) === 'deadline' ? 'badge-amber' : 'badge-purple'}">${escHtml(ROLE_LABEL[t.role] || t.role)}</span></div>
        <div>${escHtml(money(t.pay_amount))} · ${t.pay_status === 'paid' ? '<span class="badge badge-green">Paid</span>' : '<span class="badge badge-muted">Not paid</span>'}</div>
        <div><span class="badge ${t.status === 'done' ? 'badge-green' : t.status === 'in_progress' ? 'badge-blue' : 'badge-muted'}">${t.status === 'in_progress' ? 'In progress' : t.status === 'done' ? 'Done' : 'To do'}</span></div>
      </div>`).join('')}</div>
      ${first.location ? row('Location', escHtml(first.location)) : ''}
      ${first.shoot_time ? row('Shoot time', escHtml(String(first.shoot_time).slice(0, 5))) : ''}
      ${first.notes ? row('Notes for the crew', escHtml(first.notes)) : ''}`;
    const people = rows.filter((t) => roleMainDate(t.role) === 'shoot').length;
    const splitBox = document.getElementById('plSplitBody');
    const p = getIncome().find((x) => x.id === projectId);
    if (splitBox && p) splitBox.innerHTML = splitHtml(p, people);
  } catch (err) {
    box.innerHTML = `<p class="muted">Could not load the crew (${escHtml(err.message || 'error')}).</p>`;
  }
}

function renderDetail() {
  const box = document.getElementById('plDetail');
  if (!box) return;
  const p = getIncome().find((x) => x.id === detailId);
  if (!p) { detailId = null; showView(); render(); return; }
  showView();
  const stage = p.stage || 'Received';
  const stages = getProjectStages(p.services);
  const hist = p.stageHistory || {};
  const services = SERVICE_OPTIONS.filter((s) => isServiceTicked(p.services, s.key)).map((s) => s.label);
  const limit = Number(p.revisionLimit ?? 3);

  box.innerHTML = `
    <button type="button" class="btn btn-ghost btn-sm" data-pd="back">← All projects</button>
    <div class="card pd-head">
      <div>
        <h1 class="pd-title">${escHtml(p.project || 'Untitled project')}</h1>
        <div class="pd-sub">${escHtml(p.client || '—')}
          <span class="badge ${STAGE_CLASS[stage] || 'badge-muted'}">${escHtml(stage)}</span>
          ${p.priority && p.priority !== 'Normal' ? `<span class="badge ${PROJECT_PRIORITY_CLASS[p.priority] || 'badge-muted'}">${escHtml(p.priority)}</span>` : ''}
        </div>
      </div>
      <div class="pd-actions">
        <button type="button" class="btn btn-primary btn-sm" data-pd="edit">✏️ Edit</button>
        <button type="button" class="btn btn-danger btn-sm" data-pd="delete">🗑️ Delete</button>
      </div>
    </div>
    <div class="pd-grid">
      ${secHtml('Overview', [
    row('Client', escHtml(p.client || '—')), p.clientSource ? row('Client source', escHtml(p.clientSource)) : '',
    row('Content type', escHtml(p.contentType || '—')),
    row('Services', services.length ? escHtml(services.join(', ')) : '—'),
    row('Received', dateOrDash(p.date)), row('Shoot date', dateOrDash(p.shootDate)),
    row('Due date', dateOrDash(p.dueDate)), row('Completed', dateOrDash(p.completedDate)),
    row('Revisions', `${Number(p.revisions || 0)} of ${limit}${Number(p.revisions || 0) > limit ? ' <span class="badge badge-red">over</span>' : ''}`),
    row('Came through a referral', p.referral ? 'Yes' : 'No'),
  ].join(''))}
      ${secHtml('Stage history', stages.map((s) => row(s, `${escHtml(dateOrDash(hist[s]))}${s === stage ? ' <span class="badge badge-blue">now</span>' : ''}`)).join(''))}
      ${secHtml('Payments', paymentsHtml(p))}
      ${secHtml('Invoice', invoicesHtml(p))}
      ${secHtml('Crew', '<p class="muted">Loading the crew…</p>', 'plCrew').replace('</section>', '').replace('<p class="muted">Loading the crew…</p>', '<div id="plCrewBody"><p class="muted">Loading the crew…</p></div></section>')}
      ${secHtml('Price split', `<div id="plSplitBody">${splitHtml(p, 1)}</div><p class="muted">Using the percentages in the Price Distributor.</p>`)}
      ${secHtml('Links', linksHtml(p))}
      ${secHtml('Notes', `${p.notes ? `<div class="pd-note">${escHtml(p.notes)}</div>` : '<p class="muted">No private notes.</p>'}
        ${p.clientNote ? `<h3 class="pd-h3">Note shown to the client</h3><div class="pd-note">${escHtml(p.clientNote)}</div>` : ''}`)}
    </div>`;
  fillCrew(p.id);
}

async function onDetailClick(e) {
  const b = e.target.closest('[data-pd]'); if (!b) return;
  const act = b.dataset.pd;
  if (act === 'back') { closeDetail(); return; }
  const inc = await import('./income.js');
  if (act === 'edit') inc.openIncomeModal(detailId);
  else if (act === 'delete') inc.confirmDeleteProject(detailId);
  else if (act === 'links') inc.openLinksModal(detailId);
  else if (act === 'share') {
    const list = getIncome();
    const idx = list.findIndex((x) => x.id === detailId);
    if (idx === -1) return;
    if (!list[idx].trackCode) {
      list[idx].trackCode = uid() + uid();
      saveIncome(list);
      inc.syncTrackerStatus(list[idx]);
      renderDetail();
    }
    openLinkShareModal(list[idx]);
  }
}

export function init() {
  document.getElementById('plSearch').addEventListener('input', (e) => { state.search = e.target.value; render(); });
  document.getElementById('plClientFilter').addEventListener('change', (e) => { state.client = e.target.value; render(); });
  document.getElementById('plStatusFilter').addEventListener('change', (e) => { state.status = e.target.value; render(); });
  document.getElementById('plPriorityFilter').addEventListener('change', (e) => { state.priority = e.target.value; render(); });
  document.getElementById('plStageFilter').addEventListener('change', (e) => { state.stage = e.target.value; render(); });
  document.getElementById('plSort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  const grid = document.getElementById('plGrid');
  if (grid && !grid.dataset.wired) {
    grid.dataset.wired = '1';
    detailId = null;                                  // a fresh page always starts on the grid
    grid.addEventListener('click', (e) => { const c = e.target.closest('.pl-card'); if (c) openDetail(c.dataset.id); });
    grid.addEventListener('keydown', (e) => { if (e.key !== 'Enter' && e.key !== ' ') return; const c = e.target.closest('.pl-card'); if (c) { e.preventDefault(); openDetail(c.dataset.id); } });
    document.getElementById('plDetail').addEventListener('click', onDetailClick);
  }
  // Edits made in the popup (or deletes) refresh whatever is on screen here.
  import('./income.js').then((m) => m.onProjectsChanged(() => { if (document.getElementById('plGrid')) render(); }));
  render();
}
