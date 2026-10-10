// crewForm.js — the "👷 Assign crew" section inside the Add/Edit Project form.
//
// You pick workers, their role on this project, and what each is paid. The
// pay box is pre-filled with a SUGGESTION from your Price Distributor split
// (labour share between the camera people, editing share to the editors) —
// type over it any time. Location / shoot time / notes for the crew are shared
// by everyone on the project. Nothing is written until you press Save on the
// project; then the jobs appear on each worker's phone.
//
// PAY HISTORY: once a job is marked PAID (Workers page), its pay box is locked
// here — read-only, never touched by "Reset pay to suggested" or a price change,
// and its worker cannot be swapped or removed. To change a paid amount: undo the
// payment on the Workers page, change it here, then mark it paid again. (The
// database refuses a changed amount on a paid job too, so this cannot be bypassed.)

import { escHtml, currency } from './format.js';
import { fmtDay } from './worker/workerView.js';
import {
  CREW_ROLES, CREW_ROLE_LABEL, suggestPays, validateCrew, buildTaskPayloads, diffCrew,
  loadWorkers, loadCrewForProject, saveCrewChanges,
} from './crew.js';

export function crewSectionHtml() {
  return `
    <div class="form-field full crew-section">
      <label>👷 Assign crew</label>
      <p class="field-hint crew-msg" id="crewMsg">Loading your workers…</p>
      <div id="crewRows"></div>
      <div class="crew-actions" id="crewActions" style="display:none;">
        <button type="button" class="btn btn-ghost btn-sm" id="crewAddBtn">+ Add crew member</button>
        <button type="button" class="btn btn-ghost btn-sm" id="crewSuggestBtn" title="Fill every pay box from your Price Distributor split">↺ Reset pay to suggested</button>
      </div>
      <div class="crew-shared" id="crewShared" style="display:none;">
        <div class="form-field"><label>Location (crew sees this)</label><input type="text" id="crewLocation" maxlength="200" placeholder="e.g. Hilite Mall, Calicut"></div>
        <div class="form-field"><label>Shoot time</label><input type="time" id="crewTime"></div>
        <div class="form-field full"><label>Notes for the crew</label><textarea id="crewNotes" placeholder="What to bring, who to meet, dress code… (your private Notes below are never shared)"></textarea></div>
        <p class="field-hint">Each worker sees: project name, client's <b>name</b>, location, shoot date &amp; time, deadline, these notes, their role and <b>their own</b> pay. They never see the client's phone, the project price, or other workers' pay. The shoot date and due date come from this project's dates.</p>
      </div>
    </div>`;
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

// body: the modal's root element. projectId: null for a new project.
export function initCrewSection(body, { projectId, distribution, getAmount, getReferral }) {
  const $ = (sel) => body.querySelector(sel);
  const st = { workers: [], rows: [], existing: [], loaded: false };

  const worker = (id) => st.workers.find((w) => w.user_id === id);
  const nameOf = (id) => (worker(id) && worker(id).name) || 'This worker';

  function setMsg(text, kind) {
    const el = $('#crewMsg');
    el.textContent = text || '';
    el.className = 'field-hint crew-msg' + (kind ? ` is-${kind}` : '');
    el.style.display = text ? '' : 'none';
  }

  function recalcSuggestions() {
    const sug = suggestPays({
      amount: getAmount(), distribution, referral: getReferral(), roles: st.rows.map((r) => r.role),
    });
    st.rows.forEach((r, i) => {
      if (r.locked) { r.suggested = 0; return; }      // a paid amount is never recalculated
      r.suggested = sug[i];
      if (!r.payTouched) r.pay = sug[i] ? String(sug[i]) : '';
    });
  }

  function workerOptions(row) {
    const active = st.workers.filter((w) => w.active || w.user_id === row.worker_id);
    return `<option value="">Choose worker…</option>` + active.map((w) => `
      <option value="${escHtml(w.user_id)}" ${w.user_id === row.worker_id ? 'selected' : ''}>${escHtml(w.name || w.email || 'Unnamed')}${w.active ? '' : ' (deactivated)'}</option>`).join('');
  }

  function render() {
    const rowsEl = $('#crewRows');
    rowsEl.innerHTML = st.rows.map((r, i) => `
      <div class="crew-row${r.locked ? ' is-locked' : ''}" data-i="${i}">
        <select class="crew-worker" aria-label="Worker"${r.locked ? ' disabled' : ''}>${workerOptions(r)}</select>
        <select class="crew-role" aria-label="Role">${CREW_ROLES.map((x) => `<option value="${x}" ${r.role === x ? 'selected' : ''}>${CREW_ROLE_LABEL[x]}</option>`).join('')}</select>
        <div class="crew-pay-wrap">
          <input type="number" class="crew-pay" min="0" step="1" inputmode="decimal" placeholder="Pay ₹" aria-label="Pay in rupees" value="${escHtml(r.pay)}"${r.locked ? ' readonly' : ''}>
          <span class="crew-sug">${r.locked ? '🔒 Paid — locked' : (r.suggested ? `Suggested ${escHtml(currency(r.suggested))}` : '')}</span>
        </div>
        <button type="button" class="btn btn-icon btn-sm crew-remove" title="${r.locked ? 'Paid — undo the payment first' : 'Remove from this project'}" aria-label="Remove"${r.locked ? ' disabled' : ''}>✕</button>
      </div>
      ${r.locked ? `<p class="field-hint crew-lock-note">🔒 ${escHtml(nameOf(r.worker_id))} has been paid${r.paidOn ? ` on ${escHtml(fmtDay(r.paidOn))}` : ''}, so this pay amount can't be changed here. To change it: open <b>Workers</b> → find this job → <b>Undo paid</b> → change it here → mark it paid again.</p>` : ''}`).join('');
    $('#crewShared').style.display = st.rows.length ? '' : 'none';
    $('#crewActions').style.display = st.loaded ? '' : 'none';
    $('#crewSuggestBtn').style.display = st.rows.length ? '' : 'none';
  }

  function addRow() {
    st.rows.push({ worker_id: '', role: 'camera', pay: '', payTouched: false, roleTouched: false, suggested: 0 });
    recalcSuggestions();
    render();
  }

  rowsOnce();
  function rowsOnce() {
    // one delegated listener for every row
    $('#crewRows').addEventListener('change', (e) => {
      const rowEl = e.target.closest('.crew-row'); if (!rowEl) return;
      const r = st.rows[+rowEl.dataset.i];
      if (e.target.classList.contains('crew-worker')) {
        r.worker_id = e.target.value;
        const w = worker(r.worker_id);
        if (w && !r.roleTouched && CREW_ROLES.includes(w.job_role)) r.role = w.job_role;   // default to their usual role
        recalcSuggestions(); render();
      } else if (e.target.classList.contains('crew-role')) {
        r.role = e.target.value; r.roleTouched = true;
        recalcSuggestions(); render();
      }
    });
    $('#crewRows').addEventListener('input', (e) => {
      if (!e.target.classList.contains('crew-pay')) return;
      const r = st.rows[+e.target.closest('.crew-row').dataset.i];
      if (r.locked) return;                              // paid: never editable
      r.pay = e.target.value; r.payTouched = true;      // typed over the suggestion: keep it
    });
    $('#crewRows').addEventListener('click', (e) => {
      const b = e.target.closest('.crew-remove'); if (!b) return;
      if (st.rows[+b.closest('.crew-row').dataset.i].locked) return;    // paid: cannot be removed
      st.rows.splice(+b.closest('.crew-row').dataset.i, 1);
      recalcSuggestions(); render();
    });
    $('#crewAddBtn').addEventListener('click', addRow);
    $('#crewSuggestBtn').addEventListener('click', () => {
      st.rows.forEach((r) => { if (!r.locked) r.payTouched = false; });
      recalcSuggestions(); render();
    });
  }

  function readShared() {
    return { location: $('#crewLocation').value, time: $('#crewTime').value, notes: $('#crewNotes').value };
  }

  async function init() {
    try {
      const [workers, tasks] = await Promise.all([loadWorkers(), projectId ? loadCrewForProject(projectId) : Promise.resolve([])]);
      st.workers = workers;
      st.existing = tasks;
      st.rows = tasks.map((t) => ({
        worker_id: t.worker_id, role: t.role, pay: String(Number(t.pay_amount) || 0),
        payTouched: true, roleTouched: true, suggested: 0,
        locked: t.pay_status === 'paid', paidOn: t.paid_on || null,
      }));
      if (tasks[0]) {
        $('#crewLocation').value = tasks[0].location || '';
        $('#crewTime').value = hhmm(tasks[0].shoot_time);
        $('#crewNotes').value = tasks[0].notes || '';
      }
      st.loaded = true;
      recalcSuggestions();
      setMsg(workers.length ? '' : 'No workers yet — add them on the Workers page first, then come back.', workers.length ? '' : 'info');
    } catch (err) {
      st.loaded = false;     // never touch the crew if we could not read it
      setMsg(`Crew can't be changed right now: ${err.message} Your project will still save normally.`, 'error');
    }
    render();
  }

  // ---- what the project form calls ----
  return {
    init,
    recalc() { if (st.loaded) { recalcSuggestions(); render(); } },
    isLoaded: () => st.loaded,
    count: () => st.rows.length,
    existingCount: () => st.existing.length,
    showError(text) { setMsg(text, 'error'); },
    validate() {
      if (!st.loaded) return null;
      return validateCrew(st.rows, nameOf);
    },
    needsSync: () => st.loaded && (st.rows.length > 0 || st.existing.length > 0),
    // Writes only what changed. `project` is the saved project record.
    async sync(project) {
      const desired = buildTaskPayloads({
        project: { id: project.id, project: project.project, client: project.client, shootDate: project.shootDate, dueDate: project.dueDate },
        shared: readShared(),
        rows: st.rows,
      });
      const plan = diffCrew(st.existing, desired);
      await saveCrewChanges(project.id, plan);
      st.existing = await loadCrewForProject(project.id);   // fresh copy, so a second Save diffs correctly
      return { changed: plan.toUpsert.length + plan.toDelete.length > 0, added: plan.toUpsert.length, removed: plan.toDelete.length };
    },
  };
}
