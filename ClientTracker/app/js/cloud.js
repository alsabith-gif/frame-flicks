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
  've_ct_ai_results',
  've_ct_added_ai',
  've_ct_goal_settings',
  've_ct_goal_history',
  've_ct_income',
  've_ct_scripts',
  've_ct_fu_settings',
  've_ct_fu_history',
  've_ct_app_mode',
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
// source of truth on login — call this once, before the app boots.
export async function pullAllFromCloud() {
  const { data, error } = await supabase.from('app_data').select('key, value');
  if (error) {
    console.error('cloud pull failed', error);
    return false;
  }
  (data || []).forEach((row) => {
    if (SYNCED_KEYS.includes(row.key)) {
      localStorage.setItem(row.key, JSON.stringify(row.value));
    }
  });
  return true;
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
