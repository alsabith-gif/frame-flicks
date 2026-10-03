// pages/priceSplit.js — splits a price by the (editable) distribution
// percentages. Referral share goes to Business when there is no referral.

import { getPricing, savePricing, getIncome } from '../storage.js';
import { splitPrice, DEFAULT_PRICING } from '../pricing.js';
import { escHtml, currency } from '../format.js';

let P;
const $ = (id) => document.getElementById(id);

function render() {
  const total = Number($('psTotal').value) || 0;
  const crew = Number($('psCrew').value) || 1;
  const r = splitPrice(total, P.distribution, { referral: $('psRef').value === '1', crew });
  $('psRows').innerHTML = r.rows.map((x, i) => `
    <div class="ps-row${x.unused ? ' off' : ''}">
      <div>${escHtml(x.label)}<span class="note">${x.unused ? 'No referral → goes to Business' : escHtml(x.note || '')}${x.perPerson ? ` · ${currency(x.perPerson)} each (${r.people})` : ''}</span></div>
      <div><input type="number" min="0" step="0.5" data-i="${i}" value="${x.pct}" aria-label="${escHtml(x.label)} %"></div>
      <div class="amt">${currency(x.amount)}</div>
    </div>`).join('') + `
    <div class="ps-foot"><span>Total (${r.pctTotal}%)</span><span>${currency(r.total)}</span></div>
    ${Math.abs(r.pctTotal - 100) > 0.001 ? `<div class="ps-warn">Percentages add up to ${r.pctTotal}%, not 100%${r.unallocated ? ` — ${currency(Math.abs(r.unallocated))} ${r.unallocated > 0 ? 'unallocated' : 'over-allocated'}` : ''}.</div>` : ''}`;
  $('psRows').querySelectorAll('input').forEach((el) => el.addEventListener('change', () => {
    P.distribution[el.dataset.i].pct = Math.max(0, Number(el.value) || 0);
    savePricing(P); render();
  }));
}

export function init() {
  P = getPricing();
  const projects = getIncome().filter((p) => p.amount);
  $('psProject').innerHTML = '<option value="">— none —</option>' + projects.map((p) => `<option value="${p.id}">${escHtml(p.project || 'Project')} — ${currency(p.amount)}</option>`).join('');
  $('psCrew').value = P.crew;
  $('psProject').addEventListener('change', () => {
    const p = projects.find((x) => x.id === $('psProject').value);
    if (p) { $('psTotal').value = p.amount; render(); }
  });
  ['psTotal', 'psRef'].forEach((id) => $(id).addEventListener('input', render));
  $('psCrew').addEventListener('input', () => { P.crew = Number($('psCrew').value) || 1; savePricing(P); render(); });
  $('psReset').addEventListener('click', () => { P.distribution = DEFAULT_PRICING.distribution.map((d) => ({ ...d })); savePricing(P); render(); });
  render();
}
