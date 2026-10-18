// roles.js — the list of crew roles (Camera, Editor, plus any the admin adds in
// Settings → Crew roles). One shared list, used by the admin app AND the worker
// app. It has no network code of its own: loadRoles(client) is given the
// Supabase client, so this file can be tested on its own.
//
// Each role has:
//   key       short code stored on workers and jobs ("camera", "drone")
//   label     the name people see ("Camera", "Drone")
//   main_date which date matters most for this kind of work:
//               'shoot'    → the shoot day  (camera, drone, photographer…)
//               'deadline' → the due date   (editor, colorist, designer…)
//
// CREW_ROLES / ROLE_LABEL / ROLE_MAIN_DATE are exported as plain objects that are
// UPDATED IN PLACE when the list changes, so every file that imported them always
// sees the current list. If the roles table can't be read (e.g. the roles SQL
// has not been run yet) the app keeps working with Camera and Editor.

export const BUILTIN_ROLES = [
  { key: 'camera', label: 'Camera', main_date: 'shoot', builtin: true, sort_order: 10 },
  { key: 'editor', label: 'Editor', main_date: 'deadline', builtin: true, sort_order: 20 },
];

const CACHE_KEY = 'ff_crew_roles';

export const CREW_ROLES = [];        // ['camera','editor',...] in display order
export const ROLE_LABEL = {};        // { camera: 'Camera', ... }
export const ROLE_MAIN_DATE = {};    // { camera: 'shoot', editor: 'deadline', ... }
let list = [];

export function setRoles(rows) {
  const ok = (Array.isArray(rows) ? rows : []).filter((r) => r && r.key && r.label);
  const merged = [...ok];
  for (const b of BUILTIN_ROLES) if (!merged.some((r) => r.key === b.key)) merged.push(b);   // never lose the two built-ins
  merged.sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || String(a.label).localeCompare(String(b.label)));
  list = merged.map((r) => ({
    key: r.key, label: r.label, main_date: r.main_date === 'deadline' ? 'deadline' : 'shoot',
    builtin: !!r.builtin, sort_order: r.sort_order ?? 100,
  }));
  CREW_ROLES.length = 0;
  Object.keys(ROLE_LABEL).forEach((k) => delete ROLE_LABEL[k]);
  Object.keys(ROLE_MAIN_DATE).forEach((k) => delete ROLE_MAIN_DATE[k]);
  for (const r of list) { CREW_ROLES.push(r.key); ROLE_LABEL[r.key] = r.label; ROLE_MAIN_DATE[r.key] = r.main_date; }
}

export const getRoles = () => list.slice();
export const roleLabel = (key) => ROLE_LABEL[key] || (key ? String(key) : '');
// 'shoot' or 'deadline'. A role we don't know about counts as a shoot-day role.
export const roleMainDate = (key) => ROLE_MAIN_DATE[key] || 'shoot';

// A worker's roles as a list (older profile rows only have the single job_role).
export function workerRoles(profile) {
  if (!profile) return [];
  const many = Array.isArray(profile.job_roles) ? profile.job_roles.filter(Boolean) : [];
  if (many.length) return many;
  return profile.job_role ? [profile.job_role] : [];
}
// "Camera, Editor" (or '' when none)
export const rolesText = (profile) => workerRoles(profile).map(roleLabel).join(', ');

// "Drone" -> "drone", "Wedding Planner" -> "wedding-planner". Used for the role code.
export function slugRole(label) {
  const s = String(label || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return s.replace(/-+$/g, '');
}

// Reads the list from the database. Never throws: on any problem the list that is
// already loaded (or the saved copy, or Camera + Editor) stays in use.
export async function loadRoles(client) {
  try {
    const { data, error } = await client.from('crew_roles').select('key, label, main_date, builtin, sort_order');
    if (error) throw error;
    setRoles(data || []);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data || [])); } catch (e) { /* private mode */ }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}

// start with the saved copy from last time (so an offline worker still sees "Drone")
(function init() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { saved = null; }
  setRoles(saved || []);
})();
