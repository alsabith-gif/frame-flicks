// pages/invoice.js — invoice maker. Prices come from the editable pricing
// settings; "What's included" fills itself from the price but every line is
// editable. Printing happens in a clean iframe so the colours and layout
// come out exactly as shown (A4, full colour).

import { applyInvoiceAdvance } from '../money.js';
import { getPricing, savePricing, getInvoices, saveInvoices, getIncome, saveIncome, uid } from '../storage.js';
import { findOrCreateClient } from '../clients.js';
import { calcInvoice, addOnCatalog, SIZE_LABELS, DELIVERY_LABELS, packageFeatures, packageStats } from '../pricing.js';
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
const addDays = (st, n) => { const d = new Date(st + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const weekEnd = (st) => addDays(st, 6);
const monthEnd = (st) => { const d = new Date(st + 'T00:00:00'); const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${e.getFullYear()}-${pad(e.getMonth() + 1)}-${pad(e.getDate())}`; };
function fresh(type = 'function') {
  const wk = type === 'weekly';
  const k = pkgListFor(type)[0] || {};
  const ps = type === 'monthly' ? monthStart() : todayStr();
  return { type, pkgId: k.id, pkgPrice: k.price || 0, handle: '', pStart: ps, pEnd: wk ? weekEnd(ps) : type === 'monthly' ? monthEnd(ps) : ps, features: null, stats: null, mTerms: ({ weekly: P.business.weeklyTerms, onetime: P.business.onetimeTerms, monthly: P.business.monthlyTerms }[type]) || '', id: uid(), no: '', client: '', phone: '', event: '', location: '', eventDate: '', date: todayStr(), size: 'small', delivery: 'normal', lines: [], discount: 0, advance: 0, theme: type === 'function' ? 'gold' : 'green', groups: null, terms: P.business.terms || '' };
}
// isMo = any package invoice (monthly or weekly); isWk = the weekly kind.
const isMo = () => S.type === 'monthly' || S.type === 'weekly' || S.type === 'onetime';
const isWk = () => S.type === 'weekly';
const isOne = () => S.type === 'onetime';
const KIND = { monthly: 'monthly', weekly: 'weekly', onetime: 'onetime' };
// Packages for a kind from the Packages page. Archived ones are hidden from the chooser,
// but an invoice that already uses one still finds it.
const pkgListFor = (type) => P.packageLib.filter((x) => x.kind === KIND[type] && x.active);
const pkgList = () => pkgListFor(S.type);
const PER = () => (isWk() ? 'week' : isOne() ? '' : 'month');
const TAGS = () => ({ tag: isWk() ? P.business.weeklyTag : isOne() ? P.business.onetimeTag : P.business.monthlyTag, pay: isWk() ? P.business.weeklyPayNote : isOne() ? P.business.onetimePayNote : P.business.monthlyPayNote, foot: isWk() ? P.business.weeklyFooter : isOne() ? P.business.onetimeFooter : P.business.monthlyFooter });
const KIND_NAME = () => (isWk() ? 'Weekly' : isOne() ? 'One-time' : 'Monthly');
// Invoice numbers run INV00001, INV00002, ... The next number is one more than
// the highest INV##### already used by a saved invoice (or by a project that
// came from a since-deleted invoice, so numbers are never handed out twice).
const NO_RE = /^INV(\d+)$/;
function nextInvNo() {
  const used = [...getInvoices().map((x) => x.no), ...getIncome().map((x) => x.invoiceNo)];
  const max = used.reduce((m, n) => { const r = NO_RE.exec(n || ''); return r ? Math.max(m, Number(r[1])) : m; }, 0);
  return `INV${String(max + 1).padStart(5, '0')}`;
}
const noTaken = (no) => getInvoices().some((x) => x.no === no && x.id !== S.id);
const invNo = () => S.no || nextInvNo();
const pkgOf = () => P.packageLib.find((x) => x.id === S.pkgId && x.kind === KIND[S.type]) || pkgList()[0] || P.packageLib.find((x) => x.kind === KIND[S.type]) || { id: '', name: '(no package yet)', kind: KIND[S.type], price: 0, items: [], revisions: 0, deliveryDays: 0, addOns: [], features: [], reels: 0, sessions: 0 };
const extraReelsQty = () => S.lines.filter((l) => l.key === 'reel').reduce((n, l) => n + (Number(l.qty) || 0), 0);
const featList = () => S.features || packageFeatures(pkgOf());
const statList = () => S.stats || packageStats(pkgOf(), extraReelsQty());
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
    <div class="fi-head"><div><div class="fi-brand">${escHtml(b.name)}</div><div class="fi-tag">${escHtml(TAGS().tag || '')}</div></div>
      <div class="fi-no"><small>${KIND_NAME()} invoice</small><b>${invNo()}</b><div class="fi-tag">Issued ${fmtDate(S.date)}</div></div></div>
    <div class="fi-strip"></div>
    <div class="fi-pad fi-two">
      <div class="fi-card"><p class="fi-lbl">Billed to</p><div class="fi-big">${escHtml(S.client || '—')}</div><div class="fi-mut">${escHtml([S.handle, S.phone].filter(Boolean).join(' · '))}</div></div>
      ${isOne()
        ? `<div class="fi-card"><p class="fi-lbl">Package</p><div class="fi-big">${fmtDate(S.pStart)}</div><div class="fi-mut">${[k.deliveryDays ? `Delivery within ${k.deliveryDays} day${k.deliveryDays > 1 ? 's' : ''}` : '', k.revisions ? `${k.revisions} revision${k.revisions > 1 ? 's' : ''} included` : ''].filter(Boolean).join(' · ') || 'One-time package'}</div></div>`
        : `<div class="fi-card"><p class="fi-lbl">Package period</p><div class="fi-big">${fmtDate(S.pStart)} to ${fmtDate(S.pEnd)}</div><div class="fi-mut">Renews ${isWk() ? 'weekly' : 'monthly'}</div></div>`}
    </div>
    <div class="fi-pad"><div class="fi-plan">
      ${k.popular ? '<div class="fi-pop"><span>MOST POPULAR</span></div>' : ''}
      <div class="fi-ptop"><div class="fi-pname">${escHtml(k.name)}</div>
        ${k.reels ? `<div class="fi-reels"><b>${k.reels}</b><span>REELS${PER() ? `<br>/ ${PER().toUpperCase()}` : ''}</span></div>` : '<div></div>'}
        <div class="fi-pprice">${currency(S.pkgPrice)} ${PER() ? `<small>/ ${PER()}</small>` : ''}</div></div>
      <div class="fi-feats">${feats}</div></div></div>
    ${stats ? `<div class="fi-pad"><p class="fi-sec">Your ${PER()} with us</p><div class="fi-stats">${stats}</div></div>` : ''}
    <div class="fi-pad fi-two" style="align-items:end">
      <div class="fi-card fi-pay"><p class="fi-lbl">How to pay</p>${b.upi ? `<div class="fi-big">UPI: ${escHtml(b.upi)}</div>` : ''}${b.phone ? `<div>Phone: ${escHtml(b.phone)}</div>` : ''}<div style="margin-top:4px">${escHtml(TAGS().pay || '')}</div></div>
      <div><div class="fi-tr"><span>${escHtml(k.name)} package</span><span>${currency(S.pkgPrice)}</span></div>
        ${lines.map((l) => `<div class="fi-tr"><span>${escHtml(l.label)} (${l.qty} × ${currency(l.rate)})</span><span>${currency(l.qty * l.rate)}</span></div>`).join('')}
        ${disc ? `<div class="fi-tr fi-mut"><span>Discount</span><span>− ${currency(disc)}</span></div>` : ''}
        <div class="fi-grand"><div class="fi-tr"><span>Total</span><span>${currency(sub - disc)}</span></div></div></div>
    </div>
    <div class="fi-pad"><div class="fi-card fi-cream"><p class="fi-lbl">Terms</p>${escHtml(S.mTerms).replace(/\n/g, '<br>')}</div></div>
    <div class="fi-foot fi-tag2">${escHtml(TAGS().foot || '')}</div></div>`;
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

// When is the work due? Function: the function date + the delivery speed. One-time package: the
// package date + its delivery days. Monthly / weekly package: the end of the period.
function dueDateFromInvoice() {
  const addD = (d, k) => { if (!d) return ''; const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + k); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
  if (!isMo()) return addD(S.eventDate || S.date, { normal: 2, fast: 1, sameDay: 0 }[S.delivery] ?? 2);
  if (isOne()) { const k = Number(pkgOf().deliveryDays) || 0; return k ? addD(S.pStart || S.date, k) : ''; }
  return S.pEnd || '';
}

// Every saved invoice is also a project on the Dashboard / Projects page.
// First save creates the project and remembers its id on the invoice
// (projectId) and the invoice id on the project (invoiceId). Saving the same
// invoice again updates that project's invoice-driven fields only — stage,
// priority, links, notes etc. that you've set on the project are left alone.
function syncProjectFromInvoice() {
  const { grand, advance } = invoiceTotals();
  const status = grand > 0 && advance >= grand ? 'Paid' : advance > 0 ? 'Partial' : 'Pending';
  const name = isMo()
    ? (isOne() ? `One-time package — ${pkgOf().name} (${fmtDate(S.pStart)})` : `${KIND_NAME()} package — ${pkgOf().name} (${fmtDate(S.pStart)} – ${fmtDate(S.pEnd)})`)
    : (S.event || '').trim() || `Function — ${S.client || 'Untitled'}`;
  const clientRecord = findOrCreateClient(S.client, 'Other');
  const fields = {
    client: (S.client || '').trim(), clientId: clientRecord?.id, project: name,
    amount: grand, status, date: S.date, invoiceId: S.id, invoiceNo: S.no,
  };
  if (!isMo() && S.eventDate) fields.shootDate = S.eventDate;
  // Things the invoice already knows, passed on to the project so the calendar, reminders, Money and Analysis see them.
  if (S.referral !== undefined) fields.referral = !!S.referral;              // only when you chose it on the invoice
  if (isMo()) { const pk = pkgOf(); fields.packageId = pk.id; fields.packageName = pk.name; fields.invoiceType = S.type; }
  else fields.invoiceType = 'function';

  const list = getIncome();
  let proj = list.find((x) => x.id === S.projectId) || list.find((x) => x.invoiceId === S.id);
  const created = !proj;
  const autoDue = dueDateFromInvoice();     // used only while the project has no due date of its own
  const autoRevisions = isMo() ? Number(pkgOf().revisions) || 0 : 0;
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
  const seenByCrew = { project: proj.project, client: proj.client, shootDate: proj.shootDate };
  Object.assign(proj, fields);
  if (autoDue && !proj.dueDate) proj.dueDate = autoDue;                       // never overwrites a date you set
  if (created && autoRevisions) proj.revisionLimit = autoRevisions;           // the package's included revisions
  applyInvoiceAdvance(proj, advance, S.date);   // the invoice's advance becomes a payment; later payments are kept
  saveIncome(list);
  S.projectId = proj.id;
  // If this project has crew, their copy of the name / client / shoot date must follow.
  const changed = !created && proj.hasCrew
    && (seenByCrew.project !== proj.project || seenByCrew.client !== proj.client || seenByCrew.shootDate !== proj.shootDate);
  if (changed) {
    import('../crew.js')
      .then(({ refreshCrewFields }) => refreshCrewFields(proj))
      .catch((err) => showToast(`Crew not updated (${err.message}). Open the project and press Save to retry.`));
  }
  return created;
}
// "Clean" = what is on screen is exactly what was saved. Any edit makes it unclean,
// and the PDF button only works on a clean (saved) invoice, so a PDF is always a saved invoice.
let clean = false; let loading = false;
function updatePdfBtn() {
  const b = $('invPdfBtn'); if (!b) return;
  b.disabled = !clean;
  b.title = clean ? 'Download this saved invoice as a PDF' : 'Press Save first — then you can download the PDF';
  const hint = $('invPdfHint'); if (hint) hint.textContent = clean ? '' : 'Save the invoice first, then download the PDF.';
}
function renderPreview() {
  if (!isMo() && !S.groups) renderGroups();
  $('invPreview').innerHTML = invoiceHtml();
  if (!loading) { clean = false; updatePdfBtn(); }
}

const loadScript = (src) => new Promise((res, rej) => {
  if (document.querySelector(`script[data-lib="${src}"]`)) { res(); return; }
  const t = document.createElement('script'); t.src = src; t.dataset.lib = src; t.onload = () => res(); t.onerror = () => rej(new Error('Could not load ' + src));
  document.head.appendChild(t);
});

// Draws the invoice (the same A4 layout as printing) and saves it as a real PDF file.
async function downloadPdf() {
  if (!clean) { showToast('Press Save first, then download the PDF'); return; }
  const btn = $('invPdfBtn'); const label = btn.textContent; btn.disabled = true; btn.textContent = 'Making PDF…';
  const host = document.createElement('div');
  try {
    await Promise.all([loadScript('js/vendor/html2canvas.min.js'), loadScript('js/vendor/jspdf.umd.min.js')]);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    host.className = 'pd';
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;background:#fff';
    host.innerHTML = invoiceHtml();
    document.body.appendChild(host);
    const canvas = await window.html2canvas(host, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const W = 210; const H = 297;
    const imgH = (canvas.height * W) / canvas.width;
    if (imgH <= H + 0.5) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, W, imgH);
    } else {                                   // long invoice: cut into A4 pages
      const pageHpx = Math.floor((canvas.width * H) / W);
      for (let y = 0, page = 0; y < canvas.height; y += pageHpx, page++) {
        const c = document.createElement('canvas'); c.width = canvas.width; c.height = Math.min(pageHpx, canvas.height - y);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(canvas, 0, y, c.width, c.height, 0, 0, c.width, c.height);
        if (page) pdf.addPage();
        pdf.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, W, (c.height * W) / c.width);
      }
    }
    const safe = (x) => String(x || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
    pdf.save(`${safe(S.no) || 'invoice'}${S.client ? '-' + safe(S.client) : ''}.pdf`);
    showToast('PDF downloaded');
  } catch (err) {
    showToast('Could not make the PDF: ' + err.message);
  } finally {
    host.remove(); btn.textContent = label; updatePdfBtn();
  }
}

// Add-ons you can pick: the usual ones, plus the add-ons set on the chosen package.
const catalog = () => [...addOnCatalog(P), ...(isMo() ? pkgOf().addOns.map((a, i) => ({ key: 'pk' + i, label: a.label, unit: '', rate: a.price })) : [])];

function fillSelects() {
  $('invSize').innerHTML = Object.keys(SIZE_LABELS).map((k) => `<option value="${k}">${SIZE_LABELS[k]}${P.sizes[k] ? ` (+${currency(P.sizes[k])})` : ''}</option>`).join('');
  $('invDelivery').innerHTML = Object.keys(DELIVERY_LABELS).map((k) => `<option value="${k}">${DELIVERY_LABELS[k]}${P.delivery[k] ? ` (+${P.delivery[k]}%)` : ''}</option>`).join('');
  $('invPkg').innerHTML = [...pkgList(), ...(pkgList().some((x) => x.id === pkgOf().id) ? [] : [{ ...pkgOf(), name: pkgOf().name + ' (archived)' }])].map((x) => `<option value="${x.id}">${escHtml(x.name)} — ${x.reels ? x.reels + ' reels, ' : ''}${currency(x.price)}</option>`).join('');
  $('invPkg').value = pkgOf().id;
  $('invAddSel').innerHTML = catalog().filter((a) => !isMo() || ['reel', 'custom'].includes(a.key) || a.key.startsWith('pk')).map((a) => `<option value="${a.key}">${a.label}${a.quote ? '' : ` — ${currency(a.rate)}${a.unit ? '/' + a.unit : ''}`}</option>`).join('');
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
    renderPreview();
  }));
  $('invGroups').querySelectorAll('[data-gdel]').forEach((b) => b.addEventListener('click', () => {
    S.groups = groups().filter((_, i) => i !== Number(b.dataset.gdel)); renderGroups(); renderPreview();
  }));
}

