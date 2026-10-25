// finance.js — ONE place that works out where a project's money goes. Pure (no DOM,
// no storage, no network), so every page (Projects, Money, Analysis) uses the same maths
// and can never disagree.
//
// For one project:
//   price       what the client is charged (project.amount)
//   received    what has actually come in (money.js)
//   crew        the pay ASSIGNED to the crew on this project (counted as soon as it is assigned)
//               crewPaid / crewOwed = how much of it you have / have not paid out yet
//   referral    the referral share (the "referral" row of the Price Distributor) — ONLY if the
//               project is marked as coming from a referral
//   setAsides   every other Price Distributor row except Labour, Editing, Business, Referral
//               (Travel, Subscriptions, and any you add) = percent of the price
//   profit      price − crew − referral − set-asides     (what is left for the business)
// Your own typed expenses (Money page) are shown separately; they are NOT subtracted again.
import { received, balance } from './money.js';

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const rupee = (v) => Math.round(n(v));
const CREW_KEYS = ['labour', 'editing'];
const SPECIAL = ['labour', 'editing', 'business', 'referral'];

// crewRows: worker_tasks rows of THIS project: [{ worker_id, role, pay_amount, pay_status }]
export function projectFinance(p, crewRows = [], distribution = []) {
  const price = rupee(p && p.amount);
  const crew = crewRows.map((t) => ({ worker_id: t.worker_id, role: t.role, pay: rupee(t.pay_amount), paid: t.pay_status === 'paid' }));
  const crewAssigned = crew.reduce((s, c) => s + c.pay, 0);
  const crewPaid = crew.filter((c) => c.paid).reduce((s, c) => s + c.pay, 0);
  const pct = (row) => rupee((price * n(row.pct)) / 100);
  const refRow = distribution.find((d) => d.key === 'referral');
  const referral = p && p.referral && refRow ? pct(refRow) : 0;
  const setAsides = distribution.filter((d) => !SPECIAL.includes(d.key)).map((d) => ({ key: d.key, label: d.label, amount: pct(d) }));
  const setAsideTotal = setAsides.reduce((s, x) => s + x.amount, 0);
  const costs = crewAssigned + referral + setAsideTotal;
  const profit = price - costs;
  return {
    price, received: received(p), balance: balance(p),
    crew, hasCrew: crew.length > 0, crewAssigned, crewPaid, crewOwed: crewAssigned - crewPaid,
    referral, setAsides, setAsideTotal, costs, profit,
    margin: price > 0 ? Math.round((profit / price) * 1000) / 10 : 0,
  };
}

// Group crew rows by project id.
export function crewByProject(tasks = []) {
  const map = {};
  for (const t of tasks) (map[t.project_id] = map[t.project_id] || []).push(t);
  return map;
}

// Totals over many projects, plus one line per client. `month` ('' = all) filters by the
// project's start month, the same way the Dashboard does.
export function summarize(projects, tasks, distribution, { month = '' } = {}) {
  const by = crewByProject(tasks);
  const list = projects.filter((p) => !month || String(p.date || '').slice(0, 7) === month);
  const rows = list.map((p) => ({ project: p, f: projectFinance(p, by[p.id] || [], distribution) }));
  const sum = (k) => rows.reduce((s, r) => s + r.f[k], 0);
  const total = {
    projects: rows.length, price: sum('price'), received: sum('received'), balance: sum('balance'),
    crewAssigned: sum('crewAssigned'), crewPaid: sum('crewPaid'), crewOwed: sum('crewOwed'),
    referral: sum('referral'), setAsideTotal: sum('setAsideTotal'), costs: sum('costs'), profit: sum('profit'),
  };
  total.margin = total.price > 0 ? Math.round((total.profit / total.price) * 1000) / 10 : 0;
  const clients = {};
  for (const r of rows) {
    const key = (r.project.client || '—').trim() || '—';
    const c = clients[key] || (clients[key] = { client: key, projects: 0, price: 0, received: 0, balance: 0, crew: 0, referral: 0, setAside: 0, profit: 0 });
    c.projects += 1; c.price += r.f.price; c.received += r.f.received; c.balance += r.f.balance;
    c.crew += r.f.crewAssigned; c.referral += r.f.referral; c.setAside += r.f.setAsideTotal; c.profit += r.f.profit;
  }
  return { rows, total, clients: Object.values(clients).sort((a, b) => b.profit - a.profit) };
}

// Crew earnings: who was assigned how much (and paid how much), over the given tasks.
export function crewEarnings(tasks = []) {
  const m = {};
  for (const t of tasks) {
    const e = m[t.worker_id] || (m[t.worker_id] = { worker_id: t.worker_id, jobs: 0, assigned: 0, paid: 0 });
    e.jobs += 1; e.assigned += rupee(t.pay_amount); if (t.pay_status === 'paid') e.paid += rupee(t.pay_amount);
  }
  return Object.values(m).map((e) => ({ ...e, owed: e.assigned - e.paid })).sort((a, b) => b.assigned - a.assigned);
}
