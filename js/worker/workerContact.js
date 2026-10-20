// worker/workerContact.js — two panels on the worker's Profile tab:
//   • Contact admin: a "Call admin" button (tel:). Hidden if the admin has not set a number.
//   • Feedback: the worker can tell the admin how they feel. It goes through the
//     database function submit_feedback(), which checks the caller is an active worker
//     but does NOT save who they are. The panel says honestly what that does and does not mean.

import { escHtml } from '../format.js';
import { supabase } from '../cloud.js';
import { showToast } from '../toast.js';

const PHONE_KEY = 'ff_crew_phone';
const MAX = 2000;
const MOODS = [{ id: 'good', icon: '😊', label: 'Good' }, { id: 'okay', icon: '😐', label: 'Okay' }, { id: 'bad', icon: '😟', label: 'Not good' }];

const cachedPhone = () => { try { return localStorage.getItem(PHONE_KEY) || ''; } catch (e) { return ''; } };
const savePhone = (p) => { try { if (p) localStorage.setItem(PHONE_KEY, p); else localStorage.removeItem(PHONE_KEY); } catch (e) { /* ignore */ } };
// the tel: link keeps only digits and a leading +
export const telHref = (phone) => `tel:${String(phone || '').replace(/(?!^\+)[^0-9]/g, '')}`;

function callHtml(phone) {
  return phone
    ? `<p class="muted">Need to talk to the admin about a job or payment?</p>
       <a class="btn btn-primary" id="waCallBtn" href="${escHtml(telHref(phone))}">📞 Call admin <span class="wa-phone">${escHtml(phone)}</span></a>`
    : '<p class="muted">The admin has not added a contact number yet.</p>';
}

export async function mountContactPanel(el) {
  if (!el) return;
  const draw = (phone) => { el.innerHTML = `<h2 class="wa-h2">Contact admin</h2>${callHtml(phone)}`; };
  draw(cachedPhone());                       // show the last known number at once (works offline)
  try {
    const { data, error } = await supabase.from('crew_contact').select('phone').eq('id', 1);
    if (error) throw error;
    const phone = (data && data[0] && data[0].phone) || '';
    savePhone(phone);
    draw(phone);
  } catch (e) { /* keep what we have */ }
}

export function mountFeedbackPanel(el) {
  if (!el) return;
  let mood = null;
  el.innerHTML = `
    <h2 class="wa-h2">Feedback for the admin</h2>
    <p class="muted">Tell the admin how work is going or what could be better. <b>The app does not save or show who sent it.</b></p>
    <p class="muted wa-fb-limit">Please know: in a small crew your words or the day could still give you away, and the person who runs the app's server could in theory look through its technical records. So don't write anything you would not want guessed.</p>
    <form id="waFbForm" autocomplete="off">
      <div class="wa-moods" role="group" aria-label="How are you feeling? (optional)">
        ${MOODS.map((m) => `<button type="button" class="wa-mood" data-mood="${m.id}" aria-pressed="false">${m.icon} ${m.label}</button>`).join('')}
      </div>
      <div class="form-field"><label for="waFbText">Your message</label>
        <textarea id="waFbText" rows="4" maxlength="${MAX}" required placeholder="Write here…"></textarea></div>
      <p class="wa-error" id="waFbErr"></p>
      <button type="submit" class="btn btn-primary" id="waFbBtn">Send feedback</button>
    </form>`;
  const err = el.querySelector('#waFbErr');
  el.querySelector('.wa-moods').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mood]'); if (!b) return;
    mood = mood === b.dataset.mood ? null : b.dataset.mood;       // tap again to clear
    el.querySelectorAll('.wa-mood').forEach((x) => { const on = x.dataset.mood === mood; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
  });
  el.querySelector('#waFbForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const text = el.querySelector('#waFbText').value.trim();
    if (!text) { err.textContent = 'Write something first.'; return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { err.textContent = 'You need internet to send feedback.'; return; }
    const btn = el.querySelector('#waFbBtn');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const { error } = await supabase.rpc('submit_feedback', { p_message: text, p_mood: mood });
      if (error) throw error;
      el.querySelector('#waFbForm').reset(); mood = null;
      el.querySelectorAll('.wa-mood').forEach((x) => { x.classList.remove('is-on'); x.setAttribute('aria-pressed', 'false'); });
      showToast('Thank you — your feedback was sent');
    } catch (ex) {
      err.textContent = /fetch|network/i.test(ex.message || '') ? 'No connection. Try again.' : (ex.message || 'Could not send. Try again.');
    }
    btn.disabled = false; btn.textContent = 'Send feedback';
  });
}
