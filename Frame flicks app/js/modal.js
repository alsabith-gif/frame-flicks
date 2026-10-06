// modal.js — shared generic modal + confirm-delete dialog, used by every page.

const backdrop = () => document.getElementById('modalBackdrop');
const titleEl = () => document.getElementById('modalTitle');
const bodyEl = () => document.getElementById('modalBody');

const confirmBackdrop = () => document.getElementById('confirmBackdrop');
const confirmText = () => document.getElementById('confirmText');
const confirmOkBtn = () => document.getElementById('confirmOkBtn');

export function openModal(title, bodyHtmlOrNode) {
  titleEl().textContent = title;
  const body = bodyEl();
  body.innerHTML = '';
  if (typeof bodyHtmlOrNode === 'string') {
    body.innerHTML = bodyHtmlOrNode;
  } else if (bodyHtmlOrNode instanceof Node) {
    body.appendChild(bodyHtmlOrNode);
  }
  backdrop().classList.add('open');
}

export function closeModal() {
  backdrop().classList.remove('open');
}

// Fires if the current confirm dialog is dismissed WITHOUT confirming
// (Cancel button, backdrop click, or Escape) — used by the follow-up nudge
// so it can move on to the next due prospect either way.
let pendingCancel = null;

export function openConfirm(message, onConfirm, onCancel, okLabel) {
  confirmText().textContent = message || 'This action cannot be undone.';
  confirmBackdrop().classList.add('open');
  pendingCancel = onCancel || null;

  const okBtn = confirmOkBtn();
  const freshOk = okBtn.cloneNode(true);
  freshOk.textContent = okLabel || 'Delete';
  okBtn.parentNode.replaceChild(freshOk, okBtn);

  freshOk.addEventListener('click', () => {
    pendingCancel = null; // this was a confirm, not a cancel
    closeConfirm();
    onConfirm && onConfirm();
  });
}

export function closeConfirm() {
  confirmBackdrop().classList.remove('open');
  if (pendingCancel) {
    const cb = pendingCancel;
    pendingCancel = null;
    cb();
  }
}

export function initModalSystem() {
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target === backdrop()) closeModal();
  });

  document.getElementById('confirmCloseBtn').addEventListener('click', closeConfirm);
  document.getElementById('confirmCancelBtn').addEventListener('click', closeConfirm);
  document.getElementById('confirmBackdrop').addEventListener('click', (e) => {
    if (e.target === confirmBackdrop()) closeConfirm();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeConfirm();
    }
  });
}
