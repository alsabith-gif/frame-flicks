// paymentsUi.js — the "Payments" block of a project (history, record a payment,
// remove a payment). Used by the Projects detail page and the Money page.
import { getIncome, saveIncome, uid } from './storage.js';
import { escHtml, formatDate, currency } from './format.js';
import { received, balance, hasPayments, addPayment, removePayment, startPayments, statusFor } from './money.js';
import { openModal, closeModal, openConfirm } from './modal.js';
import { showToast } from './toast.js';
import { getInvoices } from './storage.js';

const today = () => new Date().toISOString().slice(0, 10);
const row = (k, v) => `<div class="pd-kv"><span>${escHtml(k)}</span><b>${v}</b></div>`;

// Older "Partial" projects have no payments list, but their invoice remembers the advance.
// Turn that advance into a first payment (once, never overwriting anything), so every
// screen agrees on how much was received. Safe to call as often as you like.
export function upgradeOldPartials() {
  const list = getIncome(); const invs = getInvoices(); let changed = false;
  list.forEach((p) => {
    if (hasPayments(p) || p.status !== 'Partial') return;
    const inv = invs.find((x) => x.id === p.invoiceId || x.projectId === p.id);
    const adv = inv ? Math.round(Number(inv.advance) || 0) : 0;
    if (adv > 0) { startPayments(p, adv); p.status = statusFor(p); changed = true; }
  });
  if (changed) saveIncome(list);
  return changed;
}

// What the person sees. Old projects without a list show their old status line only.
export function paymentsBlockHtml(p) {
  const amount = Number(p.amount || 0);
  const cls = p.status === 'Paid' ? 'badge-green' : p.status === 'Partial' ? 'badge-amber' : 'badge-muted';
  let h = row('Project amount', escHtml(currency(amount)));
  h += row('Payment status', `<span class="badge ${cls}">${escHtml(p.status || 'Pending')}</span>`);
  h += row('Received so far', escHtml(currency(received(p))));
  h += row('Balance', escHtml(currency(balance(p))));
  if (hasPayments(p) && p.payments.length) {
    h += '<div class="pay-list">' + p.payments.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((x) =>
      `<div class="pay-row"><span>${x.date ? escHtml(formatDate(x.date)) : '—'}${x.note ? ` · ${escHtml(x.note)}` : ''}</span><b>${escHtml(currency(x.amount))}</b>
        <button type="button" class="btn btn-icon btn-sm" data-paydel="${escHtml(x.id)}" title="Remove this payment">🗑️</button></div>`).join('') + '</div>';
  } else if (!hasPayments(p) && p.status !== 'Paid') {
    h += '<p class="muted" style="font-size:12.5px;margin:6px 0 0">No payments recorded yet.</p>';
  }
  h += `<div class="pd-actions"><button type="button" class="btn btn-primary btn-sm" data-payadd="${escHtml(p.id)}" ${amount > 0 && balance(p) === 0 ? 'disabled' : ''}>＋ Record a payment</button></div>`;
  return h;
}

export function wirePayments(root, onChange) {
  root.querySelectorAll('[data-payadd]').forEach((b) => b.addEventListener('click', () => openPaymentModal(b.dataset.payadd, onChange)));
  root.querySelectorAll('[data-paydel]').forEach((b) => b.addEventListener('click', () => {
    const pid = b.closest('[data-pid]')?.dataset.pid || root.dataset.pid;
    openConfirm('Remove this payment? The balance will go up again.', () => {
      const list = getIncome(); const p = list.find((x) => x.id === pid); if (!p) return;
      removePayment(p, b.dataset.paydel); saveIncome(list); showToast('Payment removed'); if (onChange) onChange();
    });
  }));
}

export function openPaymentModal(projectId, onChange) {
  const list = getIncome(); const p = list.find((x) => x.id === projectId); if (!p) return;
  const body = document.createElement('div');
  const bal = balance(p);
  body.innerHTML = `<p class="muted" style="margin:0 0 10px">${escHtml(p.client || '')} — ${escHtml(p.project || '')}<br>Balance now: <b>${escHtml(currency(bal))}</b></p>
    <div class="form-grid">
      <div class="form-field"><label>Amount received (₹)</label><input type="number" id="payAmt" min="1" value="${bal > 0 ? bal : ''}"></div>
      <div class="form-field"><label>Date</label><input type="date" id="payDate" value="${today()}"></div>
      <div class="form-field" style="grid-column:1/-1"><label>Note (optional)</label><input type="text" id="payNote" maxlength="120" placeholder="e.g. UPI, second instalment"></div>
    </div><p class="muted" id="payMsg" style="color:#c0392b;min-height:1em"></p>
    <div class="form-actions"><button class="btn btn-ghost" id="payCancel">Cancel</button><button class="btn btn-primary" id="paySave">Save payment</button></div>`;
  openModal('Record a payment', body);
  body.querySelector('#payCancel').addEventListener('click', closeModal);
  body.querySelector('#paySave').addEventListener('click', () => {
    const amt = Number(body.querySelector('#payAmt').value) || 0;
    const msg = body.querySelector('#payMsg');
    if (amt <= 0) { msg.textContent = 'Enter an amount above 0.'; return; }
    const fresh = getIncome(); const q = fresh.find((x) => x.id === projectId);
    if (Number(q.amount) > 0 && amt > balance(q)) { msg.textContent = `That is more than the balance (${currency(balance(q))}). Change the project amount first if the price went up.`; return; }
    addPayment(q, { date: body.querySelector('#payDate').value || today(), amount: amt, note: body.querySelector('#payNote').value }, uid());
    saveIncome(fresh); closeModal();
    showToast(q.status === 'Paid' ? 'Payment saved — fully paid' : 'Payment saved');
    if (onChange) onChange();
  });
}
