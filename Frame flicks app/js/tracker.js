// tracker.js — powers track.html, the public, unauthenticated page a client
// opens from their progress link. Reads the ?p=<trackCode> query param,
// looks it up in the `project_status` table (safe to expose read-only via
// RLS since a trackCode is an unguessable random string, not a real ID),
// and renders an animated step tracker. No login, no access to the rest of
// the app's data.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Fallback used only for projects saved before the per-project stage
// selection existed, so old track links don't break.
const DEFAULT_STAGES = ['Received', 'Rough Cut', 'Color & Sound', 'Review', 'Delivered'];

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
// line and each reached dot in a strict sequence so the page feels alive
// on open: tick a dot, PAUSE, move the bar up to the next dot, PAUSE,
// tick that dot, and so on — the bar never moves ahead of a tick.
const TICK_HOLD_MS = 500;     // how long a tick's pop effect holds before the bar starts moving
const SEGMENT_MOVE_MS = 700;  // how long the bar takes to slide to the next dot
const START_DELAY_MS = 350;   // pause before the very first tick fires

function renderSteps(currentStage, stageHistory, stages) {
  const projectStages = Array.isArray(stages) && stages.length ? stages : DEFAULT_STAGES;
  const idx = Math.max(0, projectStages.indexOf(currentStage));
  const stepsEl = document.getElementById('trackSteps');

  stepsEl.innerHTML = projectStages.map((stage, i) => {
    const dateStr = stageHistory && stageHistory[stage] ? formatShortDate(stageHistory[stage]) : '—';
    return `
      <div class="track-step" data-i="${i}">
        <div class="track-step-dot">${i + 1}</div>
        <div class="track-step-label">${escHtml(stage)}</div>
        <div class="track-step-date">${escHtml(dateStr)}</div>
      </div>`;
  }).join('');

  const fillEl = document.getElementById('trackFill');
  fillEl.style.width = '0%';

  const dots = stepsEl.querySelectorAll('.track-step-dot');
  const segments = projectStages.length - 1;

  let t = START_DELAY_MS;

  for (let i = 0; i <= idx; i++) {
    const stepEl = stepsEl.children[i];
    const isCurrentStage = i === idx;

    // 1) tick this dot
    setTimeout(() => {
      stepEl.classList.add(isCurrentStage ? 'current' : 'done');
      if (!isCurrentStage) {
        dots[i].innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      }
    }, t);
    t += TICK_HOLD_MS;

    // 2) only after the tick has held, move the bar up to the next dot
    if (!isCurrentStage) {
      const targetPct = ((i + 1) / segments) * 100;
      setTimeout(() => { fillEl.style.width = `${targetPct}%`; }, t);
      t += SEGMENT_MOVE_MS;
    }
  }
}

function showToast(msg) {
  const el = document.getElementById('trackToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2600);
}

// mailto: links depend on the device having a default mail app configured.
// On most phones that's the Gmail app, so it opens fine — but on laptops
// with no default mail client set, the browser can't do anything with a
// mailto: link and the click appears to do nothing. Gmail's own web
// compose URL works everywhere the same way (opens Gmail in a new tab,
// pre-filled), so that's what the button links to now. Clipboard copy
// still happens silently alongside it as a bonus safety net.
function wireEmailFallback() {
  const emailBtn = document.getElementById('trackEmail');
  emailBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      showToast(`Copied ${CONTACT_EMAIL}`);
    } catch (err) {
      // clipboard API unavailable — the Gmail link still opens normally.
    }
  });
}

// Public tracking page — refresh from Supabase every 30s so the client
// always sees the latest stage without needing to reload the page
// themselves. Re-renders happen quietly: the full tick/bar animation only
// replays when the stage actually changed since the last check; otherwise
// only the "Updated Xm ago" text and note refresh, so nothing flickers.
const REFRESH_INTERVAL_MS = 30000;
let lastStage = null;
let lastNote = null;

async function load(isRefresh) {
  const params = new URLSearchParams(window.location.search);
  const trackCode = params.get('p');

  if (!trackCode) { show(notFoundEl); return; }

  try {
    const { data, error } = await supabase
      .from('project_status')
      .select('client, project, stage, stages, note, due_date, stage_history, updated_at')
      .eq('track_code', trackCode)
      .maybeSingle();

    if (error || !data) { if (!isRefresh) show(notFoundEl); return; }

    const stage = data.stage || 'Received';
    const stageChanged = isRefresh && stage !== lastStage;

    if (!isRefresh || stageChanged || data.note !== lastNote) {
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
        document.getElementById('trackDeliveredBlock').style.display = 'none';
        document.getElementById('trackProgressBlock').style.display = '';
        renderSteps(stage, data.stage_history, data.stages);
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

      if (isRefresh && stageChanged) showToast('Project updated');
    }

    const waMsg = encodeURIComponent(`Hi! Checking in about my project${data.project ? ` "${data.project}"` : ''}.`);
    document.getElementById('trackWhatsapp').href = `https://wa.me/${CONTACT_WHATSAPP}?text=${waMsg}`;
    const emailSubject = encodeURIComponent(`About my project${data.project ? ` — ${data.project}` : ''}`);
    document.getElementById('trackEmail').href = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(CONTACT_EMAIL)}&su=${emailSubject}`;

    document.getElementById('trackUpdated').textContent = timeAgo(data.updated_at);
    lastStage = stage;
    lastNote = data.note;
    show(contentEl);
  } catch (err) {
    console.error('failed to load project status', err);
    if (!isRefresh) show(notFoundEl);
  }
}

wireEmailFallback();
load(false);
setInterval(() => load(true), REFRESH_INTERVAL_MS);
