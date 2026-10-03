// pages/scripts.js — editable DM script cards. Ships with 3 default scripts
// (follow-up messaging lives on the Follow-up tab instead).

import { getScripts, saveScripts, uid } from '../storage.js';
import { showToast } from '../toast.js';
import { openConfirm } from '../modal.js';
import { escHtml } from '../format.js';

export const defaultScripts = [
  {
    id: 'default-1',
    emoji: '👋',
    title: 'Opening DM',
    subtitle: 'First contact — cold outreach',
    color: '#7c6af7',
    text: "Hey [Name]! Loved your recent [Niche] content — the pacing and hooks are really strong. I'm a video editor who works with creators like you to save hours of editing time each week. Would you be open to a quick chat about your content workflow?",
  },
  {
    id: 'default-2',
    emoji: '💬',
    title: 'After they reply',
    subtitle: 'Offer a free sample edit',
    color: '#60a5fa',
    text: "That's awesome to hear, [Name]! I'd love to show you what I can do — happy to edit one of your recent raw clips for free, no strings attached. If you can share a clip, I'll turn it around within 2-3 days so you can see the quality firsthand.",
  },
  {
    id: 'default-3',
    emoji: '🎬',
    title: 'Send the sample + soft close',
    subtitle: 'Deliver work, propose next step',
    color: '#34d399',
    text: "Here's your sample edit, [Name] — let me know what you think! If this is the kind of quality you're after, I'd love to talk about taking editing off your plate on a regular basis. What does your upload schedule usually look like?",
  },
];

// These two used to ship as default scripts here, but follow-up messaging
// now lives entirely on the Follow-up tab (with its own tone/round
// templates), so they're stripped out of anyone's saved list on load —
// both for brand-new installs and for anyone who already has them saved.
const REMOVED_DEFAULT_IDS = ['default-4', 'default-5'];

// Placeholders you can drop into any script; filled in automatically when
// the script is used to compose a message.
const PLACEHOLDERS = [
  { tag: '[Name]', hint: 'the prospect\'s name' },
  { tag: '[Screenshot]', hint: 'where their video screenshot goes' },
];

function ensureSeeded() {
  let list = getScripts();
  if (list === null) {
    list = defaultScripts.map((s) => ({ ...s }));
    saveScripts(list);
    return list;
  }
  const filtered = list.filter((s) => !REMOVED_DEFAULT_IDS.includes(s.id));
  if (filtered.length !== list.length) {
    saveScripts(filtered);
    return filtered;
  }
  return list;
}

function flashSaved(cardEl) {
  const flash = cardEl.querySelector('.saved-flash');
  if (!flash) return;
  flash.classList.add('show');
  setTimeout(() => flash.classList.remove('show'), 1400);
}

function render() {
  const list = ensureSeeded();
  const wrap = document.getElementById('scriptsList');

  wrap.innerHTML = list.map((s) => `
    <div class="script-card" data-id="${s.id}">
      <div class="script-card-head">
        <input type="text" class="script-emoji-input" data-field="emoji" value="${escHtml(s.emoji || '💬')}" maxlength="2">
        <div style="flex:1;">
          <input type="text" class="script-title-input" data-field="title" value="${escHtml(s.title || '')}" placeholder="Script title">
          <input type="text" class="script-subtitle-input" data-field="subtitle" value="${escHtml(s.subtitle || '')}" placeholder="Short subtitle">
        </div>
      </div>
      <textarea class="script-body-textarea" data-field="text" placeholder="Message body… use [Name] as a placeholder">${escHtml(s.text || '')}</textarea>
      <div class="script-placeholder-row">
        <span class="muted">Insert:</span>
        ${PLACEHOLDERS.map((ph) => `<button type="button" class="placeholder-chip" data-insert="${ph.tag}" title="${escHtml(ph.hint)}">${ph.tag}</button>`).join('')}
      </div>
      <div class="script-card-foot">
        <span class="saved-flash">✓ Saved</span>
        <button class="btn btn-icon btn-sm" data-action="delete" data-id="${s.id}">🗑️</button>
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('.script-card').forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('blur', () => {
        const current = getScripts() || [];
        const s = current.find((x) => x.id === id);
        if (s) {
          s[input.dataset.field] = input.value;
          saveScripts(current);
          flashSaved(card);
        }
      });
    });

    const textarea = card.querySelector('.script-body-textarea');
    card.querySelectorAll('[data-insert]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const tag = chip.dataset.insert;
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        textarea.value = textarea.value.slice(0, start) + tag + textarea.value.slice(end);
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = start + tag.length;
        textarea.dispatchEvent(new Event('blur'));
      });
    });

    card.querySelector('[data-action="delete"]').addEventListener('click', () => {
      openConfirm('Delete this script? This action cannot be undone.', () => {
        const current = (getScripts() || []).filter((x) => x.id !== id);
        saveScripts(current);
        showToast('Script deleted');
        render();
      });
    });
  });
}

function addBlankScript() {
  const current = getScripts() || [];
  current.push({ id: uid(), emoji: '📝', title: 'New Script', subtitle: '', color: '#7c6af7', text: '' });
  saveScripts(current);
  showToast('Script added');
  render();
}

export function init() {
  render();
}

export function getAddButton() {
  return { label: '+ Add Script', onClick: addBlankScript };
}
