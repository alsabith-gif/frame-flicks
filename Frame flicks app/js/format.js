// format.js — shared formatting helpers used by prospects + followups.

export function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export function daysBetween(dateStr, fromStr) {
  const from = fromStr ? new Date(fromStr) : new Date();
  const to = new Date(dateStr);
  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

export const STATUS_CLASS = {
  'Not Sent': 'badge-muted',
  'Sent': 'badge-blue',
  'Replied': 'badge-purple',
  'Interested': 'badge-amber',
  'Closed': 'badge-green',
  'Not Interested': 'badge-red',
  'No Reply': 'badge-muted',
};

export const PRIORITY_CLASS = {
  'Hot': 'badge-red',
  'High': 'badge-amber',
  'Medium': 'badge-blue',
  'Low': 'badge-muted',
};

export const PLATFORMS = ['Email', 'Instagram', 'YouTube', 'LinkedIn', 'TikTok', 'Facebook'];
export const STATUSES = ['Not Sent', 'Sent', 'Replied', 'Interested', 'Closed', 'Not Interested', 'No Reply'];
export const PRIORITIES = ['Hot', 'High', 'Medium', 'Low'];

export function followupBadge(dateStr) {
  if (!dateStr) return { text: '—', cls: 'badge-muted' };
  const diff = daysBetween(dateStr);
  if (diff < 0) return { text: `Overdue (${Math.abs(diff)}d)`, cls: 'badge-red' };
  if (diff === 0) return { text: 'Today!', cls: 'badge-red' };
  if (diff <= 3) return { text: `In ${diff}d`, cls: 'badge-amber' };
  return { text: formatDate(dateStr), cls: 'badge-amber' };
}

export function currency(n) {
  const num = Number(n) || 0;
  return '₹' + num.toLocaleString('en-IN');
}

export const PROJECT_STAGES = ['Received', 'Rough Cut', 'Color & Sound', 'Review', 'Delivered'];
export const STAGE_CLASS = {
  'Received': 'badge-muted',
  'Rough Cut': 'badge-blue',
  'Color & Sound': 'badge-purple',
  'Motion & VFX': 'badge-pink',
  'AI Elements': 'badge-amber',
  'Review': 'badge-amber',
  'Delivered': 'badge-green',
};

// Per-project services you can tick when adding/editing a project. Grouped
// so the stage tracker doesn't end up with a separate step per service —
// Color Grading + Sound Design share one "Color & Sound" step, and Motion
// Graphics + Visual Effects share one "Motion & VFX" step. AI Elements gets
// its own step. A stage only appears (here and on the client's link) if at
// least one service in its group is ticked.
export const SERVICE_OPTIONS = [
  { key: 'colorGrading', label: 'Color Grading', group: 'Color & Sound' },
  { key: 'soundDesign', label: 'Sound Design', group: 'Color & Sound' },
  { key: 'motionGraphics', label: 'Motion Graphics', group: 'Motion & VFX' },
  { key: 'visualEffects', label: 'Visual Effects', group: 'Motion & VFX' },
  { key: 'aiElements', label: 'AI Elements', group: 'AI Elements' },
];
const OPTIONAL_STAGE_GROUPS = ['Color & Sound', 'Motion & VFX', 'AI Elements'];

// A single service entry can be either the legacy plain boolean (from
// before the ticked/completed split existed) or the new { ticked, completed }
// shape. These two helpers understand both so old saved projects keep
// working without a migration step.
export function isServiceTicked(services, key) {
  const v = services && services[key];
  if (v === true) return true; // legacy boolean shape
  if (v && typeof v === 'object') return !!v.ticked;
  return false;
}
export function isServiceCompleted(services, key) {
  const v = services && services[key];
  if (v && typeof v === 'object') return !!v.completed;
  return false; // legacy boolean shape never carried a completed flag
}

// Builds the actual stage list for one project based on which services were
// ticked. Received/Rough Cut/Review/Delivered always exist; the optional
// middle stages only show up if a service in that group was ticked.
// (Unchanged behavior — just reads through isServiceTicked now so it still
// works whether `services` uses the old boolean shape or the new object shape.)
export function getProjectStages(services) {
  const stages = ['Received', 'Rough Cut'];
  OPTIONAL_STAGE_GROUPS.forEach((group) => {
    const on = SERVICE_OPTIONS.some((s) => s.group === group && isServiceTicked(services, s.key));
    if (on) stages.push(group);
  });
  stages.push('Review', 'Delivered');
  return stages;
}

// Client-facing services checklist (separate from the pipeline above).
// Fixed grouping, max 3 items, item only appears if something in its group
// is ticked, label collapses to the single service name when only one of
// the group is ticked, and "complete" requires every ticked service in the
// group to be completed.
export function getServiceChecklist(services) {
  return OPTIONAL_STAGE_GROUPS.map((group) => {
    const members = SERVICE_OPTIONS.filter((s) => s.group === group && isServiceTicked(services, s.key));
    if (!members.length) return null;
    const label = members.length === 1 ? members[0].label : group;
    const complete = members.every((s) => isServiceCompleted(services, s.key));
    return { group, label, complete };
  }).filter(Boolean);
}

/* ---------------- Project priority (Urgent/High/Normal/Low) ---------------- */
export const PROJECT_PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'];
export const PROJECT_PRIORITY_CLASS = {
  Urgent: 'badge-red',
  High: 'badge-orange',
  Normal: 'badge-blue',
  Low: 'badge-muted',
};
const PROJECT_PRIORITY_RANK = { Urgent: 0, High: 1, Normal: 2, Low: 3 };
export function priorityRank(p) {
  return PROJECT_PRIORITY_RANK[p] ?? 2;
}

/* ---------------- Client source (outreach platforms + direct-add ones) ---------------- */
export const CLIENT_SOURCES = [...PLATFORMS, 'Referral', 'Word of Mouth', 'Fiverr', 'Other'];

/* ---------------- Content type (managed on its own page, Client mode) ---------------- */
export const DEFAULT_CONTENT_TYPES = [
  'Instagram Reel', 'Instagram Post', 'YouTube Long-form', 'YouTube Shorts', 'TikTok', 'Podcast Edit', 'Other',
];

/* ---------------- Live due-date countdown (days/hours/minutes) ---------------- */
// Deadlines are stored as a plain date (no time), so "the deadline" is
// treated as the end of that calendar day (23:59:59) for countdown purposes.
export function getCountdown(dueDateStr) {
  if (!dueDateStr) return { text: '—', cls: 'badge-muted' };
  const due = new Date(dueDateStr + 'T23:59:59');
  const diffMs = due.getTime() - Date.now();

  if (diffMs <= 0) return { text: 'Overdue', cls: 'badge-red' };

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  let cls = 'badge-green';
  if (diffMs < 24 * 60 * 60 * 1000) cls = 'badge-red';
  else if (days < 3) cls = 'badge-orange';
  else if (days < 7) cls = 'badge-amber';

  let text;
  if (days > 0) text = `${days}d ${hours}h ${minutes}m`;
  else if (hours > 0) text = `${hours}h ${minutes}m`;
  else text = `${minutes}m`;

  return { text, cls };
}
