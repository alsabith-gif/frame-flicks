// pages/clientAnalysis.js — project & payment analytics computed from
// Income entries. All local, no AI call needed.

import { getIncome, getClients } from '../storage.js';
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

export function init() {
  const all = getIncome();
  const now = new Date();
  const thisYear = now.getFullYear();

  /* ---------- Top KPIs ---------- */
  const active = all.filter(isActive).length;
  const owed = all.filter((e) => e.status === 'Pending' || e.status === 'Partial').reduce((s, e) => s + Number(e.amount || 0), 0);
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
  all.filter((e) => e.status === 'Paid').forEach((e) => {
    const k = monthKey(e.date);
    if (!k) return;
    paidByMonth[k] = (paidByMonth[k] || 0) + Number(e.amount || 0);
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
  all.filter((e) => e.status === 'Pending' || e.status === 'Partial').forEach((e) => {
    owedByClient[e.client] = (owedByClient[e.client] || 0) + Number(e.amount || 0);
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
  const ytdEarned = ytdEntries.filter((e) => e.status === 'Paid').reduce((s, e) => s + Number(e.amount || 0), 0);
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
  const referralRevenue = referred.filter((e) => e.status === 'Paid').reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalPaidRevenue = all.filter((e) => e.status === 'Paid').reduce((s, e) => s + Number(e.amount || 0), 0);
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
