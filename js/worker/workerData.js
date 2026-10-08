// worker/workerData.js — fetches the signed-in worker's own jobs.
// The database (Row Level Security) only ever returns THIS worker's rows;
// the .eq('worker_id') below is a second, belt-and-braces filter.
// The last result is kept on the device (under ve_ct_, so it is wiped on
// logout or when a different person signs in) so the app opens instantly
// and still shows jobs when offline.

import { supabase, getSession } from '../cloud.js';

const CACHE_KEY = 've_ct_my_tasks';

export function cachedTasks() {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return Array.isArray(v) ? v : null;
  } catch (e) { return null; }
}

export function saveCachedTasks(rows) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch (e) { /* storage full — fine */ }
}

export async function fetchMyTasks() {
  const session = await getSession();
  if (!session) throw new Error('You are signed out. Please log in again.');
  const { data, error } = await supabase
    .from('worker_tasks')
    .select('*')
    .eq('worker_id', session.user.id);
  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205';
    throw new Error(missing
      ? 'Jobs are not set up yet. Ask the admin to finish the setup.'
      : /failed to fetch|network|load failed/i.test(error.message || '') ? 'No connection.' : (error.message || 'Could not load your jobs.'));
  }
  const rows = data || [];
  saveCachedTasks(rows);
  return rows;
}

// Turns a database/network error into a short sentence for the worker.
export function statusErrorMessage(error) {
  const msg = String((error && error.message) || '');
  if (/failed to fetch|network|load failed/i.test(msg)) return 'You need internet to change status.';
  if (/closed/i.test(msg)) return 'This job is closed. Ask the admin if it needs to be re-opened.';
  if (/not found/i.test(msg)) return 'This job is no longer on your list.';
  if (error && (error.code === '42501' || /cannot change jobs/i.test(msg))) return 'Your account cannot change jobs right now.';
  if (/not signed in/i.test(msg)) return 'You are signed out. Please log in again.';
  return 'Could not change the status. Please try again.';
}

// The ONLY write a worker can make: change the status of their own job.
// The database function checks the caller, the owner, and the status itself.
// Resolves to { id, status, done_at, updated_at }; throws an Error whose
// message is safe to show.
export async function setTaskStatus(taskId, status) {
  let res;
  try {
    res = await supabase.rpc('worker_set_status', { task_id: taskId, new_status: status });
  } catch (e) {
    const err = new Error(statusErrorMessage(e)); err.code = 'network'; throw err;
  }
  if (res.error) {
    const err = new Error(statusErrorMessage(res.error));
    err.code = res.error.code || 'error';
    throw err;
  }
  return res.data;
}
