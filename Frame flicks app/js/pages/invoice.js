// pages/invoice.js — invoice maker. Prices come from the editable pricing
// settings (pricing.js defaults = the 2026 pricing PDF). Everything on the
// invoice, including each add-on's rate, can be changed.

import { getPricing, savePricing, getInvoices, saveInvoices, uid } from '../storage.js';
import { calcInvoice, addOnCatalog, SIZE_LABELS, DELIVERY_LABELS } from '../pricing.js';
import { escHtml, currency } from '../format.js';
import { openModal, closeModal } from '../modal.js';
import { showToast } from '../toast.js';

let P; // pricing
let S; // current invoice state
const $ = (id) => document.getElementById(id);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fresh() {
  return { id: uid(), no: '', client: '', phone: '', event: '', date: todayStr(), size: 'small', delivery: 'normal', lines: [], discount: 0, advance: 0 };
}
const invNo = () => S.no || `INV-${S.date.replace(/-/g, '')}-${String(getInvoices().length + 1).padStart(2, '0')}`;

function fillSelects() {
  $('invSize').innerHTML = Object.keys(SIZE_LABELS).map((k) => `<option value="${k}">${SIZE_LABELS[k]}${P.sizes[k] ? ` (+${currency(P.sizes[k])})` : ''}</option>`).join('');
  $('invDelivery').innerHTML = Object.keys(DELIVERY_LABELS).map((k) => `<option value="${k}">${DELIVERY_LABELS[k]}${P.delivery[k] ? ` (+${P.delivery[k]}%)` : ''}</option>`).join('');
  $('invAddSel').innerHTML = addOnCatalog(P).map((a) => `<option value="${a.key}">${a.label}${a.quote ? '' : ` — ${currency(a.rate)}${a.unit ? '/' + a.unit : ''}`}</option>`).join('');
  $('invSize').value = S.size; $('invDelivery').value = S.delivery;
}

function renderLines() {
  $('invLines').innerHTML = S.lines.length ? S.lines.map((l, i) => `
    <div class="inv-line" data-i="${i}">
      <input type="text" data-f="label" value="${escHtml(l.label)}" aria-label="Item">
      <input type="number" data-f="qty" min="0" value="${l.qty}" aria-label="Qty${l.unit ? ' (' + l.unit + ')' : ''}" title="Quantity${l.unit ? ' (' + l.unit + ')' : ''}">
      <input type="number" data-f="rate" min="0" value="${l.rate}" aria-label="Rate ₹" title="Rate ₹">
      <button class="btn btn-icon btn-sm" data-del="${i}" title="Remove">🗑️</button>
    </div>`).join('') : '<p class="muted" style="font-size:13px">No add-ons. Base package only.</p>';
  $('invLines').querySelectorAll('input').forEach((el) => el.addEventListener('input', () => {
    const l = S.lines[el.closest('.inv-line').dataset.i];
    l[el.dataset.f] = el.dataset.f === 'label' ? el.value : Number(el.value) || 0;
    renderPreview();
  }));
  $('invLines').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { S.lines.splice(Number(b.dataset.del), 1); renderLines(); renderPreview(); }));
}

function renderPreview() {
  const r = calcInvoice({ pricing: P, size: S.size, delivery: S.delivery, lines: S.lines, discount: S.discount, advance: S.advance });
  const b = P.business;
  const row = (a, q, amt) => `<tr><td>${a}</td><td>${q}</td><td>${currency(amt)}</td></tr>`;
  $('invPreview').innerHTML = `
    <div class="row"><div><h1>${escHtml(b.name)}</h1><div class="meta">${escHtml(b.phone || '')}</div></div>
      <div style="text-align:right"><b>INVOICE</b><div class="meta">${invNo()}<br>${new Date(S.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</div></div></div>
    <div class="meta" style="margin-top:12px">BILL TO</div>
    <div><b>${escHtml(S.client || '—')}</b> ${escHtml(S.phone)}</div>
    <div class="meta">${escHtml(S.event)}</div>
    <table><thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>
      ${row(`Base package<div class="meta">${P.baseCrew}-person crew · up to ${P.baseHours} hrs · ${P.baseReels} reel · ${P.baseDeliveryText}</div>`, 1, r.base)}
      ${r.sizeAmt ? row(`${SIZE_LABELS[S.size]} function`, 1, r.sizeAmt) : ''}
      ${r.lineRows.map((l) => row(escHtml(l.label) + (l.rate ? `<div class="meta">${currency(l.rate)}${l.unit ? '/' + l.unit : ''}</div>` : ''), l.qty, l.amount)).join('')}
      ${r.surcharge ? row(`${DELIVERY_LABELS[S.delivery]} surcharge (${r.pct}%)`, '', r.surcharge) : ''}
    </tbody></table>
    ${r.discount ? `<div class="row"><span>Discount</span><span>− ${currency(r.discount)}</span></div>` : ''}
    <div class="row total"><span>Total</span><span>${currency(r.grand)}</span></div>
    ${r.advance ? `<div class="row"><span>Advance paid</span><span>− ${currency(r.advance)}</span></div><div class="row"><b>Balance due</b><b>${currency(r.balance)}</b></div>` : ''}
    ${b.upi ? `<div class="meta" style="margin-top:12px">Pay via UPI: ${escHtml(b.upi)}</div>` : ''}
    <div class="meta" style="margin-top:10px">${escHtml(b.footer || '')}</div>`;
}

