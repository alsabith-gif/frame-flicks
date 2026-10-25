// pages/money.js — admin Money page: payments received, your own expenses, what is left,
// and who still owes you. Everything is stored in the admin's synced data (never visible to crew).
import { getIncome, getExpenses, saveExpenses, uid } from '../storage.js';
import { escHtml, formatDate, currency } from '../format.js';
import { summary, monthsWithData, balance, EXPENSE_CATEGORIES } from '../money.js';
import { getPricing } from '../storage.js';
import { summarize, crewEarnings, crewPaidIn, crewStillOwed } from '../finance.js';
import { loadAllCrewTasks, loadWorkers } from '../crew.js';
import { ROLE_LABEL } from '../roles.js';
import { openPaymentModal, upgradeOldPartials } from '../paymentsUi.js';
import { openConfirm } from '../modal.js';
import { showToast } from '../toast.js';

let month = '';   // '' = all time
let crew = { tasks: null, workers: [], error: '' };   // crew jobs come from the database (admin only)
const $ = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

const projectName = (id) => { const p = getIncome().find((x) => x.id === id); return p ? `${p.client || '—'} — ${p.project || ''}` : ''; };

function render() {
  const projects = getIncome(); const expenses = getExpenses();
  const months = [...new Set([...monthsWithData(projects, expenses), ...projects.map((p) => String(p.date || '').slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m))])].sort().reverse();
  if (month && !months.includes(month)) month = '';
  $('mnMonth').innerHTML = `<option value="">All time</option>${months.map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${escHtml(monthLabel(m))}</option>`).join('')}`;
  const s = summary(projects, expenses, month);
  const tasks = crew.tasks;
  const crewKnown = Array.isArray(tasks);
  const paidOut = crewKnown ? crewPaidIn(tasks, month) : 0;
  const cashLeft = s.received - paidOut - s.expenses;
  const kp = (l, v, cls = '', minus = false) => `<div class="mn-kpi ${cls}"><span>${escHtml(l)}</span><b>${minus ? '− ' : ''}${escHtml(typeof v === 'string' ? v : currency(Math.abs(v)))}</b></div>`;
  $('mnKpis').innerHTML = [
    kp('Received', s.received),
    kp('Paid to crew', crewKnown ? paidOut : '…'),
    kp('Your expenses', s.expenses),
    kp('Cash left', cashLeft, cashLeft < 0 ? 'neg' : '', cashLeft < 0),
    kp('Still to receive (all time)', s.owed),
    kp('Still to pay crew (all time)', crewKnown ? crewStillOwed(tasks) : '…'),
  ].join('');
  $('mnBanner').style.display = crew.error ? '' : 'none';
  $('mnBanner').textContent = crew.error ? `Crew pay could not be loaded (${crew.error}). Cash and profit below leave crew pay out until it loads — press Refresh at the top.` : '';

  // ---- where the money goes (projects started in the period, on their price)
  const dist = getPricing().distribution;
  const f = summarize(projects, crewKnown ? tasks : [], dist, { month });
  const T = f.total;
  const nameOf = (id) => (crew.workers.find((w) => w.user_id === id) || {}).name || 'Unknown worker';
  const pct = (v) => (T.price > 0 ? Math.max(0, (v / T.price) * 100) : 0);
  const seg = [['crew', 'Crew pay (assigned)', T.crewAssigned, `${currency(T.crewPaid)} paid · ${currency(T.crewOwed)} still owed`], ['ref', 'Referral commission', T.referral, ''], ['aside', 'Travel + subscriptions (set aside)', T.setAsideTotal, '']];
  const spent = s.expenseRows.reduce((n, e) => n + (Number(e.amount) || 0), 0);
  $('mnFlowNote').textContent = `${month ? monthLabel(month) : 'All time'} — ${T.projects} project${T.projects === 1 ? '' : 's'} started in this period, on their full price.`;
  $('mnFlow').innerHTML = T.projects ? `
    <div class="mn-bar" role="img" aria-label="How the price is split">${seg.map(([c, , v]) => `<span class="mn-c-${c}" style="width:${pct(v)}%"></span>`).join('')}<span class="mn-c-profit" style="width:${pct(Math.max(0, T.profit))}%"></span></div>
    <div class="mn-flow-row"><span>Billed (project prices)</span><b>${escHtml(currency(T.price))}</b></div>
    ${seg.map(([c, l, v, sub]) => `<div class="mn-flow-row"><span><i class="mn-c-${c}"></i>${escHtml(l)}${sub ? `<small>${escHtml(sub)}</small>` : ''}</span><b>− ${escHtml(currency(v))} <small>${T.price ? Math.round((v / T.price) * 100) : 0}%</small></b></div>`).join('')}
    <div class="mn-flow-row total"><span><i class="mn-c-profit"></i>Left for the business (profit)</span><b class="${T.profit < 0 ? 'neg' : ''}">${T.profit < 0 ? '− ' : ''}${escHtml(currency(Math.abs(T.profit)))} <small>${T.margin}%</small></b></div>
    <div class="mn-flow-row"><span>Received from clients so far</span><b>${escHtml(currency(T.received))}</b></div>
    <div class="mn-flow-row"><span>Still to receive on these projects</span><b>${escHtml(currency(T.balance))}</b></div>
    <p class="muted mn-note" style="margin-top:8px">You set aside ${escHtml(currency(T.setAsideTotal))} for travel and subscriptions; the expenses you typed for this period add up to ${escHtml(currency(spent))}${spent > T.setAsideTotal ? ' — more than you set aside.' : '.'} Typed expenses are not subtracted again from the profit.${T.profit < 0 ? ' The costs are higher than the price here — check the crew pay.' : ''}</p>`
    : '<p class="muted">No projects started in this period.</p>';

  // ---- clients and projects
  const byClient = {};
  f.rows.forEach((r) => { (byClient[(r.project.client || '—').trim() || '—'] = byClient[(r.project.client || '—').trim() || '—'] || []).push(r); });
  const cell = (l, v, neg) => `<div class="${neg ? 'neg' : ''}"><span>${escHtml(l)}</span><b>${neg ? '− ' : ''}${escHtml(currency(Math.abs(v)))}</b></div>`;
  $('mnClients').innerHTML = f.clients.length ? f.clients.map((c) => `
    <div class="mn-grp"><div class="mn-grp-h"><span>${escHtml(c.client)} <small class="muted">· ${c.projects} project${c.projects === 1 ? '' : 's'}</small></span><span>Profit ${c.profit < 0 ? '− ' : ''}${escHtml(currency(Math.abs(c.profit)))}</span></div>
      ${(byClient[c.client] || []).map((r) => `<div class="mn-proj"><div class="mn-proj-name">${escHtml(r.project.project || 'Project')}${r.project.referral ? ' <span class="badge badge-purple">Referral</span>' : ''}${r.f.hasCrew ? '' : ' <span class="badge badge-muted">no crew assigned</span>'}</div>
        <div class="mn-grid">${cell('Price', r.f.price)}${cell('Crew', r.f.crewAssigned)}${cell('Referral', r.f.referral)}${cell('Travel + subs', r.f.setAsideTotal)}${cell('Left (profit)', r.f.profit, r.f.profit < 0)}${cell('Client paid', r.f.received)}${cell('Client owes', r.f.balance)}</div></div>`).join('')}
    </div>`).join('') : '<p class="muted">No projects in this period.</p>';

  // ---- crew pay
  const ce = crewKnown ? crewEarnings(tasks) : [];
  $('mnCrew').innerHTML = !crewKnown ? '<p class="muted">Loading crew pay…</p>' : ce.length
    ? ce.map((e) => `<div class="mn-row"><div class="mn-main">${escHtml(nameOf(e.worker_id))}<small>${e.jobs} job${e.jobs === 1 ? '' : 's'} · assigned ${escHtml(currency(e.assigned))} · paid ${escHtml(currency(e.paid))}</small></div><b>${e.owed > 0 ? `${escHtml(currency(e.owed))} owed` : 'all paid'}</b></div>`).join('')
    : '<p class="muted">No crew pay yet.</p>';

  $('mnExpenses').innerHTML = s.expenseRows.length
    ? s.expenseRows.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((e) => `<div class="mn-row"><div class="mn-main">${escHtml(e.category || 'Other')}${e.note ? ` · ${escHtml(e.note)}` : ''}<small>${e.date ? escHtml(formatDate(e.date)) : '—'}${e.projectId && projectName(e.projectId) ? ` · ${escHtml(projectName(e.projectId))}` : ''}</small></div><b>${escHtml(currency(e.amount))}</b><button type="button" class="btn btn-icon btn-sm" data-exdel="${escHtml(e.id)}" title="Delete">🗑️</button></div>`).join('')
    : '<p class="muted">No expenses for this period.</p>';
  $('mnExpenses').querySelectorAll('[data-exdel]').forEach((b) => b.addEventListener('click', () => {
    openConfirm('Delete this expense?', () => { saveExpenses(getExpenses().filter((x) => x.id !== b.dataset.exdel)); showToast('Expense deleted'); render(); });
  }));

  $('mnPayments').innerHTML = s.payments.length
    ? s.payments.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((r) => `<div class="mn-row"><div class="mn-main">${escHtml(r.project.client || '—')} — ${escHtml(r.project.project || '')}${r.pay && r.pay.note ? ` · ${escHtml(r.pay.note)}` : ''}<small>${r.date ? escHtml(formatDate(r.date)) : '—'}</small></div><b>${escHtml(currency(r.amount))}</b></div>`).join('')
    : '<p class="muted">No payments for this period.</p>';

  const owed = projects.filter((p) => balance(p) > 0).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  $('mnOwed').innerHTML = owed.length
    ? owed.map((p) => `<div class="mn-row"><div class="mn-main">${escHtml(p.client || '—')} — ${escHtml(p.project || '')}<small>${p.dueDate ? `Due ${escHtml(formatDate(p.dueDate))}` : 'No due date'}</small></div><b>${escHtml(currency(balance(p)))}</b><button type="button" class="btn btn-ghost btn-sm" data-pay="${escHtml(p.id)}">Record payment</button></div>`).join('')
    : '<p class="muted">Nothing outstanding. 🎉</p>';
  $('mnOwed').querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => openPaymentModal(b.dataset.pay, render)));
}

async function loadCrew() {
  try {
    const [tasks, workers] = await Promise.all([loadAllCrewTasks(), loadWorkers()]);
    crew = { tasks, workers, error: '' };
  } catch (err) {
    crew = { tasks: null, workers: [], error: err.message || 'error' };
  }
  if ($('mnKpis')) render();
}

export function init() {
  month = '';
  crew = { tasks: null, workers: [], error: '' };
  upgradeOldPartials();
  $('exCat').innerHTML = EXPENSE_CATEGORIES.map((c) => `<option>${escHtml(c)}</option>`).join('');
  $('exDate').value = today();
  $('exProject').innerHTML = '<option value="">— not for one project —</option>' + getIncome().slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((p) => `<option value="${escHtml(p.id)}">${escHtml(p.client || '—')} — ${escHtml(p.project || '')}</option>`).join('');
  $('mnMonth').addEventListener('change', (e) => { month = e.target.value; render(); });
  $('exAdd').addEventListener('click', () => {
    const amt = Math.round(Number($('exAmt').value) || 0);
    if (amt <= 0) { $('exMsg').textContent = 'Enter an amount above 0.'; return; }
    $('exMsg').textContent = '';
    const list = getExpenses();
    list.push({ id: uid(), date: $('exDate').value || today(), amount: amt, category: $('exCat').value, note: $('exNote').value.trim().slice(0, 120), projectId: $('exProject').value || '' });
    saveExpenses(list);
    $('exAmt').value = ''; $('exNote').value = '';
    showToast('Expense added'); render();
  });
  render();
  loadCrew();
}
