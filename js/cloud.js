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
  've_ct_pricing',
  've_ct_invoices',
  've_ct_notif_prefs',
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

// ---------------- Who is signed in (admin vs worker) ------------------------
// The database (Row Level Security) is what actually protects data. This role
// is only used by the app to decide which screen to show and to make sure a
// worker's device never even tries to touch the admin's tables.
let currentRole = null;
export function setRole(role) { currentRole = role; }
export function getRole() { return currentRole; }
export const isAdminRole = () => currentRole === 'admin';

// Returns the signed-in user's profiles row, or null if they have none.
// Throws on a network/database error so callers can tell "no profile" apart
// from "couldn't check".
export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------- Email code login (workers' first login / forgot password) --
// Supabase emails a 6-digit code (see SETUP.md for the email template).
// shouldCreateUser:false means this can NEVER create an account — only people
// the admin has already added can get a code.
function friendlyAuthError(err) {
  const msg = (err && err.message) || '';
  if (/banned/i.test(msg)) return 'This account has been deactivated. Contact the admin.';
  if (/expired|invalid/i.test(msg)) return 'That code is wrong or has expired. Request a new one.';
  if (/rate|seconds|too many/i.test(msg)) return 'Too many tries. Please wait a minute and try again.';
  return msg || 'Something went wrong. Please try again.';
}

// Always resolves the same way whether or not the email has an account, so
// nobody can use this box to find out who works with you.
export async function requestLoginCode(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: false },
  });
  if (!error) return { sent: true };
  const msg = error.message || '';
  if (error.status === 422 || /signups? not allowed|otp_disabled|not found/i.test(msg)) return { sent: true };
  if (error.status === 429 || /seconds|rate limit/i.test(msg)) {
    const m = msg.match(/(\d+)\s*second/i);
    const err = new Error(m ? `Please wait ${m[1]} seconds before asking for another code.` : 'Please wait a minute before asking for another code.');
    err.code = 'rate_limited';
    throw err;
  }
  throw new Error(friendlyAuthError(error));
}

export async function verifyLoginCode(email, code) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: String(code).replace(/\s+/g, ''),
    type: 'email',
  });
  if (error) throw new Error(friendlyAuthError(error));
  return data;
}

// Used right after a code login. Also marks the account as "has a password"
// so the app knows the worker is fully set up.
export async function setNewPassword(password) {
  const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } });
  if (error) {
    if (/different|same/i.test(error.message || '')) throw new Error('Choose a password you have not used before.');
    if (/weak|short|characters/i.test(error.message || '')) throw new Error('That password is too weak. Use at least 8 characters.');
    throw new Error(error.message || 'Could not save the password.');
  }
}

// Set when someone signs in with a code; cleared once they pick a password.
// Survives closing the app, so nobody can skip the "set a password" step.
const PW_PENDING_KEY = 've_ct_pw_pending';
export const isPasswordPending = () => localStorage.getItem(PW_PENDING_KEY) === '1';
export function setPasswordPending(on) {
  if (on) localStorage.setItem(PW_PENDING_KEY, '1'); else localStorage.removeItem(PW_PENDING_KEY);
}

// ---------------- Admin: manage workers (runs on the server) ----------------
// Talks to the admin-create-worker edge function. The function checks that the
// caller is the admin; the admin key never reaches this browser.
export async function callWorkerAdmin(action, fields = {}) {
  const { data, error } = await supabase.functions.invoke('admin-create-worker', { body: { action, ...fields } });
  if (error) {
    let detail = '';
    try { detail = (await error.context.json()).error || ''; } catch (e) { /* not JSON */ }
    const status = error.context && error.context.status;
    if (status === 404 && !detail) throw new Error('The worker function is not deployed yet — see SETUP.md (Phase 2, step 5).');
    if (status === 401 && !detail) throw new Error('The function rejected the login. In Supabase, turn OFF "Verify JWT" for admin-create-worker (SETUP.md, step 5).');
    throw new Error(detail || 'Could not reach the server. Check your connection.');
  }
  if (data && data.ok === false) throw new Error(data.error || 'Something went wrong.');
  return data;
}

// ---------------- Shared-device safety --------------------------------------
// Everything the app caches lives under the ve_ct_ prefix. A small marker
// remembers WHO this device's cache belongs to, so if a different person or a
// different role signs in, the old cache is wiped before anything is shown.
const OWNER_KEY = 've_ct_device_owner';
const FACELOCK_PREFIX = 've_ct_facelock_';

export function wipeLocalData({ keepFaceLock = false, keepOwner = false } = {}) {
  Object.keys(localStorage)
    .filter((k) => k.startsWith('ve_ct_'))
    .forEach((k) => {
      if (keepFaceLock && k.startsWith(FACELOCK_PREFIX)) return;
      if (keepOwner && k === OWNER_KEY) return;
      localStorage.removeItem(k);
    });
}

export function cachedOwner() {
  try { return JSON.parse(localStorage.getItem(OWNER_KEY) || 'null'); } catch { return null; }
}

// Call right after sign-in, before any data is shown or pulled.
export function claimDevice(userId, role) {
  const owner = cachedOwner();
  const changed = owner ? (owner.uid !== userId || owner.role !== role) : role !== 'admin';
  // Different person/role (or leftovers from before this feature, for a
  // non-admin) -> start from a clean device, Face ID setup included.
  if (changed) wipeLocalData();
  localStorage.setItem(OWNER_KEY, JSON.stringify({ uid: userId, role }));
}

export async function logout() {
  // Stop this device receiving the account's push notifications.
  try {
    const { disablePush } = await import('./push.js');
    await disablePush();
  } catch (e) { /* best effort */ }
  await supabase.auth.signOut();
  // Wipe cached business data. Face ID setup and the owner marker stay so the
  // same person signing back in keeps their lock; a different person gets a
  // full wipe in claimDevice().
  wipeLocalData({ keepFaceLock: true, keepOwner: true });
  currentRole = null;
}

// Fires when the session ends for any reason (logout on another tab, the
// account being deactivated, a revoked token): wipe cached data right away.
export function onSignedOut(callback) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      wipeLocalData({ keepFaceLock: true, keepOwner: true });
      currentRole = null;
      if (callback) callback();
    }
  });
}

// Pull every row from the cloud into localStorage. Cloud is treated as the
// source of truth. Bounded by a timeout so a slow/flaky connection can't
// hang app open forever — callers can await this on a truly empty device
// (no cached data yet) or fire-and-forget it in the background otherwise.
// Resolves to `true` only if it actually wrote data that differs from what
// was already cached locally, so callers know whether a re-render is needed.
const PULL_TIMEOUT_MS = 8000;

export async function pullAllFromCloud() {
  // app_data belongs to the admin only — a worker's device never pulls it.
  if (currentRole !== 'admin') return false;
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
  if (changed) window.dispatchEvent(new CustomEvent('ct-reminder-data'));
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
  if (currentRole !== 'admin') return; // workers never write app_data
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
