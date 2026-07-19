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
  'Review': 'badge-amber',
  'Delivered': 'badge-green',
};
