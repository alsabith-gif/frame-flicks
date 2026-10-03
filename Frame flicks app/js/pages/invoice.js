// pages/invoice.js — invoice maker. Prices come from the editable pricing
// settings; "What's included" fills itself from the price but every line is
// editable. Printing happens in a clean iframe so the colours and layout
// come out exactly as shown (A4, full colour).

import { getPricing, savePricing, getInvoices, saveInvoices, getIncome, saveIncome, uid } from '../storage.js';
import { findOrCreateClient } from '../clients.js';
import { calcInvoice, addOnCatalog, SIZE_LABELS, DELIVERY_LABELS } from '../pricing.js';
import { escHtml, currency } from '../format.js';
import { openModal, closeModal } from '../modal.js';
import { showToast } from '../toast.js';

let P; // pricing
let S; // current invoice
const $ = (id) => document.getElementById(id);

const THEMES = {
  green: { ink: '#14301f', acc: '#a9772c', acc2: '#e2b765', tint: '#eef3ec', deep: '#2f5d3f' },
  gold: { ink: '#221f1a', acc: '#c9a24b', acc2: '#e6c778', tint: '#f6efdc', deep: '#8a6b3d' },
  teal: { ink: '#14302c', acc: '#2f9e8a', acc2: '#8fd9c9', tint: '#e3f3ef', deep: '#1f6f60' },
  rose: { ink: '#3a1f2b', acc: '#c4577d', acc2: '#f2a7c0', tint: '#fbe9f0', deep: '#8a3555' },
  blue: { ink: '#1b2a41', acc: '#3f7fc4', acc2: '#9cc4ec', tint: '#e6eff9', deep: '#2a5a94' },
};

