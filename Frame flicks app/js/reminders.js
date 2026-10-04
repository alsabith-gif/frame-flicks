// reminders.js — keeps the `push_reminders` table in Supabase in step with
// your calendar + notification settings. The server (send-reminders function)
// just sends whatever is due, so it never needs to understand your data.
//
// Called (debounced) whenever projects, meetings or notification settings
// change, and once each time the app opens.

import { supabase, getSession } from './cloud.js';
import { getIncome, getMeetings, getNotifPrefs } from './storage.js';
import { buildEvents, buildReminders } from './reminderRules.js';

let timer = null;
let running = false;

export function scheduleReminderSync(delay = 2500) {
  clearTimeout(timer);
  timer = setTimeout(syncReminders, delay);
}

export async function syncReminders() {
  if (running) { scheduleReminderSync(3000); return; }
  running = true;
  try {
    const session = await getSession();
    if (!session) return;
    const prefs = getNotifPrefs();
    const desired = prefs.enabled
      ? buildReminders(buildEvents(getIncome(), getMeetings()), prefs, new Date())
      : [];

    const { data: pending, error } = await supabase.from('push_reminders').select('id').eq('sent', false);
    if (error) { console.error('reminder sync failed', error); return; }

    const keep = new Set(desired.map((r) => r.id));
    const stale = (pending || []).map((r) => r.id).filter((id) => !keep.has(id));
    if (stale.length) await supabase.from('push_reminders').delete().in('id', stale);
    if (desired.length) {
      const rows = desired.map((r) => ({ ...r, user_id: session.user.id }));
      // ignoreDuplicates: reminders already stored (or already sent) are left alone.
      const { error: upErr } = await supabase.from('push_reminders').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
      if (upErr) console.error('reminder upsert failed', upErr);
    }
  } catch (err) {
    console.error('reminder sync failed', err);
  } finally {
    running = false;
  }
}
