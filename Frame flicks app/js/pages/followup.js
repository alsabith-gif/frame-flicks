// pages/followup.js — due follow-ups, settings, tone/template editor, history log.

import { getProspects, getFuSettings, saveFuSettings, getFuHistory, saveFuHistory } from '../storage.js';
import { showToast } from '../toast.js';
import { openModal, closeModal } from '../modal.js';
import { escHtml, formatDate, daysBetween, todayStr } from '../format.js';

const TONES = [
  { key: 'Friendly', desc: 'Warm, casual, emoji-friendly' },
  { key: 'Professional', desc: 'Polished, respectful, businesslike' },
  { key: 'Curious', desc: 'Light, question-driven check-in' },
  { key: 'Urgency', desc: 'Creates gentle time pressure' },
];

let selectedRound = 1;
let selectedTone = 'Friendly';

function fillTemplate(text, sample) {
  return (text || '')
    .replaceAll('[Name]', sample.name)
    .replaceAll('[Niche]', sample.niche)
    .replaceAll('[Platform]', sample.platform);
}

/* ---------------- Due follow-ups ---------------- */

function excludedStatuses() {
  return ['Not Sent', 'Closed', 'Not Interested'];
}

function computeDue() {
  const settings = getFuSettings();
  const history = getFuHistory();
  const prospects = getProspects();
  const due = [];

  prospects.forEach((p) => {
    if (excludedStatuses().includes(p.status)) return;
    if (!p.date) return;
    const daysSince = daysBetween(todayStr(), p.date);

    const loggedRounds = new Set(history.filter((h) => h.prospectId === p.id || h.prospectName === p.name).map((h) => h.round));

    let round = null;
    if (daysSince >= settings.day3 && !loggedRounds.has(3)) round = 3;
    else if (daysSince >= settings.day2 && !loggedRounds.has(2)) round = 2;
    else if (daysSince >= settings.day1 && !loggedRounds.has(1)) round = 1;

    if (round) due.push({ prospect: p, round, daysSince });
  });

  return due;
}

function renderDue() {
  const due = computeDue();
  const wrap = document.getElementById('dueFollowupsList');

  if (!due.length) {
    wrap.innerHTML = '<p class="muted">Nothing due right now — you\'re all caught up 🎉</p>';
    return;
  }

  wrap.innerHTML = due.map(({ prospect, round, daysSince }) => `
    <div class="due-row">
      <span class="dr-name">${escHtml(prospect.name)}</span>
      <span class="badge badge-amber">Round ${round}</span>
      <span class="muted">${daysSince}d since last contact</span>
      <div class="dr-actions">
        <button class="btn btn-sm btn-primary" data-action="send" data-id="${prospect.id}" data-round="${round}">Send</button>
        <button class="btn btn-sm btn-ghost" data-action="skip" data-id="${prospect.id}" data-round="${round}">Skip</button>
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('[data-action="send"]').forEach((btn) => {
    btn.addEventListener('click', () => openSendModal(btn.dataset.id, Number(btn.dataset.round)));
  });
  wrap.querySelectorAll('[data-action="skip"]').forEach((btn) => {
    btn.addEventListener('click', () => logFollowup(btn.dataset.id, Number(btn.dataset.round), null, 'skipped'));
  });
}

function logFollowup(prospectId, round, tone, action) {
  const prospects = getProspects();
  const p = prospects.find((x) => x.id === prospectId);
  const history = getFuHistory();
  history.push({
    prospectId,
    prospectName: p ? p.name : 'Unknown',
    round, tone, action,
    date: todayStr(),
  });
  saveFuHistory(history);
  showToast(action === 'sent' ? 'Follow-up logged as sent' : 'Follow-up skipped');
  renderDue();
  renderHistory();
}

function openSendModal(prospectId, round) {
  const p = getProspects().find((x) => x.id === prospectId);
  if (!p) return;
  const settings = getFuSettings();
  let tone = 'Friendly';

  const body = document.createElement('div');

  function refreshPreview() {
    const template = settings.scripts?.[round]?.[tone] || '';
    const filled = fillTemplate(template, { name: p.name, niche: p.niche || 'your niche', platform: p.platform || 'your platform' });
    body.querySelector('#sendBodyTextarea').value = filled;
  }

  body.innerHTML = `
    <p class="muted" style="margin-bottom:14px;">To: <b>${escHtml(p.name)}</b> &lt;${escHtml(p.email || 'no email on file')}&gt; — Round ${round}</p>
    <div class="tone-grid" id="sendToneGrid">
      ${TONES.map((t) => `<div class="tone-card ${t.key === tone ? 'selected' : ''}" data-tone="${t.key}"><div class="tc-name">${t.key}</div><div class="tc-desc">${t.desc}</div></div>`).join('')}
    </div>
    <div class="form-field mt-16"><label>Message</label><textarea id="sendBodyTextarea" style="min-height:140px;"></textarea></div>
    <div class="form-actions">
      <button class="btn btn-ghost" id="sendCancelBtn">Cancel</button>
      <button class="btn btn-danger" id="sendOpenGmailBtn">✉️ Open in Gmail</button>
    </div>
  `;

  openModal('Send Follow-up', body);
  refreshPreview();

  body.querySelectorAll('.tone-card').forEach((card) => {
    card.addEventListener('click', () => {
      tone = card.dataset.tone;
      body.querySelectorAll('.tone-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      refreshPreview();
    });
  });

  body.querySelector('#sendCancelBtn').addEventListener('click', closeModal);
  body.querySelector('#sendOpenGmailBtn').addEventListener('click', () => {
    const subject = encodeURIComponent(`Following up, ${p.name}`);
    const bodyText = encodeURIComponent(body.querySelector('#sendBodyTextarea').value);
    const to = encodeURIComponent(p.email || '');
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${subject}&body=${bodyText}`, '_blank');
    closeModal();
    logFollowup(prospectId, round, tone, 'sent');
  });
}