const pad = (n) => String(n).padStart(2, '0');
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const monthStart = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
const monthEnd = (st) => { const d = new Date(st + 'T00:00:00'); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`; };
function fresh(type = 'function') {
  const k = P.packages[0] || {};
  return { type, pkgId: k.id, pkgPrice: k.price || 0, handle: '', pStart: monthStart(), pEnd: monthEnd(monthStart()), features: null, stats: null, mTerms: P.business.monthlyTerms || '', id: uid(), no: '', client: '', phone: '', event: '', location: '', eventDate: '', date: todayStr(), size: 'small', delivery: 'normal', lines: [], discount: 0, advance: 0, theme: type === 'monthly' ? 'green' : 'gold', groups: null, terms: P.business.terms || '' };
}
const isMo = () => S.type === 'monthly';
const invNo = () => S.no || (isMo() ? `INV-${S.date.slice(0, 7).replace('-', '')}-${pad(getInvoices().length + 1)}` : `INV-${S.date.replace(/-/g, '')}-${pad(getInvoices().length + 1)}`);
const pkgOf = () => P.packages.find((x) => x.id === S.pkgId) || P.packages[0];
const extraReelsQty = () => S.lines.filter((l) => l.key === 'reel').reduce((n, l) => n + (Number(l.qty) || 0), 0);
const featList = () => S.features || pkgOf().features;
const statList = () => S.stats || [`${pkgOf().reels + extraReelsQty()} | Reels`, `${pkgOf().sessions} | Shooting sessions`];
const split = (line) => { const [a, ...r] = line.split('|'); return [a.trim(), r.join('|').trim()]; };
const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// What the client gets, worked out from the package + add-ons.
function autoGroups() {
  const q = (k) => S.lines.filter((l) => l.key === k).reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const hrs = Number(P.baseHours) + q('hour');
  const reels = Number(P.baseReels) + q('reel');
  const locs = 1 + q('location');
  const km = q('travel');
  const extras = S.lines.filter((l) => !['reel', 'hour', 'location', 'travel'].includes(l.key)).map((l) => l.label).filter(Boolean);
  const cover = [`${P.baseCrew}-person crew`, `Up to ${hrs} hours of shooting`];
  if (locs > 1) cover.push(`${locs} locations`);
  cover.push(km ? `Travel for ${km} km beyond the local area` : 'Local travel included');
  const del = { normal: 'Within 48 hours', fast: 'Priority, within 24 hours', sameDay: 'Same-day delivery' }[S.delivery];
  return [
    { title: 'Coverage', items: cover },
    { title: 'Deliverables', items: [`${reels} edited reel${reels > 1 ? 's' : ''}`, ...extras] },
    { title: 'Delivery', items: [del, 'Shared digitally'] },
  ];
}
const groups = () => S.groups || autoGroups();

function monthlyHtml() {
  const b = P.business;
  const t = THEMES[S.theme] || THEMES.green;
  const vars = Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(';');
  const k = pkgOf();
  const lines = S.lines.filter((l) => (Number(l.qty) || 0) * (Number(l.rate) || 0) > 0);
  const sub = S.pkgPrice + lines.reduce((n, l) => n + l.qty * l.rate, 0);
  const disc = Math.min(Math.max(Number(S.discount) || 0, 0), sub);
  const feats = featList().map((f) => { const [a, c] = split(f); return `<div class="fi-feat"><div>${escHtml(a)}${c ? `<span class="fi-sub">${escHtml(c)}</span>` : ''}</div></div>`; }).join('');
  const stats = statList().map((x) => { const [n, l] = split(x); return `<div class="fi-card fi-stat"><b>${escHtml(n)}</b><span class="fi-mut">${escHtml(l)}</span></div>`; }).join('');
  return `<div class="fi" style="${vars}">
    <div class="fi-head"><div><div class="fi-brand">${escHtml(b.name)}</div><div class="fi-tag">${escHtml(b.monthlyTag || '')}</div></div>
      <div class="fi-no"><small>Monthly invoice</small><b>${invNo()}</b><div class="fi-tag">Issued ${fmtDate(S.date)}</div></div></div>
    <div class="fi-strip"></div>
    <div class="fi-pad fi-two">
      <div class="fi-card"><p class="fi-lbl">Billed to</p><div class="fi-big">${escHtml(S.client || '—')}</div><div class="fi-mut">${escHtml([S.handle, S.phone].filter(Boolean).join(' · '))}</div></div>
      <div class="fi-card"><p class="fi-lbl">Package period</p><div class="fi-big">${fmtDate(S.pStart)} to ${fmtDate(S.pEnd)}</div><div class="fi-mut">Renews monthly</div></div>
    </div>
    <div class="fi-pad"><div class="fi-plan">
      ${k.popular ? '<div class="fi-pop"><span>MOST POPULAR</span></div>' : ''}
      <div class="fi-ptop"><div class="fi-pname">${escHtml(k.name)}</div>
        <div class="fi-reels"><b>${k.reels}</b><span>REELS<br>/ MONTH</span></div>
        <div class="fi-pprice">${currency(S.pkgPrice)} <small>/ month</small></div></div>
      <div class="fi-feats">${feats}</div></div></div>
    ${stats ? `<div class="fi-pad"><p class="fi-sec">Your month with us</p><div class="fi-stats">${stats}</div></div>` : ''}
    <div class="fi-pad fi-two" style="align-items:end">
      <div class="fi-card fi-pay"><p class="fi-lbl">How to pay</p>${b.upi ? `<div class="fi-big">UPI: ${escHtml(b.upi)}</div>` : ''}${b.phone ? `<div>Phone: ${escHtml(b.phone)}</div>` : ''}<div style="margin-top:4px">${escHtml(b.monthlyPayNote || '')}</div></div>
      <div><div class="fi-tr"><span>${escHtml(k.name)} package</span><span>${currency(S.pkgPrice)}</span></div>
        ${lines.map((l) => `<div class="fi-tr"><span>${escHtml(l.label)} (${l.qty} × ${currency(l.rate)})</span><span>${currency(l.qty * l.rate)}</span></div>`).join('')}
        ${disc ? `<div class="fi-tr fi-mut"><span>Discount</span><span>− ${currency(disc)}</span></div>` : ''}
        <div class="fi-grand"><div class="fi-tr"><span>Total</span><span>${currency(sub - disc)}</span></div></div></div>
    </div>
    <div class="fi-pad"><div class="fi-card fi-cream"><p class="fi-lbl">Terms</p>${escHtml(S.mTerms).replace(/\n/g, '<br>')}</div></div>
    <div class="fi-foot fi-tag2">${escHtml(b.monthlyFooter || '')}</div></div>`;
}
function invoiceHtml() { return isMo() ? monthlyHtml() : functionHtml(); }

function functionHtml() {
  const r = calcInvoice({ pricing: P, size: S.size, delivery: S.delivery, lines: S.lines, discount: S.discount, advance: S.advance });
  const b = P.business;
  const t = THEMES[S.theme] || THEMES.gold;
  const vars = Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(';');
  const row = (a, q, rate, amt) => `<tr><td>${a}</td><td>${q}</td><td>${rate}</td><td>${currency(amt)}</td></tr>`;
  const details = [S.size && `${SIZE_LABELS[S.size]} function`, fmtDate(S.eventDate), S.location].filter(Boolean).join(' · ');
  return `<div class="fi" style="${vars}">
    <div class="fi-head"><div><div class="fi-brand">${escHtml(b.name)}</div><div class="fi-tag">Function shooting, reels and editing</div></div>
      <div class="fi-no"><small>Invoice</small><b>${invNo()}</b><div class="fi-tag">Issued ${fmtDate(S.date)}</div></div></div>
    <div class="fi-strip"></div>
    <div class="fi-pad fi-two">
      <div class="fi-card"><p class="fi-lbl">Billed to</p><div class="fi-big">${escHtml(S.client || '—')}</div><div class="fi-mut">${escHtml(S.phone)}</div></div>
      <div class="fi-card"><p class="fi-lbl">Event details</p><div class="fi-big">${escHtml(S.event || '—')}</div><div class="fi-mut">${escHtml(details)}</div></div>
    </div>
    <div class="fi-pad"><p class="fi-sec">What you get for this price</p>
      <div class="fi-inc">${groups().map((g) => `<div class="fi-box"><h4>${escHtml(g.title)}</h4>${g.items.map((i) => `<p>${escHtml(i)}</p>`).join('')}</div>`).join('')}</div></div>
    <div class="fi-pad"><p class="fi-sec">Price breakdown</p>
      <table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>
        ${row(`Base package<span class="fi-sub">${P.baseCrew}-person crew, ${P.baseHours} hours, ${P.baseReels} reel, ${escHtml(P.baseDeliveryText)}</span>`, 1, currency(r.base), r.base)}
        ${r.sizeAmt ? row(`${SIZE_LABELS[S.size]} function`, 1, currency(r.sizeAmt), r.sizeAmt) : ''}
        ${r.lineRows.map((l) => row(escHtml(l.label), l.qty, currency(l.rate) + (l.unit ? `/${l.unit}` : ''), l.amount)).join('')}
        ${r.surcharge ? row(`${DELIVERY_LABELS[S.delivery].split(' (')[0]} delivery<span class="fi-sub">${r.pct}% on ${currency(r.subtotal)}</span>`, '', `${r.pct}%`, r.surcharge) : ''}
      </tbody></table>
      <div class="fi-tot"><div>
        ${r.discount ? `<div class="fi-tr fi-mut"><span>Discount</span><span>− ${currency(r.discount)}</span></div>` : ''}
        ${r.advance ? `<div class="fi-tr fi-mut"><span>Advance paid</span><span>− ${currency(r.advance)}</span></div>` : ''}
        <div class="fi-grand"><div class="fi-tr"><span>Total</span><span>${currency(r.grand)}</span></div><div class="fi-tr"><span>${r.advance ? 'Balance due' : 'Amount due'}</span><span>${currency(r.balance)}</span></div></div>
      </div></div></div>
    <div class="fi-pad fi-two">
      <div class="fi-card fi-pay"><p class="fi-lbl">How to pay</p>${b.upi ? `<div class="fi-big">UPI: ${escHtml(b.upi)}</div>` : ''}${b.phone ? `<div>Phone: ${escHtml(b.phone)}</div>` : ''}<div>${escHtml(b.payNote || '')}</div></div>
      <div class="fi-card"><p class="fi-lbl">Terms</p>${escHtml(S.terms).replace(/\n/g, '<br>')}</div>
    </div>
    <div class="fi-foot">${escHtml(b.footer || '')}</div></div>`;
}

// Totals for the invoice being edited (works for both invoice types).
function invoiceTotals() {
  if (isMo()) {
    const sub = (Number(S.pkgPrice) || 0) + S.lines.reduce((n, l) => n + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
    const disc = Math.min(Math.max(Number(S.discount) || 0, 0), sub);
    return { grand: sub - disc, advance: 0 };
  }
  const r = calcInvoice({ pricing: P, size: S.size, delivery: S.delivery, lines: S.lines, discount: S.discount, advance: S.advance });
  return { grand: r.grand, advance: r.advance };
}

// Every saved invoice is also a project on the Dashboard / Project Library.
// First save creates the project and remembers its id on the invoice
// (projectId) and the invoice id on the project (invoiceId). Saving the same
// invoice again updates that project's invoice-driven fields only — stage,
// priority, links, notes etc. that you've set on the project are left alone.
function syncProjectFromInvoice() {
  const { grand, advance } = invoiceTotals();
  const status = grand > 0 && advance >= grand ? 'Paid' : advance > 0 ? 'Partial' : 'Pending';
  const name = isMo()
    ? `Monthly package — ${pkgOf().name} (${fmtDate(S.pStart)} – ${fmtDate(S.pEnd)})`
    : (S.event || '').trim() || `Function — ${S.client || 'Untitled'}`;
  const clientRecord = findOrCreateClient(S.client, 'Other');
  const fields = {
    client: (S.client || '').trim(), clientId: clientRecord?.id, project: name,
    amount: grand, status, date: S.date, invoiceId: S.id, invoiceNo: S.no,
  };
  if (!isMo() && S.eventDate) fields.shootDate = S.eventDate;

  const list = getIncome();
  let proj = list.find((x) => x.id === S.projectId) || list.find((x) => x.invoiceId === S.id);
  const created = !proj;
  if (created) {
    const today = new Date().toISOString().slice(0, 10);
    proj = {
      id: uid(), contentType: '', services: {}, stage: 'Received', priority: 'Normal',
      dueDate: '', completedDate: '', revisions: 0, revisionLimit: 3, referral: false,
      notes: '', clientNote: '', links: [], stageHistory: { Received: S.date || today },
      shootDate: '',
    };
    list.push(proj);
  }
  Object.assign(proj, fields);
  saveIncome(list);
  S.projectId = proj.id;
  return created;
}
function renderPreview() {
  if (!isMo() && !S.groups) renderGroups();
  $('invPreview').innerHTML = invoiceHtml();
}

function fillSelects() {
  $('invSize').innerHTML = Object.keys(SIZE_LABELS).map((k) => `<option value="${k}">${SIZE_LABELS[k]}${P.sizes[k] ? ` (+${currency(P.sizes[k])})` : ''}</option>`).join('');
  $('invDelivery').innerHTML = Object.keys(DELIVERY_LABELS).map((k) => `<option value="${k}">${DELIVERY_LABELS[k]}${P.delivery[k] ? ` (+${P.delivery[k]}%)` : ''}</option>`).join('');
  $('invPkg').innerHTML = P.packages.map((x) => `<option value="${x.id}">${escHtml(x.name)} — ${x.reels} reels, ${currency(x.price)}</option>`).join('');
  $('invPkg').value = pkgOf().id;
  $('invAddSel').innerHTML = addOnCatalog(P).filter((a) => !isMo() || ['reel', 'custom'].includes(a.key)).map((a) => `<option value="${a.key}">${a.label}${a.quote ? '' : ` — ${currency(a.rate)}${a.unit ? '/' + a.unit : ''}`}</option>`).join('');
  $('invSize').value = S.size; $('invDelivery').value = S.delivery; $('invTheme').value = S.theme;
}

function renderLines() {
  $('invLines').innerHTML = S.lines.length ? S.lines.map((l, i) => `
    <div class="inv-line" data-i="${i}">
      <input type="text" data-f="label" value="${escHtml(l.label)}" aria-label="Item">
      <input type="number" data-f="qty" min="0" value="${l.qty}" title="Quantity${l.unit ? ' (' + l.unit + ')' : ''}" aria-label="Quantity">
      <input type="number" data-f="rate" min="0" value="${l.rate}" title="Rate ₹" aria-label="Rate">
      <button class="btn btn-icon btn-sm" data-del="${i}" title="Remove">🗑️</button>
    </div>`).join('') : '<p class="muted" style="font-size:13px">No add-ons. Base package only.</p>';
  $('invLines').querySelectorAll('input').forEach((el) => el.addEventListener('input', () => {
    const l = S.lines[el.closest('.inv-line').dataset.i];
    l[el.dataset.f] = el.dataset.f === 'label' ? el.value : Number(el.value) || 0;
    renderPreview();
  }));
  $('invLines').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { S.lines.splice(Number(b.dataset.del), 1); renderLines(); renderPreview(); }));
}

function renderGroups() {
  $('invGroups').innerHTML = groups().map((g, i) => `
    <div class="inv-grp" data-g="${i}"><div class="inv-grp-h"><input type="text" data-gf="title" value="${escHtml(g.title)}" aria-label="Section title"><button class="btn btn-icon btn-sm" data-gdel="${i}" title="Remove section">🗑️</button></div>
      <textarea data-gf="items" rows="${Math.max(3, g.items.length + 1)}" aria-label="Included items, one per line">${escHtml(g.items.join('\n'))}</textarea></div>`).join('');
  $('invGroups').querySelectorAll('[data-gf]').forEach((el) => el.addEventListener('input', () => {
    if (!S.groups) S.groups = autoGroups();
    const g = S.groups[el.closest('.inv-grp').dataset.g];
    if (el.dataset.gf === 'title') g.title = el.value;
    else g.items = el.value.split('\n').map((x) => x.trim()).filter(Boolean);
    $('invPreview').innerHTML = invoiceHtml();
  }));
  $('invGroups').querySelectorAll('[data-gdel]').forEach((b) => b.addEventListener('click', () => {
    S.groups = groups().filter((_, i) => i !== Number(b.dataset.gdel)); renderGroups(); renderPreview();
  }));
}

function loadToForm() {
  [['invClient', 'client'], ['invPhone', 'phone'], ['invEvent', 'event'], ['invLoc', 'location'], ['invEventDate', 'eventDate'], ['invDate', 'date'], ['invDiscount', 'discount'], ['invAdvance', 'advance'], ['invTerms', 'terms']]
    .forEach(([id, k]) => { $(id).value = S[k] || ''; });
  [['invHandle', 'handle'], ['invPkgPrice', 'pkgPrice'], ['invPStart', 'pStart'], ['invPEnd', 'pEnd']].forEach(([id, k]) => { $(id).value = S[k] || ''; });
  $('invTerms').value = isMo() ? S.mTerms : S.terms;
  $('invForm').dataset.type = S.type; $('invType').value = S.type;
  fillSelects();
  $('invFeatures').value = featList().join('\n'); $('invStats').value = statList().join('\n');
  renderLines(); if (!isMo()) renderGroups(); renderPreview();
}

function renderSaved() {
  const list = getInvoices();
  $('invSaved').innerHTML = list.length ? list.slice().reverse().map((x) => `
    <div class="inv-saved-row" data-id="${x.id}"><span>${x.type === 'monthly' ? '📅' : '🎬'} ${escHtml(x.no)} · ${escHtml(x.client || '—')}${x.projectId ? ' · 🔗 Project' : ''}</span>
      <button class="btn btn-ghost btn-sm" data-open>Open</button><button class="btn btn-icon btn-sm" data-rm>🗑️</button></div>`).join('') : '<p class="muted" style="font-size:13px">Nothing saved yet.</p>';
  $('invSaved').querySelectorAll('.inv-saved-row').forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('[data-open]').addEventListener('click', () => { S = { ...fresh(), ...JSON.parse(JSON.stringify(getInvoices().find((x) => x.id === id))) }; loadToForm(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    el.querySelector('[data-rm]').addEventListener('click', () => { saveInvoices(getInvoices().filter((x) => x.id !== id)); renderSaved(); });
  });
}

const PRICE_FIELDS = [
  ['Base package ₹', 'base'], ['Hours included', 'baseHours'], ['Reels included', 'baseReels'], ['Crew size', 'baseCrew'],
  ['Medium function +₹', 'sizes.medium'], ['Large function +₹', 'sizes.large'], ['Extra reel ₹', 'extraReel'], ['Extra shooting hour ₹', 'extraHour'],
  ['Extra location ₹', 'extraLocation'], ['Travel ₹ per km', 'perKm'], ['24-hour delivery +%', 'delivery.fast'], ['Same-day delivery +%', 'delivery.sameDay'],
  ['Business name', 'business.name', 1], ['Phone', 'business.phone', 1], ['UPI ID', 'business.upi', 1], ['Payment note', 'business.payNote', 1], ['Invoice footer', 'business.footer', 1], ['Monthly tagline', 'business.monthlyTag', 1], ['Monthly payment note', 'business.monthlyPayNote', 1], ['Monthly footer', 'business.monthlyFooter', 1],
];
const pathGet = (o, p) => p.split('.').reduce((a, k) => a[k], o);
function pathSet(o, p, v) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; }

function openPrices() {
  const body = document.createElement('div');
  body.innerHTML = `<div class="form-grid">${PRICE_FIELDS.map(([l, p, t]) => `<div class="form-field"><label>${l}</label><input ${t ? 'type="text"' : 'type="number" min="0"'} data-p="${p}" value="${escHtml(String(pathGet(P, p)))}"></div>`).join('')}
    <div class="form-actions"><button class="btn btn-ghost" id="pcCancel">Cancel</button><button class="btn btn-primary" id="pcSave">Save prices</button></div></div>`;
  openModal('Edit prices', body);
  body.querySelector('#pcCancel').addEventListener('click', closeModal);
  body.querySelector('#pcSave').addEventListener('click', () => {
    body.querySelectorAll('[data-p]').forEach((el) => pathSet(P, el.dataset.p, el.type === 'number' ? Math.max(0, Number(el.value) || 0) : el.value));
    P.crew = P.baseCrew;
    savePricing(P); closeModal(); showToast('Prices saved'); fillSelects(); renderPreview();
  });
}

function openPackages() {
  const W = P.packages.map((x) => ({ ...x, features: [...x.features] }));
  const body = document.createElement('div');
  const draw = () => {
    body.innerHTML = W.map((k, i) => `<div data-k="${i}" style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px">
      <div class="form-grid">
        <div class="form-field"><label>Name</label><input data-f="name" value="${escHtml(k.name)}"></div>
        <div class="form-field"><label>Price ₹ / month</label><input type="number" min="0" data-f="price" value="${k.price}"></div>
        <div class="form-field"><label>Reels / month</label><input type="number" min="0" data-f="reels" value="${k.reels}"></div>
        <div class="form-field"><label>Shooting sessions</label><input type="number" min="0" data-f="sessions" value="${k.sessions}"></div></div>
      <label style="font-size:13px;display:flex;gap:6px;align-items:center;margin:8px 0"><input type="checkbox" data-f="popular" ${k.popular ? 'checked' : ''} style="width:auto"> Show "Most popular"</label>
      <div class="form-field"><label>Included (one per line, "text | small note")</label><textarea data-f="features" rows="5">${escHtml(k.features.join('\n'))}</textarea></div>
      <button class="btn btn-ghost btn-sm" data-rm="${i}" style="margin-top:6px">🗑️ Remove package</button></div>`).join('') +
      '<div class="form-actions"><button class="btn btn-ghost" id="pkAdd">+ Add package</button><button class="btn btn-ghost" id="pkCancel">Cancel</button><button class="btn btn-primary" id="pkSave">Save packages</button></div>';
    body.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('input', () => {
      const k = W[el.closest('[data-k]').dataset.k]; const f = el.dataset.f;
      k[f] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(0, Number(el.value) || 0) : f === 'features' ? el.value.split('\n').map((x) => x.trim()).filter(Boolean) : el.value;
    }));
    body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { if (W.length > 1) { W.splice(Number(b.dataset.rm), 1); draw(); } }));
    body.querySelector('#pkAdd').addEventListener('click', () => { W.push({ id: 'p' + Date.now(), name: 'New package', reels: 4, sessions: 2, price: 0, popular: false, features: [] }); draw(); });
    body.querySelector('#pkCancel').addEventListener('click', closeModal);
    body.querySelector('#pkSave').addEventListener('click', () => {
      P.packages = W; savePricing(P);
      if (!P.packages.find((x) => x.id === S.pkgId)) S.pkgId = P.packages[0].id;
      S.pkgPrice = pkgOf().price; S.features = null; S.stats = null;
      closeModal(); showToast('Packages saved'); loadToForm();
    });
  };
  draw(); openModal('Edit packages', body);
}

async function printInvoice() {
  let css = '';
  try { css = await (await fetch('css/invoice.css')).text(); } catch (e) { /* print without styles is better than nothing */ }
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0';
  f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${invNo()}</title>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&display=swap" rel="stylesheet"><style>${css}</style></head><body class="pd">${invoiceHtml()}</body></html>`;
  f.onload = () => setTimeout(() => {
    f.contentWindow.focus(); f.contentWindow.print();
    setTimeout(() => f.remove(), 60000);
  }, 600);
  document.body.appendChild(f);
}

