// pages/feedback.js — admin only: what the crew has written, newest first. Each card shows
// the DATE and an optional mood, never who wrote it (the database does not store that).
// You can mark a message read / unread and delete it. The text cannot be edited.

import { supabase } from '../cloud.js';
import { openConfirm } from '../modal.js';
import { showToast } from '../toast.js';
import { escHtml } from '../format.js';

const MOOD = { good: '😊 Good', okay: '😐 Okay', bad: '😟 Not good' };
let rows = [];

function fmtDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function notice(text) {
  const box = document.getElementById('fbNotice');
  if (!box) return;
  box.style.display = text ? '' : 'none';
  box.textContent = text || '';
}

function render() {
  const list = document.getElementById('fbList');
  const empty = document.getElementById('fbEmpty');
  if (!list) return;
  const unread = rows.filter((r) => !r.is_read).length;
  document.getElementById('fbCount').textContent = rows.length ? `${rows.length} message${rows.length === 1 ? '' : 's'} · ${unread} unread` : '';
  empty.style.display = rows.length ? 'none' : '';
  list.innerHTML = rows.map((r) => `
    <article class="fb-card${r.is_read ? '' : ' is-unread'}" data-id="${escHtml(r.id)}">
      <div class="fb-meta">
        ${r.is_read ? '' : '<span class="fb-new">● New</span>'}
        <span>${escHtml(fmtDay(r.day))}</span>
        ${r.mood && MOOD[r.mood] ? `<span>${MOOD[r.mood]}</span>` : ''}
      </div>
      <div class="fb-text">${escHtml(r.message)}</div>
      <div class="fb-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="toggle">${r.is_read ? 'Mark as unread' : 'Mark as read'}</button>
        <button type="button" class="btn btn-danger btn-sm" data-act="delete">Delete</button>
      </div>
    </article>`).join('');
}

async function load() {
  const { data, error } = await supabase.from('feedback').select('*');
  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205';
    notice(missing ? 'The feedback table is missing — run the Phase 2 SQL (SETUP.md → Phase 2).' : 'Could not load feedback: ' + error.message);
    rows = []; render(); return;
  }
  notice('');
  rows = (data || []).slice().sort((a, b) => Number(b.seq) - Number(a.seq));      // newest first
  render();
}

export function init() {
  const list = document.getElementById('fbList');
  if (list && !list.dataset.wired) {
    list.dataset.wired = '1';
    list.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const id = btn.closest('[data-id]').dataset.id;
      const r = rows.find((x) => x.id === id); if (!r) return;
      if (btn.dataset.act === 'toggle') {
        const { error } = await supabase.from('feedback').update({ is_read: !r.is_read }).eq('id', id);
        if (error) { notice(error.message); return; }
        r.is_read = !r.is_read; render();
      } else {
        openConfirm('Delete this feedback? This cannot be undone.', async () => {
          const { error } = await supabase.from('feedback').delete().eq('id', id);
          if (error) { notice(error.message); return; }
          rows = rows.filter((x) => x.id !== id); render(); showToast('Feedback deleted');
        });
      }
    });
    document.getElementById('fbRefresh').addEventListener('click', load);
  }
  load();
}
