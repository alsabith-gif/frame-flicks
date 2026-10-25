// crew.js — admin side of "Assign crew": who works on a project, in which
// role, and what each person is paid. The pure functions at the top have no
// DOM or network, so they can be tested on their own. The database helpers
// at the bottom read/write the `worker_tasks` table (admin-only to write).
//
// What a worker can see about a job is exactly the columns buildTaskPayloads()
// produces: project name, client NAME, location, shoot date/time, deadline,
// notes for the crew, their role, and their own pay. Never the client's
// phone, the project price, or anyone else's pay.

import { supabase } from './cloud.js';
import { splitPrice } from './pricing.js';
import { CREW_ROLES, ROLE_LABEL, roleMainDate, loadRoles } from './roles.js';

// The role list lives in roles.js (Camera, Editor + anything added in Settings).
export { CREW_ROLES };
export const CREW_ROLE_LABEL = ROLE_LABEL;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clean = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

// ---------------------------------------------------------------------------
// Suggested pay, from the editable price split (Price Distributor):
//   labour share   -> shared equally between the people whose role works to the
//                     SHOOT day (Camera, Drone, ...)
//   editing share  -> shared equally between the people whose role works to the
//                     DEADLINE (Editor, Colorist, ...)
// `roles` is the list of roles on this project, e.g. ['camera','camera','editor'].
// Returns one suggested amount per entry, in the same order. It is only a
// suggestion — the admin can type any amount.
export function suggestPays({ amount, distribution, referral = false, roles }) {
  const total = Math.max(0, num(amount));
  if (!total || !roles.length) return roles.map(() => 0);
  const isShoot = (r) => roleMainDate(r) === 'shoot';
  const cameras = roles.filter(isShoot).length;
  const editors = roles.length - cameras;
  const split = splitPrice(total, distribution, { referral, crew: cameras || 1 });
  const share = (key) => (split.rows.find((r) => r.key === key) || {}).amount || 0;
  const labour = share('labour');
  const editing = share('editing');
  return roles.map((r) => {
    return isShoot(r) ? Math.round(labour / cameras) : Math.round(editing / editors);
  });
}

// One person can do several roles on a project (e.g. Camera AND Editor), but not the
// SAME role twice. A job is therefore identified by worker + role.
const jobKey = (x) => `${x.worker_id}|${x.role}`;

// rows: [{ worker_id, role, pay }]. Returns an error message, or null if fine.
export function validateCrew(rows, nameOf = () => 'This worker') {
  const seen = new Set();
  for (const r of rows) {
    if (!r.worker_id) return 'Pick a worker for every crew row, or remove the empty row.';
    if (!CREW_ROLES.includes(r.role)) return 'Pick a role for every crew row.';
    const pay = r.pay === '' || r.pay === null || r.pay === undefined ? 0 : Number(r.pay);
    if (!Number.isFinite(pay) || pay < 0) return `Enter a valid pay amount for ${nameOf(r.worker_id)}.`;
    if (seen.has(jobKey(r))) return `${nameOf(r.worker_id)} is listed twice with the same role. To give them two roles, pick a different role for the second row.`;
    seen.add(jobKey(r));
  }
  return null;
}

// The exact rows to write to worker_tasks. Every row has the same keys.
// NOTE: status / pay_status / paid_on are deliberately NOT here, so editing a
// job never resets a worker's progress or un-marks a payment.
export function buildTaskPayloads({ project, shared, rows }) {
  return rows.map((r) => ({
    project_id: project.id,
    worker_id: r.worker_id,
    role: r.role,
    title: clean(project.project) || 'Untitled project',
    client_name: clean(project.client),
    location: clean(shared.location),
    shoot_date: clean(project.shootDate),
    shoot_time: clean(shared.time),
    due_date: clean(project.dueDate),
    notes: clean(shared.notes),
    pay_amount: Math.round(num(r.pay) * 100) / 100,
  }));
}

const COMPARE = ['role', 'title', 'client_name', 'location', 'shoot_date', 'due_date', 'notes'];
function sameTask(a, b) {
  if (COMPARE.some((k) => clean(a[k]) !== clean(b[k]))) return false;
  if (hhmm(a.shoot_time) !== hhmm(b.shoot_time)) return false;
  return Math.round(num(a.pay_amount) * 100) === Math.round(num(b.pay_amount) * 100);
}

