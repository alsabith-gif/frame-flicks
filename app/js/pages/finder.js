// pages/finder.js — AI Finder. Owns the Anthropic fetch() call that searches
// for creator leads and saves results as named "batches".

import { getAiResults, saveAiResults, getAddedAi, saveAddedAi, getProspects, saveProspects, uid } from '../storage.js';
import { showToast } from '../toast.js';
import { escHtml } from '../format.js';
import { AI_WORKER_URL } from '../config.js';

let activeBatchIndex = null;

function buildPrompt(criteria) {
  return `You are a talent researcher helping a freelance video editor find creators who likely need editing help.

Search criteria:
- Platform: ${criteria.platform}
- Niche / content type: ${criteria.niche || 'any'}
- Follower range: ${criteria.minFollowers || 'no min'} to ${criteria.maxFollowers || 'no max'}
- Upload frequency: ${criteria.frequency}
- Content quality: ${criteria.quality}
- Language/Region: ${criteria.language || 'any'}
- Extra requirements: ${criteria.extra || 'none'}

Return exactly ${criteria.count} plausible creator profiles that match this brief. Respond with ONLY a raw JSON array (no markdown fences, no preamble, no commentary) of objects shaped like:
[{"name":"...", "handle":"...", "platform":"...", "niche":"...", "followers":"...", "frequency":"...", "contentFormat":"e.g. Reels, Shorts, Long-form vlogs, Livestream clips", "why":"one line on why they likely need editing help", "emoji":"a single emoji", "profileHint":"a short hint on how to find their real profile"}]`;
}

// Builds a real, clickable link to go look at the creator's actual content
// (their Reels/Shorts feed when possible) so the lead can be verified.
function profileSearchUrl(c) {
  const handle = (c.handle || c.name || '').replace(/^@/, '').trim();
  const q = encodeURIComponent(handle);
  switch ((c.platform || '').toLowerCase()) {
    case 'instagram': return `https://www.instagram.com/${q}/reels/`;
    case 'youtube': return `https://www.youtube.com/results?search_query=${q}`;
    case 'tiktok': return `https://www.tiktok.com/@${q}`;
    default: return `https://www.google.com/search?q=${q}+${encodeURIComponent(c.platform || '')}`;
  }
}

function extractJsonArray(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found in AI response');
  return JSON.parse(match[0]);
}

