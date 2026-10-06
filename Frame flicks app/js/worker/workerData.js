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
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch (e) { /* storage full — fine */ }
  return rows;
}
