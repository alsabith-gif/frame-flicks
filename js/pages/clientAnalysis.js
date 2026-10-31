// pages/clientAnalysis.js — project & payment analytics computed from
// Income entries. All local, no AI call needed.

import { received, balance, paymentRows } from '../money.js';
import { getIncome, getClients, getPricing } from '../storage.js';
import { summarize, crewEarnings } from '../finance.js';
import { loadAllCrewTasks, loadWorkers } from '../crew.js';
import { escHtml, formatDate, currency, daysBetween } from '../format.js';

function barHtml(label, value, max, color) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return `
    <div class="bar-row">
      <span class="bar-label">${escHtml(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${pct}%; background:${color || 'var(--accent)'};"></span></span>
      <span class="bar-value">${value}</span>
    </div>`;
}

function monthKey(dateStr) {
  if (!dateStr) return '';
  return dateStr.slice(0, 7);
}
function monthLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
function isOverdue(e) {
  return !!e.dueDate && (e.status === 'Pending' || e.status === 'Partial') && daysBetween(e.dueDate) < 0;
}
function isActive(e) {
  return (e.stage || 'Received') !== 'Delivered';
}

let period = '';
let crewData = { tasks: null, workers: [], error: '' };
const el = (id) => document.getElementById(id);
const neg = (v) => `${v < 0 ? '− ' : ''}${currency(Math.abs(v))}`;

function profitBar(label, value, max, color) {
  const pct = max > 0 ? Math.round((Math.max(0, value) / max) * 100) : 0;
  return `<div class="bar-row"><span class="bar-label">${escHtml(label)}</span><span class="bar-track"><span class="bar-fill" style="width:${pct}%; background:${color};"></span></span><span class="bar-value ${value < 0 ? 'trend-down' : ''}">${neg(value)}</span></div>`;
}

function renderProfit() {
  const projects = getIncome();
  const tasks = Array.isArray(crewData.tasks) ? crewData.tasks : [];
  const dist = getPricing().distribution;
  const months = [...new Set(projects.map((p) => monthKey(p.date)).filter(Boolean))].sort();
  const sel = el('caPeriod');
  if (period && !months.includes(period)) period = '';
  sel.innerHTML = `<option value="">All time</option>${[...months].reverse().map((m) => `<option value="${m}" ${m === period ? 'selected' : ''}>${escHtml(monthLabel(m))}</option>`).join('')}`;
  el('caBanner').style.display = crewData.error ? '' : 'none';
  el('caBanner').textContent = crewData.error ? `Crew pay could not be loaded (${crewData.error}), so profit leaves crew pay out for now. Reopen this page to retry.` : '';
  const f = summarize(projects, tasks, dist, { month: period });
  const T = f.total;
  el('caPeriodNote').textContent = `${period ? monthLabel(period) : 'All time'} — ${T.projects} project${T.projects === 1 ? '' : 's'} started in this period, on their full price. Travel and subscriptions use your Price Distributor %; crew pay counts as soon as it is assigned.`;
  const kp = (cls, l, v) => `<div class="kpi-card ${cls}"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div></div>`;
  el('caProfitKpis').innerHTML = [
    kp('c-blue', 'Billed', currency(T.price)),
    kp('c-amber', 'Crew pay', currency(T.crewAssigned)),
    kp(T.profit < 0 ? 'c-red' : 'c-green', 'Business profit', neg(T.profit)),
    kp('c-purple', 'Margin', `${T.margin}%`),
  ].join('');

  // profit by month (always all months, so you can compare)
  const all = summarize(projects, tasks, dist, {});
  const byMonth = months.map((m) => ({ m, t: summarize(projects, tasks, dist, { month: m }).total }));
  const maxM = Math.max(1, ...byMonth.map((x) => x.t.profit));
  el('caProfitMonths').innerHTML = byMonth.length
    ? byMonth.slice(-12).map((x) => profitBar(monthLabel(x.m), x.t.profit, maxM, 'var(--green, #4f9a6a)')).join('')
    : '<p class="muted">No projects yet.</p>';

  // most profitable clients (in the chosen period)
  const cl = f.clients;
  const maxC = Math.max(1, ...cl.map((c) => c.profit));
  el('caProfitClients').innerHTML = cl.length
    ? cl.slice(0, 8).map((c) => profitBar(c.client, c.profit, maxC, 'var(--green, #4f9a6a)')).join('')
    : '<p class="muted">No projects in this period.</p>';

  // per-client split table
  el('caSplit').innerHTML = cl.length ? `
    <div class="ca-table-wrap"><table class="ca-table"><thead><tr><th>Client</th><th>Billed</th><th>Crew</th><th>Referral</th><th>Travel + subs</th><th>Profit</th><th>Margin</th><th>Paid</th><th>Owes</th></tr></thead><tbody>
    ${cl.map((c) => `<tr><td>${escHtml(c.client)} <small class="muted">(${c.projects})</small></td><td>${currency(c.price)}</td><td>${currency(c.crew)}</td><td>${currency(c.referral)}</td><td>${currency(c.setAside)}</td><td class="${c.profit < 0 ? 'trend-down' : ''}"><b>${neg(c.profit)}</b></td><td>${c.price ? Math.round((c.profit / c.price) * 100) : 0}%</td><td>${currency(c.received)}</td><td>${currency(c.balance)}</td></tr>`).join('')}
    <tr class="ca-total"><td>Total</td><td>${currency(T.price)}</td><td>${currency(T.crewAssigned)}</td><td>${currency(T.referral)}</td><td>${currency(T.setAsideTotal)}</td><td><b>${neg(T.profit)}</b></td><td>${T.margin}%</td><td>${currency(T.received)}</td><td>${currency(T.balance)}</td></tr>
    </tbody></table></div>` : '<p class="muted">No projects in this period.</p>';

  // crew earnings (tasks of projects started in the period)
  const ids = new Set(f.rows.map((r) => r.project.id));
  const ce = crewEarnings(tasks.filter((t) => ids.has(t.project_id)));
  const nameOf = (id) => (crewData.workers.find((w) => w.user_id === id) || {}).name || 'Unknown worker';
  const maxE = Math.max(1, ...ce.map((e) => e.assigned));
  el('caCrew').innerHTML = !Array.isArray(crewData.tasks) ? `<p class="muted">${crewData.error ? 'Crew pay is not available right now.' : 'Loading crew pay…'}</p>`
    : ce.length ? ce.map((e) => profitBar(`${nameOf(e.worker_id)} · ${e.jobs} job${e.jobs === 1 ? '' : 's'}`, e.assigned, maxE, 'var(--blue, #5b7fa6)').replace('</div>', `<span class="ca-sub">paid ${currency(e.paid)} · owed ${currency(e.owed)}</span></div>`)).join('')
    : '<p class="muted">No crew pay in this period.</p>';
}