// Works out the smallest set of changes: rows to write, and jobs removed
// (toDelete = [{ worker_id, role }]). Unchanged rows are left alone, so a worker
// is only ever told about a real change.
export function diffCrew(existing, desired) {
  const byJob = new Map(existing.map((e) => [jobKey(e), e]));
  const toUpsert = desired.filter((d) => {
    const e = byJob.get(jobKey(d));
    return !e || !sameTask(e, d);
  });
  const keep = new Set(desired.map(jobKey));
  const toDelete = existing.filter((e) => !keep.has(jobKey(e))).map((e) => ({ worker_id: e.worker_id, role: e.role }));
  return { toUpsert, toDelete };
}

// ---------------------------------------------------------------------------
// Database helpers (admin only — the database refuses anyone else)

function friendly(error) {
  const code = error && error.code;
  const msg = (error && error.message) || 'Something went wrong.';
  if (code === '42P01' || code === 'PGRST205') {
    return new Error('The worker jobs table is missing — run PART 3 of supabase/worker-setup.sql (SETUP.md, Phase 3).');
  }
  if (/failed to fetch|network|load failed/i.test(msg)) {
    return new Error('No connection to the server. Check your internet and try again.');
  }
  return new Error(msg);
}

export async function loadWorkers() {
  await loadRoles(supabase);       // the role list (Camera, Editor + your own); keeps the old list if it can't be read
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'worker')
    .order('name', { ascending: true });
  if (error) throw friendly(error);
  return data || [];
}

// Every crew job of every project (admin only) — for the money pages.
export async function loadAllCrewTasks() {
  const { data, error } = await supabase.from('worker_tasks').select('project_id, worker_id, role, pay_amount, pay_status, paid_on, status');
  if (error) throw friendly(error);
  return data || [];
}

export async function loadCrewForProject(projectId) {
  const { data, error } = await supabase.from('worker_tasks').select('*').eq('project_id', projectId);
  if (error) throw friendly(error);
  return data || [];
}

// The crew jobs of a project that the admin has already marked PAID. Used to warn
// before a project (and so its pay records) is deleted.
export async function paidJobsForProject(projectId) {
  const rows = await loadCrewForProject(projectId);
  return rows.filter((r) => r.pay_status === 'paid');
}

export async function saveCrewChanges(projectId, { toUpsert, toDelete }) {
  if (toUpsert.length) {
    const { error } = await supabase.from('worker_tasks').upsert(toUpsert, { onConflict: 'project_id,worker_id,role' });
    if (error) {
      // The database still has the old "one job per worker per project" rule: PART 10 has not been run yet.
      if (/duplicate key|unique/i.test(error.message || '') && /worker_id/i.test(error.message || '')) {
        throw new Error('The database still allows only one role per worker on a project. Run PART 10 of supabase/worker-setup.sql (SETUP.md → Upgrade 2), then try again.');
      }
      throw friendly(error);
    }
  }
  for (const d of toDelete) {
    const { error } = await supabase.from('worker_tasks').delete().eq('project_id', projectId).eq('worker_id', d.worker_id).eq('role', d.role);
    if (error) throw friendly(error);
  }
}

// The four project facts every crew job copies (name, client name, shoot date,
// deadline). Called when something OTHER than the project form changes them
// (e.g. the Invoice Maker), so workers never keep seeing an old date or name.
// Leaves status, pay and paid-marks alone. Does nothing if the project has no crew.
export function crewFieldsOf(project) {
  return {
    title: clean(project.project) || 'Untitled project',
    client_name: clean(project.client),
    shoot_date: clean(project.shootDate),
    due_date: clean(project.dueDate),
  };
}
export async function refreshCrewFields(project) {
  const { error } = await supabase.from('worker_tasks').update(crewFieldsOf(project)).eq('project_id', project.id);
  if (error) throw friendly(error);
}

// Called when a project is deleted: removes every worker's job for it.
export async function deleteCrewForProject(projectId) {
  const { error } = await supabase.from('worker_tasks').delete().eq('project_id', projectId);
  if (error) throw friendly(error);
}