function loadToForm(isSaved = false) {
  loading = true;
  [['invClient', 'client'], ['invPhone', 'phone'], ['invEvent', 'event'], ['invLoc', 'location'], ['invEventDate', 'eventDate'], ['invDate', 'date'], ['invDiscount', 'discount'], ['invAdvance', 'advance'], ['invTerms', 'terms']]
    .forEach(([id, k]) => { $(id).value = S[k] || ''; });
  [['invHandle', 'handle'], ['invPkgPrice', 'pkgPrice'], ['invPStart', 'pStart'], ['invPEnd', 'pEnd']].forEach(([id, k]) => { $(id).value = S[k] || ''; });
  $('invTerms').value = isMo() ? S.mTerms : S.terms;
  $('invForm').dataset.type = S.type; $('invType').value = S.type;
  $('invReferral').value = S.referral ? 'yes' : 'no';
  fillSelects();
  $('invFeatures').value = featList().join('\n'); $('invStats').value = statList().join('\n');
  renderLines(); if (!isMo()) renderGroups(); renderPreview();
  loading = false; clean = isSaved; updatePdfBtn();
}

function renderSaved() {
  const list = getInvoices();
  $('invSaved').innerHTML = list.length ? list.slice().reverse().map((x) => `
    <div class="inv-saved-row" data-id="${x.id}"><span>${x.type === 'monthly' ? '📅' : x.type === 'weekly' ? '🗓️' : x.type === 'onetime' ? '📦' : '🎬'} ${escHtml(x.no)} · ${escHtml(x.client || '—')}${x.projectId ? ' · 🔗 Project' : ''}</span>
      <button class="btn btn-ghost btn-sm" data-open>Open</button><button class="btn btn-ghost btn-sm" data-pdf title="Download PDF">⬇️ PDF</button><button class="btn btn-icon btn-sm" data-rm>🗑️</button></div>`).join('') : '<p class="muted" style="font-size:13px">Nothing saved yet.</p>';
  $('invSaved').querySelectorAll('.inv-saved-row').forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('[data-open]').addEventListener('click', () => { S = { ...fresh(), ...JSON.parse(JSON.stringify(getInvoices().find((x) => x.id === id))) }; loadToForm(true); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    el.querySelector('[data-pdf]').addEventListener('click', () => { S = { ...fresh(), ...JSON.parse(JSON.stringify(getInvoices().find((x) => x.id === id))) }; loadToForm(true); downloadPdf(); });
    el.querySelector('[data-rm]').addEventListener('click', () => { saveInvoices(getInvoices().filter((x) => x.id !== id)); renderSaved(); });
  });
}

