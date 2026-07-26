// toast.js — bottom-center floating toast notifications.

let hideTimer = null;

export function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 2400);
}
