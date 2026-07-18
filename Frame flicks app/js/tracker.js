// tracker.js — powers track.html, the public, unauthenticated page a client
// opens from their progress link. Reads the ?p=<trackCode> query param,
// looks it up in the `project_status` table (safe to expose read-only via
// RLS since a trackCode is an unguessable random string, not a real ID),
// and renders a simple step tracker. No login, no access to the rest of
// the app's data.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const PROJECT_STAGES = ['Received', 'Rough Cut', 'Color & Sound', 'Review', 'Delivered'];

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loadingEl = document.getElementById('trackLoading');
const notFoundEl = document.getElementById('trackNotFound');
const contentEl = document.getElementById('trackContent');

function show(el) {
  [loadingEl, notFoundEl, contentEl].forEach((e) => { e.style.display = e === el ? '' : 'none'; });
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSteps(currentStage) {
  const idx = Math.max(0, PROJECT_STAGES.indexOf(currentStage));
  return PROJECT_STAGES.map((stage, i) => {
    let cls = '';
    let mark = '';
    if (i < idx) { cls = 'done'; mark = '✓'; }
    else if (i === idx) { cls = 'current'; mark = String(i + 1); }
    else { mark = String(i + 1); }
    return `
      <div class="track-step ${cls}">
        <span class="track-step-dot">${mark}</span>
        <span class="track-step-line"></span>
        <span class="track-step-label">${escHtml(stage)}</span>
      </div>`;
  }).join('');
}

function timeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Updated just now';
  if (mins < 60) return `Updated ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Updated ${days}d ago`;
}

async function load() {
  const params = new URLSearchParams(window.location.search);
  const trackCode = params.get('p');

  if (!trackCode) { show(notFoundEl); return; }

  try {
    const { data, error } = await supabase
      .from('project_status')
      .select('client, project, stage, note, updated_at')
      .eq('track_code', trackCode)
      .maybeSingle();

    if (error || !data) { show(notFoundEl); return; }

    document.getElementById('trackProject').textContent = data.project || 'Your project';
    document.getElementById('trackClient').textContent = data.client ? `for ${data.client}` : '';
    document.getElementById('trackProgress').innerHTML = renderSteps(data.stage || 'Received');

    const noteEl = document.getElementById('trackNote');
    if (data.note) {
      noteEl.textContent = data.note;
      noteEl.style.display = '';
    } else {
      noteEl.style.display = 'none';
    }

    document.getElementById('trackUpdated').textContent = timeAgo(data.updated_at);
    show(contentEl);
  } catch (err) {
    console.error('failed to load project status', err);
    show(notFoundEl);
  }
}

load();
