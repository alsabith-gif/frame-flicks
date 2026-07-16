// pages/goals.js — daily/weekly targets, today's progress checklist, history log.

import { getGoalSettings, saveGoalSettings, getGoalHistory, saveGoalHistory } from '../storage.js';
import { showToast } from '../toast.js';
import { todayStr, formatDate } from '../format.js';

const GOAL_DEFS = [
  { key: 'dms', label: 'New DMs' },
  { key: 'followups', label: 'Follow-ups' },
  { key: 'samples', label: 'Sample Edits' },
  { key: 'clients', label: 'New Clients (this week)' },
];

function loadSettingsIntoForm() {
  const s = getGoalSettings();
  document.getElementById('goalDms').value = s.dms;
  document.getElementById('goalFollowups').value = s.followups;
  document.getElementById('goalSamples').value = s.samples;
  document.getElementById('goalClients').value = s.clients;
}

function todaysProgress() {
  const history = getGoalHistory();
  const today = todayStr();
  if (!history[today]) {
    history[today] = { dms: 0, followups: 0, samples: 0, clients: 0 };
    saveGoalHistory(history);
  }
  return history;
}

function renderTodayLabel() {
  document.getElementById('todayDateLabel').textContent = formatDate(todayStr());
}

function renderChecklist() {
  const settings = getGoalSettings();
  const history = todaysProgress();
  const today = todayStr();
  const progress = history[today];

  const wrap = document.getElementById('todayChecklist');
  wrap.innerHTML = GOAL_DEFS.map((g) => {
    const target = Number(settings[g.key]) || 0;
    const val = Number(progress[g.key]) || 0;
    const pct = target ? Math.min(100, Math.round((val / target) * 100)) : 0;
    return `
      <div class="goal-row">
        <span class="gr-label">${g.label}</span>
        <span class="gr-track"><span class="gr-fill" style="width:${pct}%;"></span></span>
        <div class="goal-stepper">
          <button data-action="dec" data-key="${g.key}">−</button>
          <span class="gs-count">${val} / ${target}</span>
          <button data-action="inc" data-key="${g.key}">+</button>
        </div>
      </div>
    `;
  }).join('');

  wrap.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const h = getGoalHistory();
      const t = todayStr();
      if (!h[t]) h[t] = { dms: 0, followups: 0, samples: 0, clients: 0 };
      const key = btn.dataset.key;
      const delta = btn.dataset.action === 'inc' ? 1 : -1;
      h[t][key] = Math.max(0, (Number(h[t][key]) || 0) + delta);
      saveGoalHistory(h);
      renderChecklist();
    });
  });
}

function renderHistory() {
  const history = getGoalHistory();
  const settings = getGoalSettings();
  const dates = Object.keys(history).sort().reverse().slice(0, 14);
  const wrap = document.getElementById('goalHistoryList');

  if (!dates.length) {
    wrap.innerHTML = '<p class="muted">No history yet — today will show up here once you log progress.</p>';
    return;
  }

  wrap.innerHTML = dates.map((d) => {
    const p = history[d];
    const totalTarget = GOAL_DEFS.reduce((s, g) => s + (Number(settings[g.key]) || 0), 0);
    const totalDone = GOAL_DEFS.reduce((s, g) => s + (Number(p[g.key]) || 0), 0);
    const pct = totalTarget ? Math.round((totalDone / totalTarget) * 100) : 0;
    return `
      <div class="history-row">
        <span>${formatDate(d)}</span>
        <span class="muted">DMs ${p.dms || 0} · Follow-ups ${p.followups || 0} · Samples ${p.samples || 0} · Clients ${p.clients || 0}</span>
        <span><b>${pct}%</b></span>
      </div>
    `;
  }).join('');
}

function renderAll() {
  renderTodayLabel();
  renderChecklist();
  renderHistory();
}

export function init() {
  loadSettingsIntoForm();
  renderAll();

  document.getElementById('saveGoalsBtn').addEventListener('click', () => {
    const settings = {
      dms: Number(document.getElementById('goalDms').value) || 0,
      followups: Number(document.getElementById('goalFollowups').value) || 0,
      samples: Number(document.getElementById('goalSamples').value) || 0,
      clients: Number(document.getElementById('goalClients').value) || 0,
    };
    saveGoalSettings(settings);
    showToast('Targets saved');
    renderAll();
  });
}