async function loadCrewData() {
  try {
    const [tasks, workers] = await Promise.all([loadAllCrewTasks(), loadWorkers()]);
    crewData = { tasks, workers, error: '' };
  } catch (err) {
    crewData = { tasks: null, workers: [], error: err.message || 'error' };
  }
  if (el('caPeriod')) renderProfit();
}

export function init() {
  period = '';
  crewData = { tasks: null, workers: [], error: '' };
  renderProfit();
  el('caPeriod').addEventListener('change', (e) => { period = e.target.value; renderProfit(); });
  loadCrewData();
  const all = getIncome();
  const now = new Date();
  const thisYear = now.getFullYear();

  /* ---------- Top KPIs ---------- */
  const active = all.filter(isActive).length;
  const owed = all.reduce((s, e) => s + balance(e), 0);
  const overdueCount = all.filter(isOverdue).length;

  const turnaroundDays = all
    .filter((e) => e.date && e.completedDate)
    .map((e) => daysBetween(e.completedDate, e.date))
    .filter((d) => d >= 0);
  const avgTurnaround = turnaroundDays.length
    ? Math.round(turnaroundDays.reduce((s, d) => s + d, 0) / turnaroundDays.length)
    : null;

  document.getElementById('caActive').textContent = active;
  document.getElementById('caOwed').textContent = currency(owed);
  document.getElementById('caOverdue').textContent = overdueCount;
  document.getElementById('caTurnaround').textContent = avgTurnaround === null ? '—' : `${avgTurnaround}d`;

  /* ---------- Revenue trend (this month vs last) ---------- */
  const curKey = monthKey(now.toISOString().slice(0, 10));
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastKey = monthKey(lastMonthDate.toISOString().slice(0, 10));

  const paidByMonth = {};
  // Money is counted in the month it was RECEIVED (the same way as the Money page).
  paymentRows(all).forEach((r) => {
    const k = monthKey(r.date);
    if (!k) return;
    paidByMonth[k] = (paidByMonth[k] || 0) + r.amount;
  });
  const curAmt = paidByMonth[curKey] || 0;
  const lastAmt = paidByMonth[lastKey] || 0;
  let changeText = 'No prior month to compare yet.';
  let changeCls = '';
  if (lastAmt > 0) {
    const pct = Math.round(((curAmt - lastAmt) / lastAmt) * 100);
    changeCls = pct >= 0 ? 'trend-up' : 'trend-down';
    changeText = `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs last month`;
  } else if (curAmt > 0) {
    changeText = 'No income logged last month.';
  }
  document.getElementById('caTrend').innerHTML = `
    <div class="stat-row"><span class="sr-label">${monthLabel(curKey)}</span><span class="sr-value">${currency(curAmt)}</span></div>
    <div class="stat-row"><span class="sr-label">${monthLabel(lastKey)}</span><span class="sr-value">${currency(lastAmt)}</span></div>
    <div class="stat-row"><span class="sr-label">Change</span><span class="sr-value ${changeCls}">${changeText}</span></div>
  `;

  /* ---------- Best month ever ---------- */
  const monthEntries = Object.entries(paidByMonth).sort((a, b) => b[1] - a[1]);
  document.getElementById('caBestMonth').innerHTML = monthEntries.length
    ? `<div class="big-stat"><div class="bs-value">${currency(monthEntries[0][1])}</div><div class="bs-sub">${monthLabel(monthEntries[0][0])}</div></div>`
    : '<p class="muted">No paid projects yet.</p>';

  /* ---------- Who owes you ---------- */
  const owedByClient = {};
  all.filter((e) => balance(e) > 0).forEach((e) => {
    owedByClient[e.client] = (owedByClient[e.client] || 0) + balance(e);
  });
  const owedList = Object.entries(owedByClient).sort((a, b) => b[1] - a[1]);
  document.getElementById('caWhoOwes').innerHTML = owedList.length
    ? owedList.map(([client, amt]) => `<div class="stat-row"><span class="sr-label">${escHtml(client)}</span><span class="sr-value">${currency(amt)}</span></div>`).join('')
    : '<p class="muted">Nobody owes you anything right now 🎉</p>';

  /* ---------- Due soon (next 14 days) ---------- */
  const dueSoon = all
    .filter((e) => e.dueDate && e.status !== 'Paid' && isActive(e))
    .map((e) => ({ ...e, diff: daysBetween(e.dueDate) }))
    .filter((e) => e.diff <= 14)
    .sort((a, b) => a.diff - b.diff);
  document.getElementById('caDueSoon').innerHTML = dueSoon.length
    ? dueSoon.slice(0, 10).map((e) => {
        const label = e.diff < 0 ? `Overdue ${Math.abs(e.diff)}d` : e.diff === 0 ? 'Due today' : `In ${e.diff}d`;
        const cls = e.diff < 0 ? 'trend-down' : e.diff <= 3 ? '' : '';
        return `<div class="stat-row"><span class="sr-label">${escHtml(e.client)} — ${escHtml(e.project)}</span><span class="sr-value ${e.diff < 0 ? 'trend-down' : ''}">${label}</span></div>`;
      }).join('')
    : '<p class="muted">Nothing due in the next two weeks.</p>';

  /* ---------- Top clients by revenue ---------- */
  const revByClient = {};
  all.forEach((e) => { revByClient[e.client] = (revByClient[e.client] || 0) + Number(e.amount || 0); });
  const topClients = Object.entries(revByClient).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxClient = Math.max(1, ...topClients.map((c) => c[1]));
  document.getElementById('caTopClients').innerHTML = topClients.length
    ? topClients.map(([name, amt]) => barHtml(name, amt, maxClient, 'var(--accent)')).join('')
    : '<p class="muted">No projects yet.</p>';

  /* ---------- Client retention ---------- */
  const projectsByClient = {};
  all.forEach((e) => { (projectsByClient[e.client] = projectsByClient[e.client] || []).push(e); });
  const totalClients = Object.keys(projectsByClient).length;
  const repeatClients = Object.values(projectsByClient).filter((list) => list.length > 1).length;
  const retentionPct = totalClients ? Math.round((repeatClients / totalClients) * 100) : 0;
  document.getElementById('caRetention').innerHTML = totalClients
    ? `<div class="big-stat"><div class="bs-value">${retentionPct}%</div><div class="bs-sub">${repeatClients} of ${totalClients} clients hired you more than once</div></div>`
    : '<p class="muted">No clients yet.</p>';

  /* ---------- Year to date ---------- */
  const ytdEntries = all.filter((e) => e.date && new Date(e.date).getFullYear() === thisYear);
  const ytdEarned = paymentRows(all).filter((r) => r.date && new Date(r.date).getFullYear() === thisYear).reduce((s, r) => s + r.amount, 0);
  const ytdProjects = ytdEntries.length;
  const firstProjectYear = {};
  all.forEach((e) => {
    if (!e.date) return;
    const y = new Date(e.date).getFullYear();
    if (!firstProjectYear[e.client] || y < firstProjectYear[e.client]) firstProjectYear[e.client] = y;
  });
  const newClientsYtd = Object.values(firstProjectYear).filter((y) => y === thisYear).length;
  document.getElementById('caYtd').innerHTML = `
    <div class="stat-row"><span class="sr-label">Earned in ${thisYear}</span><span class="sr-value">${currency(ytdEarned)}</span></div>
    <div class="stat-row"><span class="sr-label">Projects in ${thisYear}</span><span class="sr-value">${ytdProjects}</span></div>
    <div class="stat-row"><span class="sr-label">New clients in ${thisYear}</span><span class="sr-value">${newClientsYtd}</span></div>
  `;

  /* ---------- Revisions ---------- */
  const withRevisions = all.filter((e) => e.revisions !== undefined && e.revisions !== null);
  const avgRevisions = withRevisions.length
    ? (withRevisions.reduce((s, e) => s + Number(e.revisions || 0), 0) / withRevisions.length).toFixed(1)
    : '—';
  const highRevision = all.filter((e) => Number(e.revisions || 0) >= 3).sort((a, b) => (b.revisions || 0) - (a.revisions || 0));
  document.getElementById('caRevisions').innerHTML = `
    <div class="big-stat"><div class="bs-value">${avgRevisions}</div><div class="bs-sub">average revision rounds per project</div></div>
    ${highRevision.length
      ? `<p class="muted mt-16">High-revision projects (3+):</p>` + highRevision.slice(0, 5).map((e) => `<div class="stat-row"><span class="sr-label">${escHtml(e.client)} — ${escHtml(e.project)}</span><span class="sr-value">${e.revisions} rounds</span></div>`).join('')
      : ''}
  `;

  /* ---------- Referrals ---------- */
  const referred = all.filter((e) => e.referral);
  const referralRevenue = referred.reduce((s, e) => s + received(e), 0);
  const totalPaidRevenue = all.reduce((s, e) => s + received(e), 0);
  const referralPct = all.length ? Math.round((referred.length / all.length) * 100) : 0;
  const referralRevPct = totalPaidRevenue ? Math.round((referralRevenue / totalPaidRevenue) * 100) : 0;
  document.getElementById('caReferrals').innerHTML = all.length
    ? `
    <div class="stat-row"><span class="sr-label">Projects from referrals</span><span class="sr-value">${referred.length} (${referralPct}%)</span></div>
    <div class="stat-row"><span class="sr-label">Revenue from referrals</span><span class="sr-value">${currency(referralRevenue)} (${referralRevPct}%)</span></div>
    `
    : '<p class="muted">No projects yet.</p>';

  /* ---------- Revenue by source (unified Clients list — outreach + direct) ---------- */
  const clients = getClients();
  const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));
  const clientByName = Object.fromEntries(clients.map((c) => [c.name.toLowerCase(), c]));
  const revBySource = {};
  all.forEach((e) => {
    const client = (e.clientId && clientById[e.clientId]) || clientByName[(e.client || '').toLowerCase()];
    const source = client?.source || 'Unlinked';
    revBySource[source] = (revBySource[source] || 0) + Number(e.amount || 0);
  });
  const sourceList = Object.entries(revBySource).sort((a, b) => b[1] - a[1]);
  const maxSource = Math.max(1, ...sourceList.map((s) => s[1]));
  document.getElementById('caBySource').innerHTML = sourceList.length
    ? sourceList.map(([source, amt]) => barHtml(source, amt, maxSource, 'var(--blue)')).join('')
    : '<p class="muted">No projects yet.</p>';

  /* ---------- Client health ---------- */
  const healthRows = Object.entries(projectsByClient).map(([client, list]) => {
    const flags = [];
    if (list.some(isOverdue)) flags.push('<span class="badge badge-red">Payment overdue</span>');
    if (list.some((e) => e.dueDate && !isOverdue(e) && daysBetween(e.dueDate) <= 3 && e.status !== 'Paid' && isActive(e))) flags.push('<span class="badge badge-amber">Due soon</span>');
    if (list.some((e) => Number(e.revisions || 0) >= 3)) flags.push('<span class="badge badge-purple">High revisions</span>');
    if (!flags.length) flags.push('<span class="badge badge-green">All clear</span>');
    return { client, flags };
  }).sort((a, b) => (a.flags[0].includes('badge-green') ? 1 : 0) - (b.flags[0].includes('badge-green') ? 1 : 0));

  document.getElementById('caHealth').innerHTML = healthRows.length
    ? healthRows.map((h) => `<div class="health-client"><span class="hc-name">${escHtml(h.client)}</span><span class="hc-flags">${h.flags.join('')}</span></div>`).join('')
    : '<p class="muted">Add a project to see client health here.</p>';
}
