// worker/workerNotify.js — the "Notifications" panel on the worker's Settings page.
// Turn notifications on for THIS phone, choose which kinds to get, send a test.
// The choices are saved through the worker_set_notif_prefs database function;
// the reminders themselves are built by the database (never by this phone).

import { supabase } from '../cloud.js';
import { escHtml } from '../format.js';
import { showToast } from '../toast.js';
import * as push from '../push.js';

const KINDS = [
  { key: 'shoot_reminders', label: 'Shoot reminders', hint: 'The evening before, and 1 hour before.' },
  { key: 'due_reminders', label: 'Deadline reminders', hint: 'The evening before, and on the day.' },
  { key: 'change_alerts', label: 'Job changes', hint: 'A new job, a change, or a removed job.' },
];
const DEFAULTS = { enabled: true, shoot_reminders: true, due_reminders: true, change_alerts: true };

async function loadPrefs() {
  const { data, error } = await supabase.from('worker_notif_prefs').select('*').maybeSingle();
  if (error) throw error;
  return { ...DEFAULTS, ...(data || {}) };
}

function switchHtml(id, on) {
  return `<button type="button" class="toggle-switch${on ? ' on' : ''}" id="${id}" role="switch" aria-checked="${on}"><span class="toggle-knob"></span></button>`;
}

export async function mountNotifyPanel(el) {
  const draw = (inner) => { el.innerHTML = `<h2 class="wa-h2">Notifications</h2>${inner}`; };
  draw('<p class="muted">Checking…</p>');

  let st;
  try { st = await push.deviceStatus(); } catch (e) { st = { supported: false }; }

  if (!st.supported && !st.needsInstall) {
    draw('<p class="muted">This browser cannot show notifications. Use Chrome on Android, or Safari on iPhone with the app added to your Home Screen.</p>');
    return;
  }
  if (st.needsInstall) {
    draw(`<p class="muted">On iPhone, notifications only work when the app is opened from your <b>Home Screen</b>.</p>
      <ol class="muted" style="padding-left:18px;margin:6px 0">
        <li>Open this page in <b>Safari</b>.</li>
        <li>Tap the <b>Share</b> button, then <b>Add to Home Screen</b>.</li>
        <li>Open <b>Frame Flicks</b> from your Home Screen and come back to this screen.</li>
      </ol>`);
    return;
  }
  if (st.permission === 'denied') {
    draw('<p class="muted">Notifications are <b>blocked</b> for this app on this phone. Allow them in your phone settings (Settings → Notifications → Frame Flicks, or the site settings in Chrome), then open this screen again.</p>');
    return;
  }

  const paint = async () => {
    st = await push.deviceStatus();
    if (!st.subscribed || st.permission !== 'granted') {
      draw(`<p class="muted">Get a notification before a shoot or deadline, and when a job is added or changed. Pay is never shown in a notification.</p>
        <p class="wa-error" id="waNotifyErr"></p>
        <button class="btn btn-primary" id="waNotifyOn">Turn on notifications on this phone</button>`);
      el.querySelector('#waNotifyOn').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget; const err = el.querySelector('#waNotifyErr');
        btn.disabled = true; err.textContent = '';
        try { await push.enablePush(); showToast('Notifications are on'); await paint(); }
        catch (e) { err.textContent = e.message || 'Could not turn on notifications.'; btn.disabled = false; }
      });
      return;
    }

    let prefs = { ...DEFAULTS };
    let prefsErr = '';
    try { prefs = await loadPrefs(); } catch (e) { prefsErr = 'Could not load your choices. Pull to refresh or try again.'; }

    draw(`
      <p class="muted">Notifications are <b>on</b> for this phone.</p>
      <div class="settings-row"><div class="settings-row-label">All notifications</div>${switchHtml('waN_enabled', prefs.enabled)}</div>
      ${KINDS.map((k) => `
        <div class="settings-row"><div class="settings-row-label">${escHtml(k.label)}<div class="settings-note">${escHtml(k.hint)}</div></div>
          ${switchHtml('waN_' + k.key, prefs[k.key])}</div>`).join('')}
      <p class="wa-error" id="waNotifyErr">${escHtml(prefsErr)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button class="btn btn-ghost" id="waNotifyTest">Send me a test</button>
        <button class="btn btn-ghost" id="waNotifyOff">Turn off on this phone</button>
      </div>`);

    const err = el.querySelector('#waNotifyErr');
    const ids = ['enabled', ...KINDS.map((k) => k.key)];
    const sw = Object.fromEntries(ids.map((k) => [k, el.querySelector('#waN_' + k)]));
    const paintSwitches = () => ids.forEach((k) => {
      sw[k].classList.toggle('on', !!prefs[k]); sw[k].setAttribute('aria-checked', String(!!prefs[k]));
      if (k !== 'enabled') sw[k].disabled = !prefs.enabled;
    });
    paintSwitches();

    ids.forEach((k) => sw[k].addEventListener('click', async () => {
      const next = { ...prefs, [k]: !prefs[k] };
      err.textContent = '';
      ids.forEach((x) => { sw[x].disabled = true; });
      try {
        const { error } = await supabase.rpc('worker_set_notif_prefs', {
          p_enabled: next.enabled, p_shoot: next.shoot_reminders, p_due: next.due_reminders, p_changes: next.change_alerts,
        });
        if (error) throw error;
        prefs = next;
      } catch (e) {
        err.textContent = 'Could not save that. Check your internet and try again.';
      }
      ids.forEach((x) => { sw[x].disabled = false; });
      paintSwitches();
    }));

    el.querySelector('#waNotifyTest').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true; err.textContent = '';
      try { await push.sendTestPush(); showToast('Test sent — it should arrive in a few seconds'); }
      catch (e) { err.textContent = e.message; }
      btn.disabled = false;
    });
    el.querySelector('#waNotifyOff').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true;
      try { await push.disablePush(); showToast('Notifications are off for this phone'); } catch (e) { /* ignore */ }
      await paint();
    });
  };
  await paint();
}
