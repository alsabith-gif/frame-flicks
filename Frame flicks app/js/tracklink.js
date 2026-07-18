// tracklink.js — builds the public client-facing "track my project" link and
// copies it to the clipboard. Kept separate from storage.js since track.html
// (the page the client actually opens) is a standalone, unauthenticated page
// that doesn't load the rest of the app.

function baseDir() {
  // Strips the current filename (e.g. "index.html") off the path, leaving
  // just the directory the app is served from — works whether the app is
  // hosted at the domain root or in a subfolder.
  return window.location.pathname.replace(/[^/]*$/, '');
}

export function trackLinkFor(entry) {
  if (!entry?.trackCode) return '';
  return `${window.location.origin}${baseDir()}track.html?p=${entry.trackCode}`;
}

export async function copyTrackLink(entry) {
  const { showToast } = await import('./toast.js');
  if (!entry?.trackCode) {
    showToast('Could not create a link for this project');
    return;
  }
  const link = trackLinkFor(entry);
  try {
    await navigator.clipboard.writeText(link);
    showToast('Client link copied! 🔗');
  } catch (err) {
    window.prompt('Copy this link to send to your client:', link);
  }
}
