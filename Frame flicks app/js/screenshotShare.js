// screenshotShare.js — shared UI + clipboard logic for attaching a
// prospect's screenshot to an outreach or follow-up email. Used by both
// pages/prospects.js (initial pitch compose modal) and pages/followup.js
// (follow-up compose modal) so the behavior is identical everywhere.

import { dataUrlToBlob } from './imageUtils.js';
import { showToast } from './toast.js';

// The tag people can type into a DM/follow-up script wherever they want the
// screenshot to land in the finished message.
export const SCREENSHOT_TAG = '[Screenshot]';

// Swaps the [Screenshot] tag in a message body for a plain-language marker,
// so it's obvious in the preview where the picture is meant to go.
export function fillScreenshotTag(text, hasScreenshot) {
  if (!text) return text;
  const marker = hasScreenshot
    ? '📷 (your screenshot goes here — copy it below, then paste)'
    : '';
  return text.replaceAll(SCREENSHOT_TAG, marker);
}

// Returns the HTML for a small "here's the screenshot you attached" block,
// with a Copy Image button — or an empty string if the prospect has none.
export function screenshotAttachHtml(prospect) {
  if (!prospect || !prospect.screenshot) return '';
  return `
    <div class="screenshot-attach">
      <img src="${prospect.screenshot}" alt="Screenshot for ${prospect.name || 'prospect'}">
      <div class="screenshot-attach-info">
        <div class="screenshot-attach-label">📷 Screenshot attached</div>
        <div class="muted" style="font-size:12px;">Copy it, then paste into the Gmail body (Ctrl/Cmd+V) wherever the message mentions it.</div>
        <button type="button" class="btn btn-sm btn-ghost mt-8" id="copyScreenshotBtn">📋 Copy Image</button>
      </div>
    </div>`;
}

// Wires the Copy Image button rendered by screenshotAttachHtml above. Call
// this once after the modal body containing that HTML is in the DOM.
export function wireScreenshotCopyButton(root, prospect) {
  const btn = root.querySelector('#copyScreenshotBtn');
  if (!btn || !prospect?.screenshot) return;
  btn.addEventListener('click', async () => {
    try {
      const blob = dataUrlToBlob(prospect.screenshot);
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      showToast('Image copied — paste it into the email body ✓');
    } catch (err) {
      console.error('copy image failed', err);
      showToast('Could not copy — your browser may not allow it here');
    }
  });
}
