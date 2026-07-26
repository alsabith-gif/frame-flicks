// cloud.js — everything related to talking to Supabase: login/logout and
// syncing localStorage <-> the `app_data` table. storage.js stays the single
// source of truth for reads/writes during normal app use (fast, synchronous,
// unchanged); this module just keeps it in sync with the cloud so the same
// data shows up on every device.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Keys we sync — must match KEYS in storage.js.
const SYNCED_KEYS = [
  've_ct_prospects',
  've_ct_groups',
  've_ct_goal_settings',
  've_ct_goal_history',
  've_ct_income',
  've_ct_scripts',
  've_ct_fu_settings',
  've_ct_fu_history',
  've_ct_app_mode',
  've_ct_clients',
  've_ct_content_types',
  've_ct_meetings',
];

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function logout() {
  await supabase.auth.signOut();
}

// Pull every row from the cloud into localStorage. Cloud is treated as the
// source of truth. Bounded by a timeout so a slow/flaky connection can't
// hang app open forever — callers can await this on a truly empty device
// (no cached data yet) or fire-and-forget it in the background otherwise.
// Resolves to `true` only if it actually wrote data that differs from what
// was already cached locally, so callers know whether a re-render is needed.
const PULL_TIMEOUT_MS = 8000;

export async function pullAllFromCloud() {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), PULL_TIMEOUT_MS));
  const fetchRows = supabase.from('app_data').select('key, value')
    .then(({ data, error }) => {
      if (error) throw error;
      return data;
    })
    .catch((err) => {
      console.error('cloud pull failed', err);
      return null;
    });

  const data = await Promise.race([fetchRows, timeout]);
  if (!data) return false;

  let changed = false;
  data.forEach((row) => {
    if (!SYNCED_KEYS.includes(row.key)) return;
    const incoming = JSON.stringify(row.value);
    if (localStorage.getItem(row.key) !== incoming) {
      localStorage.setItem(row.key, incoming);
      changed = true;
    }
  });
  return changed;
}

// ---------------- Client progress tracker (public "track" links) ----------
// Lives in its own `project_status` table (NOT `app_data`) because this one
// needs to be readable by an unauthenticated client who just has the link —
// see track.js / SETUP.md for the Supabase table + RLS policy this needs.

export async function pushProjectStatus(trackCode, payload) {
  if (!trackCode) return;
  try {
    const { error } = await supabase
      .from('project_status')
      .upsert({ track_code: trackCode, ...payload, updated_at: new Date().toISOString() }, { onConflict: 'track_code' });
    if (error) console.error('project status sync failed', error);
  } catch (err) {
    console.error('project status sync failed', err);
  }
}

export async function deleteProjectStatus(trackCode) {
  if (!trackCode) return;
  try {
    await supabase.from('project_status').delete().eq('track_code', trackCode);
  } catch (err) {
    console.error('project status delete failed', err);
  }
}
// Debounced push — called by storage.js every time something is saved
// locally, so rapid edits (e.g. typing) don't fire a network request per
// keystroke.
const pushTimers = {};
let syncErrorShown = false;

export function pushToCloud(key, value) {
  if (!SYNCED_KEYS.includes(key)) return;
  clearTimeout(pushTimers[key]);
  pushTimers[key] = setTimeout(async () => {
    const { error } = await supabase
      .from('app_data')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) {
      console.error('cloud sync failed', key, error);
      if (!syncErrorShown) {
        syncErrorShown = true;
        window.dispatchEvent(new CustomEvent('ct-sync-error', { detail: error }));
        setTimeout(() => { syncErrorShown = false; }, 15000);
      }
    }
  }, 500);
}