const PRICE_FIELDS = [
  ['Base package ₹', 'base'], ['Hours included', 'baseHours'], ['Reels included', 'baseReels'], ['Crew size', 'baseCrew'],
  ['Medium function +₹', 'sizes.medium'], ['Large function +₹', 'sizes.large'], ['Extra reel ₹', 'extraReel'], ['Extra shooting hour ₹', 'extraHour'],
  ['Extra location ₹', 'extraLocation'], ['Travel ₹ per km', 'perKm'], ['24-hour delivery +%', 'delivery.fast'], ['Same-day delivery +%', 'delivery.sameDay'],
  ['Business name', 'business.name', 1], ['Phone', 'business.phone', 1], ['UPI ID', 'business.upi', 1], ['Payment note', 'business.payNote', 1], ['Invoice footer', 'business.footer', 1], ['Monthly tagline', 'business.monthlyTag', 1], ['Monthly payment note', 'business.monthlyPayNote', 1], ['Monthly footer', 'business.monthlyFooter', 1], ['Weekly tagline', 'business.weeklyTag', 1], ['Weekly payment note', 'business.weeklyPayNote', 1], ['Weekly footer', 'business.weeklyFooter', 1], ['One-time tagline', 'business.onetimeTag', 1], ['One-time payment note', 'business.onetimePayNote', 1], ['One-time footer', 'business.onetimeFooter', 1],
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
    const was = S.type;
    S.type = $('invType').value;
    if (isMo() && S.theme === 'gold') S.theme = 'green'; else if (!isMo() && S.theme === 'green') S.theme = 'gold';
    // Monthly <-> weekly: switch to that kind's packages, period and default terms.
    if (isMo() && was !== S.type) {
      const f = fresh(S.type);
      Object.assign(S, { pkgId: f.pkgId, pkgPrice: f.pkgPrice, pStart: f.pStart, pEnd: f.pEnd, features: null, stats: null, mTerms: f.mTerms });
    }
    loadToForm();
  });
  $('invPkg').addEventListener('change', () => { S.pkgId = $('invPkg').value; S.pkgPrice = pkgOf().price; S.features = null; S.stats = null; loadToForm(); });
  bind('invPkgPrice', 'pkgPrice', 1);
  const listBind = (id, k) => $(id).addEventListener('input', () => { S[k] = $(id).value.split('\n').map((x) => x.trim()).filter(Boolean); renderPreview(); });
  listBind('invFeatures', 'features'); listBind('invStats', 'stats');
  $('invMoReset').addEventListener('click', () => { S.features = null; S.stats = null; loadToForm(); });
  $('invPStart').addEventListener('change', () => { S.pStart = $('invPStart').value; if (S.pStart) { S.pEnd = isWk() ? weekEnd(S.pStart) : isOne() ? S.pStart : monthEnd(S.pStart); $('invPEnd').value = S.pEnd; } renderPreview(); });
  $('invPEnd').addEventListener('change', () => { S.pEnd = $('invPEnd').value; renderPreview(); });
  $('invPkgEdit').addEventListener('click', () => import('../router.js').then((m) => m.showPage('packages')));
  bind('invDiscount', 'discount', 1); bind('invAdvance', 'advance', 1);
  $('invAddBtn').addEventListener('click', () => {
    const a = catalog().find((x) => x.key === $('invAddSel').value);
    S.lines.push({ key: a.key, label: a.label, unit: a.unit, qty: 1, rate: a.rate }); renderLines(); renderPreview();
  });
  $('invGAdd').addEventListener('click', () => { S.groups = [...groups(), { title: 'New section', items: [] }]; renderGroups(); renderPreview(); });
  $('invGReset').addEventListener('click', () => { S.groups = null; renderPreview(); });
  $('invTermsDefault').addEventListener('click', () => { if (isWk()) P.business.weeklyTerms = S.mTerms; else if (isOne()) P.business.onetimeTerms = S.mTerms; else if (isMo()) P.business.monthlyTerms = S.mTerms; else P.business.terms = S.terms; savePricing(P); showToast('Saved as your default terms'); });
  $('invPricesBtn').addEventListener('click', openPrices);
  $('invNewBtn').addEventListener('click', () => { S = fresh(S.type); loadToForm(); });
  $('invSaveBtn').addEventListener('click', () => {
    let renumbered = false;
    if (!S.no || noTaken(S.no)) { renumbered = !!S.no; S.no = nextInvNo(); }
    const created = syncProjectFromInvoice();
    const list = getInvoices().filter((x) => x.id !== S.id); list.push(JSON.parse(JSON.stringify(S)));
    saveInvoices(list); renderSaved();
    showToast((renumbered ? `Number was already used — saved as ${S.no}` : created ? 'Invoice saved and project created' : 'Invoice saved and project updated') + ' — you can download the PDF now');
    loadToForm(true);
  });
  $('invPrintBtn').addEventListener('click', printInvoice);
  $('invPdfBtn').addEventListener('click', downloadPdf);
  $('invReferral').addEventListener('change', () => { S.referral = $('invReferral').value === 'yes'; renderPreview(); });
}