/* ---------------- Settings ---------------- */

function loadSettingsIntoForm() {
  const s = getFuSettings();
  document.getElementById('fuDay1').value = s.day1;
  document.getElementById('fuDay2').value = s.day2;
  document.getElementById('fuDay3').value = s.day3;
  document.getElementById('fuAutoNoReply').value = s.autoNoReply;
}

function saveOffsets() {
  const s = getFuSettings();
  s.day1 = Number(document.getElementById('fuDay1').value) || s.day1;
  s.day2 = Number(document.getElementById('fuDay2').value) || s.day2;
  s.day3 = Number(document.getElementById('fuDay3').value) || s.day3;
  s.autoNoReply = Number(document.getElementById('fuAutoNoReply').value) || s.autoNoReply;
  saveFuSettings(s);
  showToast('Follow-up settings saved');
  renderDue();
}

/* ---------------- History ---------------- */

function renderHistory() {
  const history = getFuHistory().slice().reverse().slice(0, 20);
  const wrap = document.getElementById('fuHistoryList');
  if (!history.length) {
    wrap.innerHTML = '<p class="muted">No follow-ups logged yet.</p>';
    return;
  }
  wrap.innerHTML = history.map((h) => `
    <div class="fu-history-row">
      <span>${escHtml(h.prospectName)} — Round ${h.round}${h.tone ? ' · ' + escHtml(h.tone) : ''}</span>
      <span class="badge ${h.action === 'sent' ? 'badge-green' : 'badge-muted'}">${h.action === 'sent' ? 'Sent' : 'Skipped'} · ${formatDate(h.date)}</span>
    </div>
  `).join('');
}

/* ---------------- Tone & Template editor ---------------- */

function renderRoundTabs() {
  document.querySelectorAll('#roundTabs .chip').forEach((chip) => {
    chip.classList.toggle('active', Number(chip.dataset.round) === selectedRound);
    chip.addEventListener('click', () => {
      selectedRound = Number(chip.dataset.round);
      renderRoundTabs();
      renderToneGrid();
      loadTemplateIntoTextarea();
    });
  });
}

function renderToneGrid() {
  const grid = document.getElementById('toneGrid');
  grid.innerHTML = TONES.map((t) => `
    <div class="tone-card ${t.key === selectedTone ? 'selected' : ''}" data-tone="${t.key}">
      <div class="tc-name">${t.key}</div>
      <div class="tc-desc">${t.desc}</div>
    </div>
  `).join('');
  grid.querySelectorAll('.tone-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedTone = card.dataset.tone;
      renderToneGrid();
      loadTemplateIntoTextarea();
    });
  });
}

function loadTemplateIntoTextarea() {
  const settings = getFuSettings();
  const text = settings.scripts?.[selectedRound]?.[selectedTone] || '';
  document.getElementById('templateTextarea').value = text;
  updatePreview();
}

function updatePreview() {
  const text = document.getElementById('templateTextarea').value;
  const filled = fillTemplate(text, { name: 'Aarav', niche: 'fitness', platform: 'Instagram' });
  document.getElementById('templatePreview').textContent = filled || '—';
}

function saveTemplate() {
  const settings = getFuSettings();
  if (!settings.scripts) settings.scripts = {};
  if (!settings.scripts[selectedRound]) settings.scripts[selectedRound] = {};
  settings.scripts[selectedRound][selectedTone] = document.getElementById('templateTextarea').value;
  saveFuSettings(settings);
  showToast('Template saved');
}

export function init() {
  loadSettingsIntoForm();
  renderDue();
  renderHistory();
  renderRoundTabs();
  renderToneGrid();
  loadTemplateIntoTextarea();

  document.getElementById('saveFuSettingsBtn').addEventListener('click', saveOffsets);
  document.getElementById('saveTemplateBtn').addEventListener('click', saveTemplate);
  document.getElementById('templateTextarea').addEventListener('input', updatePreview);
}