async function callAnthropic(prompt) {
  const res = await fetch(AI_WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Worker error ${res.status}`);
  if (!data.text) throw new Error('No text in AI response');
  return data.text;
}

function setLoading(on, count) {
  document.getElementById('finderLoading').style.display = on ? '' : 'none';
  document.getElementById('finderLoadingText').textContent = `AI is finding ${count} creators…`;
  document.getElementById('finderEmpty').style.display = 'none';
  document.getElementById('finderError').style.display = 'none';
  document.getElementById('findCreatorsBtn').disabled = on;
}

function setError(msg) {
  document.getElementById('finderError').style.display = '';
  document.getElementById('finderErrorText').textContent = msg;
  document.getElementById('finderLoading').style.display = 'none';
}

function renderGroupChips() {
  const batches = getAiResults();
  const bar = document.getElementById('aiGroupChips');
  if (!batches.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = batches.map((b, i) => `<button class="chip ${i === activeBatchIndex ? 'active' : ''}" data-idx="${i}">${escHtml(b.group)}</button>`).join('');
  bar.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      activeBatchIndex = Number(chip.dataset.idx);
      renderGroupChips();
      renderResults();
    });
  });
}

function renderResults() {
  const batches = getAiResults();
  const head = document.getElementById('finderResultsHead');
  const cardsWrap = document.getElementById('finderCards');
  const emptyEl = document.getElementById('finderEmpty');

  if (activeBatchIndex === null || !batches[activeBatchIndex]) {
    head.style.display = 'none';
    cardsWrap.innerHTML = '';
    emptyEl.style.display = batches.length ? 'none' : '';
    return;
  }

  const batch = batches[activeBatchIndex];
  const addedHandles = new Set(getAddedAi());
  emptyEl.style.display = 'none';
  head.style.display = '';
  document.getElementById('finderResultsCount').textContent = `${batch.results.length} creators in "${batch.group}"`;

  cardsWrap.innerHTML = batch.results.map((c, i) => {
    const isAdded = addedHandles.has(c.handle);
    return `
      <div class="finder-card">
        <div class="fc-top">
          <div class="fc-avatar">${c.emoji || '🎬'}</div>
          <div>
            <div class="fc-name">${escHtml(c.name || 'Unknown')}</div>
            <div class="fc-handle">${escHtml(c.handle || '')}</div>
          </div>
        </div>
        <div class="fc-meta">
          <span class="badge badge-muted">${escHtml(c.platform || '')}</span>
          <span class="badge badge-muted">${escHtml(c.niche || '')}</span>
          <span class="badge badge-muted">${escHtml(c.followers || '')}</span>
          ${c.contentFormat ? `<span class="badge badge-purple">🎬 ${escHtml(c.contentFormat)}</span>` : ''}
        </div>
        <div class="fc-why">${escHtml(c.why || '')}</div>
        <div class="fc-actions">
          <a class="btn btn-sm btn-ghost" href="${profileSearchUrl(c)}" target="_blank" rel="noopener">🔗 View Reels</a>
          <button class="btn btn-sm ${isAdded ? '' : 'btn-primary'}" data-action="add" data-idx="${i}" ${isAdded ? 'disabled' : ''}>
            ${isAdded ? '✓ Added' : '+ Add'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  cardsWrap.querySelectorAll('[data-action="add"]').forEach((btn) => {
    btn.addEventListener('click', () => addCreatorToProspects(batch, Number(btn.dataset.idx)));
  });
}

function addCreatorToProspects(batch, idx) {
  const creator = batch.results[idx];
  const added = getAddedAi();
  if (added.includes(creator.handle)) { showToast('Already added'); return; }

  const prospects = getProspects();
  prospects.push({
    id: uid(),
    name: creator.name || creator.handle,
    platform: creator.platform || 'Instagram',
    niche: creator.niche || '',
    followers: creator.followers || '',
    email: '',
    url: '',
    status: 'Not Sent',
    priority: 'Medium',
    date: new Date().toISOString().slice(0, 10),
    followup: '',
    next: '',
    notes: creator.why || '',
    groupId: '',
    aiGroup: batch.group,
    pipe_email: false, pipe_video: false, pipe_meeting: false, pipe_booked: false,
  });
  saveProspects(prospects);

  added.push(creator.handle);
  saveAddedAi(added);

  showToast(`${creator.name} added to Prospects`);
  if (window.ctRefreshPipelineMini) window.ctRefreshPipelineMini();
  renderResults();
}

function addAllToProspects() {
  const batches = getAiResults();
  const batch = batches[activeBatchIndex];
  if (!batch) return;
  batch.results.forEach((_, i) => addCreatorToProspects(batch, i));
  showToast('All creators added to Prospects');
}

async function handleFindCreators() {
  const criteria = {
    platform: document.getElementById('finPlatform').value,
    niche: document.getElementById('finNiche').value.trim(),
    minFollowers: document.getElementById('finMinFollowers').value,
    maxFollowers: document.getElementById('finMaxFollowers').value,
    frequency: document.getElementById('finFrequency').value,
    quality: document.getElementById('finQuality').value,
    language: document.getElementById('finLanguage').value.trim(),
    extra: document.getElementById('finExtra').value.trim(),
    count: Number(document.getElementById('finCount').value) || 12,
  };
  const groupName = document.getElementById('finGroupName').value.trim() || `Batch ${getAiResults().length + 1}`;

  setLoading(true, criteria.count);

  try {
    const raw = await callAnthropic(buildPrompt(criteria));
    const results = extractJsonArray(raw);

    const batches = getAiResults();
    batches.push({ group: groupName, criteria, results });
    saveAiResults(batches);

    activeBatchIndex = batches.length - 1;
    setLoading(false, criteria.count);
    renderGroupChips();
    renderResults();
    showToast(`Found ${results.length} creators`);
  } catch (err) {
    console.error(err);
    setLoading(false, criteria.count);
    setError("Couldn't reach the AI search right now. This feature needs the Anthropic API wired up with a key on the hosting side — try again in a moment.");
  }
}

export function init() {
  const batches = getAiResults();
  activeBatchIndex = batches.length ? batches.length - 1 : null;

  document.getElementById('findCreatorsBtn').addEventListener('click', handleFindCreators);
  document.getElementById('addAllBtn').addEventListener('click', addAllToProspects);

  renderGroupChips();
  renderResults();
}
