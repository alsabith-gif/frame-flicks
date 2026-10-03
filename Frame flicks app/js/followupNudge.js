// followupNudge.js — runs once each time the app is opened. Checks for any
// follow-ups that are due (same rule the Follow-up tab uses) and asks
// permission before opening the send flow for each one — one at a time.
//
// Honest limitation: this can only run while the app is actually open in
// the browser (there's no background server here), so it checks the
// moment you open the app rather than truly "while it's closed."

import { computeDue, openSendModal } from './pages/followup.js';
import { openConfirm } from './modal.js';

let queue = [];
let running = false;

function showNext() {
  if (!queue.length) { running = false; return; }
  const { prospect, round, daysSince } = queue.shift();

  openConfirm(
    `⏰ You have a follow-up due for ${prospect.name} (Round ${round}, ${daysSince}d since last contact). Send it now?`,
    () => openSendModal(prospect.id, round, showNext), // Allow → open the compose flow, then continue the queue
    () => showNext() // Not now → just move to the next due prospect (this one will be asked about again next time you open the app)
  );
}

export function checkDueFollowups() {
  if (running) return;
  const due = computeDue();
  if (!due.length) return;
  queue = due;
  running = true;
  // Small delay so this doesn't collide with the initial page render.
  setTimeout(showNext, 900);
}
