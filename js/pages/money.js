// pages/money.js — admin Money page: payments received, your own expenses, what is left,
// and who still owes you. Everything is stored in the admin's synced data (never visible to crew).
import { getIncome, getExpenses, saveExpenses, uid } from '../storage.js';
import { escHtml, formatDate, currency } from '../format.js';
import { summary, monthsWithData, balance, EXPENSE_CATEGORIES } from '../money.js';
import { openPaymentModal, upgradeOldPartials } from '../paymentsUi.js';
import { openConfirm } from '../modal.js';
import { showToast } from '../toast.js';

let month = '';   // '' = all time
const $ = (id) => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

function render() {
  const projects = getIncome(); const expenses = getExpenses();
  const months = monthsWithData(projects, expenses);
  if (month && !months.includes(month)) month = '';
  $('mnMonth').innerHTML = `<option value="">All time</option>${months.map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${escHtml(monthLabel(m))}</option>`).join('')}`;
  const s = summary(projects, expenses, month);
  $('mnKpis').innerHTML = [
    ['Received', s.received, ''], ['Your expenses', s.expenses, ''], ['Left', s.left, s.left < 0 ? 'neg' : ''], ['Still to receive (all time)', s.owed, ''],
  ].map(([l, v, c]) => `<div class="mn-kpi ${c}"><span>${escHtml(l)}</span><b>${s.left < 0 && l === 'Left' ? '− ' : ''}${escHtml(currency(Math.abs(v)))}</b></div>`).join('');

  $('mnExpenses').innerHTML = s.expenseRows.length
    ? s.expenseRows.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((e) => `<div class="mn-row"><div class="mn-main">${escHtml(e.category || 'Other')}${e.note ? ` · ${escHtml(e.note)}` : ''}<small>${e.date ? escHtml(formatDate(e.date)) : '—'}</small></div><b>${escHtml(currency(e.amount))}</b><button type="button" class="btn btn-icon btn-sm" data-exdel="${escHtml(e.id)}" title="Delete">🗑️</button></div>`).join('')
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

export function init() {
  month = '';
  upgradeOldPartials();
  $('exCat').innerHTML = EXPENSE_CATEGORIES.map((c) => `<option>${escHtml(c)}</option>`).join('');
  $('exDate').value = today();
  $('mnMonth').addEventListener('change', (e) => { month = e.target.value; render(); });
  $('exAdd').addEventListener('click', () => {
    const amt = Math.round(Number($('exAmt').value) || 0);
    if (amt <= 0) { $('exMsg').textContent = 'Enter an amount above 0.'; return; }
    $('exMsg').textContent = '';
    const list = getExpenses();
    list.push({ id: uid(), date: $('exDate').value || today(), amount: amt, category: $('exCat').value, note: $('exNote').value.trim().slice(0, 120) });
    saveExpenses(list);
    $('exAmt').value = ''; $('exNote').value = '';
    showToast('Expense added'); render();
  });
  render();
}