function loadToForm() {
  [['invClient', 'client'], ['invPhone', 'phone'], ['invEvent', 'event'], ['invDate', 'date'], ['invDiscount', 'discount'], ['invAdvance', 'advance']]
    .forEach(([id, k]) => { $(id).value = S[k] || ''; });
  fillSelects(); renderLines(); renderPreview();
}

function renderSaved() {
  const list = getInvoices();
  $('invSaved').innerHTML = list.length ? list.slice().reverse().map((x) => `
    <div class="inv-saved-row" data-id="${x.id}"><span>${escHtml(x.no)} · ${escHtml(x.client || '—')}</span>
      <button class="btn btn-ghost btn-sm" data-open>Open</button><button class="btn btn-icon btn-sm" data-rm>🗑️</button></div>`).join('') : '<p class="muted" style="font-size:13px">Nothing saved yet.</p>';
  $('invSaved').querySelectorAll('.inv-saved-row').forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('[data-open]').addEventListener('click', () => { S = JSON.parse(JSON.stringify(getInvoices().find((x) => x.id === id))); loadToForm(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    el.querySelector('[data-rm]').addEventListener('click', () => { saveInvoices(getInvoices().filter((x) => x.id !== id)); renderSaved(); });
  });
}

const PRICE_FIELDS = [
  ['Base package ₹', 'base'], ['Hours included', 'baseHours'], ['Reels included', 'baseReels'], ['Crew size', 'baseCrew'],
  ['Medium function +₹', 'sizes.medium'], ['Large function +₹', 'sizes.large'], ['Extra reel ₹', 'extraReel'], ['Extra shooting hour ₹', 'extraHour'],
  ['Extra location ₹', 'extraLocation'], ['Travel ₹ per km', 'perKm'], ['24-hour delivery +%', 'delivery.fast'], ['Same-day delivery +%', 'delivery.sameDay'],
  ['Business name', 'business.name', 1], ['Phone', 'business.phone', 1], ['UPI ID', 'business.upi', 1], ['Invoice footer', 'business.footer', 1],
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

export function init() {
  P = getPricing(); S = fresh();
  loadToForm(); renderSaved();
  const bind = (id, k, num) => $(id).addEventListener('input', () => { S[k] = num ? Number($(id).value) || 0 : $(id).value; renderPreview(); });
  bind('invClient', 'client'); bind('invPhone', 'phone'); bind('invEvent', 'event'); bind('invDate', 'date');
  bind('invSize', 'size'); bind('invDelivery', 'delivery'); bind('invDiscount', 'discount', 1); bind('invAdvance', 'advance', 1);
  $('invAddBtn').addEventListener('click', () => {
    const a = addOnCatalog(P).find((x) => x.key === $('invAddSel').value);
    S.lines.push({ label: a.label, unit: a.unit, qty: 1, rate: a.rate }); renderLines(); renderPreview();
  });
  $('invPricesBtn').addEventListener('click', openPrices);
  $('invNewBtn').addEventListener('click', () => { S = fresh(); loadToForm(); });
  $('invSaveBtn').addEventListener('click', () => {
    S.no = invNo();
    const list = getInvoices().filter((x) => x.id !== S.id); list.push(JSON.parse(JSON.stringify(S)));
    saveInvoices(list); renderSaved(); showToast('Invoice saved');
  });
  $('invPrintBtn').addEventListener('click', () => window.print());
}