export function init() {
  P = getPricing(); S = fresh();
  loadToForm(); renderSaved();
  const bind = (id, k, num) => $(id).addEventListener('input', () => { S[k] = num ? Number($(id).value) || 0 : $(id).value; renderPreview(); });
  ['invClient:client', 'invPhone:phone', 'invEvent:event', 'invLoc:location', 'invEventDate:eventDate', 'invDate:date', 'invSize:size', 'invDelivery:delivery', 'invTheme:theme', 'invHandle:handle']
    .forEach((x) => bind(...x.split(':')));
  $('invTerms').addEventListener('input', () => { S[isMo() ? 'mTerms' : 'terms'] = $('invTerms').value; renderPreview(); });
  $('invType').addEventListener('change', () => {
    S.type = $('invType').value;
    if (isMo() && S.theme === 'gold') S.theme = 'green'; else if (!isMo() && S.theme === 'green') S.theme = 'gold';
    loadToForm();
  });
  $('invPkg').addEventListener('change', () => { S.pkgId = $('invPkg').value; S.pkgPrice = pkgOf().price; S.features = null; S.stats = null; loadToForm(); });
  bind('invPkgPrice', 'pkgPrice', 1);
  const listBind = (id, k) => $(id).addEventListener('input', () => { S[k] = $(id).value.split('\n').map((x) => x.trim()).filter(Boolean); renderPreview(); });
  listBind('invFeatures', 'features'); listBind('invStats', 'stats');
  $('invMoReset').addEventListener('click', () => { S.features = null; S.stats = null; loadToForm(); });
  $('invPStart').addEventListener('change', () => { S.pStart = $('invPStart').value; if (S.pStart) { S.pEnd = monthEnd(S.pStart); $('invPEnd').value = S.pEnd; } renderPreview(); });
  $('invPEnd').addEventListener('change', () => { S.pEnd = $('invPEnd').value; renderPreview(); });
  $('invPkgEdit').addEventListener('click', openPackages);
  bind('invDiscount', 'discount', 1); bind('invAdvance', 'advance', 1);
  $('invAddBtn').addEventListener('click', () => {
    const a = addOnCatalog(P).find((x) => x.key === $('invAddSel').value);
    S.lines.push({ key: a.key, label: a.label, unit: a.unit, qty: 1, rate: a.rate }); renderLines(); renderPreview();
  });
  $('invGAdd').addEventListener('click', () => { S.groups = [...groups(), { title: 'New section', items: [] }]; renderGroups(); renderPreview(); });
  $('invGReset').addEventListener('click', () => { S.groups = null; renderPreview(); });
  $('invTermsDefault').addEventListener('click', () => { if (isMo()) P.business.monthlyTerms = S.mTerms; else P.business.terms = S.terms; savePricing(P); showToast('Saved as your default terms'); });
  $('invPricesBtn').addEventListener('click', openPrices);
  $('invNewBtn').addEventListener('click', () => { S = fresh(S.type); loadToForm(); });
  $('invSaveBtn').addEventListener('click', () => {
    S.no = invNo();
    const created = syncProjectFromInvoice();
    const list = getInvoices().filter((x) => x.id !== S.id); list.push(JSON.parse(JSON.stringify(S)));
    saveInvoices(list); renderSaved();
    showToast(created ? 'Invoice saved and project created' : 'Invoice saved and project updated');
  });
  $('invPrintBtn').addEventListener('click', printInvoice);
}
