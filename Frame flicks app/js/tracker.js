// tracker.js — powers track.html, the public, unauthenticated page a client
// opens from their progress link. Reads the ?p=<trackCode> query param,
// looks it up in the `project_status` table (safe to expose read-only via
// RLS since a trackCode is an unguessable random string, not a real ID),
// and renders an animated step tracker. No login, no access to the rest of
// the app's data.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const PROJECT_STAGES = ['Received', 'Rough Cut', 'Color & Sound', 'Review', 'Delivered'];

// Your contact details for the client "get in touch" buttons. Edit these
// two lines if your number or email ever changes.
const CONTACT_WHATSAPP = '918921706042'; // country code + number, no + or spaces
const CONTACT_EMAIL = 'muhammedalsabith111@gmail.com';

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

function formatShortDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
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

// Builds the row of step dots + labels + dates, then animates the fill
// line and each reached dot in sequence so the page feels alive on open.
function renderSteps(currentStage, stageHistory) {
  const idx = Math.max(0, PROJECT_STAGES.indexOf(currentStage));
  const stepsEl = document.getElementById('trackSteps');

  stepsEl.innerHTML = PROJECT_STAGES.map((stage, i) => {
    const dateStr = stageHistory && stageHistory[stage] ? formatShortDate(stageHistory[stage]) : '—';
    return `
      <div class="track-step" data-i="${i}">
        <div class="track-step-dot">${i + 1}</div>
        <div class="track-step-label">${escHtml(stage)}</div>
        <div class="track-step-date">${escHtml(dateStr)}</div>
      </div>`;
  }).join('');

  const fillEl = document.getElementById('trackFill');
  const targetPct = (idx / (PROJECT_STAGES.length - 1)) * 100;

  requestAnimationFrame(() => {
    setTimeout(() => { fillEl.style.width = `${targetPct}%`; }, 250);
  });

  const dots = stepsEl.querySelectorAll('.track-step-dot');
  for (let i = 0; i <= idx; i++) {
    const stepEl = stepsEl.children[i];
    const delay = 250 + (i + 1) * 320;
    setTimeout(() => {
      stepEl.classList.add(i < idx ? 'done' : 'current');
      if (i < idx) {
        dots[i].innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      }
    }, delay);
  }
}

async function load() {
  const params = new URLSearchParams(window.location.search);
  const trackCode = params.get('p');

  if (!trackCode) { show(notFoundEl); return; }

  try {
    const { data, error } = await supabase
      .from('project_status')
      .select('client, project, stage, note, due_date, stage_history, updated_at')
      .eq('track_code', trackCode)
      .maybeSingle();

    if (error || !data) { show(notFoundEl); return; }

    const stage = data.stage || 'Received';

    document.getElementById('trackProject').textContent = data.project || 'Your project';
    document.getElementById('trackClient').textContent = data.client ? `for ${data.client}` : '';

    if (stage === 'Delivered') {
      document.getElementById('trackProgressBlock').style.display = 'none';
      const deliveredBlock = document.getElementById('trackDeliveredBlock');
      deliveredBlock.style.display = '';
      const deliveredDate = (data.stage_history && data.stage_history.Delivered)
        ? formatShortDate(data.stage_history.Delivered)
        : formatShortDate((data.updated_at || '').slice(0, 10));
      document.getElementById('trackDeliveredDate').textContent = deliveredDate ? `Delivered on ${deliveredDate}` : '';
    } else {
      renderSteps(stage, data.stage_history);
      if (data.due_date) {
        const expectedEl = document.getElementById('trackExpected');
        expectedEl.innerHTML = `Expected by <b>${escHtml(formatShortDate(data.due_date))}</b>`;
        expectedEl.style.display = '';
      }
    }

    const noteEl = document.getElementById('trackNote');
    if (data.note) {
      noteEl.textContent = data.note;
      noteEl.style.display = '';
    } else {
      noteEl.style.display = 'none';
    }

    const waMsg = encodeURIComponent(`Hi! Checking in about my project${data.project ? ` "${data.project}"` : ''}.`);
    document.getElementById('trackWhatsapp').href = `https://wa.me/${CONTACT_WHATSAPP}?text=${waMsg}`;
    document.getElementById('trackEmail').href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`About my project${data.project ? ` — ${data.project}` : ''}`)}`;

    document.getElementById('trackUpdated').textContent = timeAgo(data.updated_at);
    show(contentEl);
  } catch (err) {
    console.error('failed to load project status', err);
    show(notFoundEl);
  }
}

load();
