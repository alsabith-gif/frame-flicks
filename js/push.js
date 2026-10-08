// push.js — browser side of Web Push: register the service worker, ask for
// permission, subscribe this device, and store the subscription in Supabase
// so the server can reach it.

import { supabase, getSession } from './cloud.js';
import { VAPID_PUBLIC_KEY } from './config.js';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
export function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}
export function vapidConfigured() {
  return !!VAPID_PUBLIC_KEY;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('./sw.js');
  } catch (err) {
    console.error('service worker failed', err);
    return null;
  }
}

function keyToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

// Must be called from a tap (browsers/iOS only allow the permission prompt
// in response to a user gesture).
export async function enablePush() {
  if (!pushSupported()) throw new Error("This browser doesn't support push notifications.");
  if (!VAPID_PUBLIC_KEY) throw new Error('Push is not set up yet — add the VAPID public key in js/config.js (see SETUP.md).');
  const session = await getSession();
  if (!session) throw new Error('Please log in first.');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them for this app in your phone/browser settings, then try again.');

  await registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) }));
  const j = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: j.endpoint,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
    user_id: session.user.id,
    user_agent: navigator.userAgent.slice(0, 200),
  }, { onConflict: 'endpoint' });
  if (error) throw new Error('Could not save this device — did you run the SQL in SETUP.md? (' + error.message + ')');
  return true;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch (e) { /* ignore */ }
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

// Asks the server to push a test notification to every device you've enabled.
export async function sendTestPush() {
  const { data, error } = await supabase.functions.invoke('send-reminders', { body: { test: true } });
  if (error) throw new Error('Test failed — is the send-reminders function deployed? (see SETUP.md)');
  if (!data || !data.sent) throw new Error('The server has no device registered for you yet.');
  return data.sent;
}
