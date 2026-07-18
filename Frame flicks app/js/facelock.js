// facelock.js — an on-device "Face ID to open" lock, set up per-device from
// Settings. This is intentionally separate from storage.js/cloud.js: a Face
// ID credential is tied to one specific phone/laptop and must NEVER sync to
// your other devices, so this talks to localStorage directly on purpose.

const ENABLED_KEY = 've_ct_facelock_enabled';
const CRED_ID_KEY = 've_ct_facelock_cred_id';

export function isSupported() {
  return typeof window.PublicKeyCredential !== 'undefined' && !!navigator.credentials;
}

export function isEnabled() {
  return localStorage.getItem(ENABLED_KEY) === '1' && !!localStorage.getItem(CRED_ID_KEY);
}

function randomBytes(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}

// Registers Face ID / Touch ID on this device. Resolves true on success.
export async function enable() {
  if (!isSupported()) throw new Error('Face ID / Touch ID is not available on this device or browser.');

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: 'ClientTrack' },
      user: {
        id: randomBytes(16),
        name: 'clienttrack-device-lock',
        displayName: 'ClientTrack Device Lock',
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000,
    },
  });

  if (!credential) throw new Error('Face ID setup was cancelled.');

  const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
  localStorage.setItem(CRED_ID_KEY, credId);
  localStorage.setItem(ENABLED_KEY, '1');
  return true;
}

export function disable() {
  localStorage.removeItem(ENABLED_KEY);
  localStorage.removeItem(CRED_ID_KEY);
}

// Prompts Face ID / Touch ID to unlock. Resolves true on success, false if
// cancelled or failed.
export async function verify() {
  const credId = localStorage.getItem(CRED_ID_KEY);
  if (!credId) return false;

  const rawId = Uint8Array.from(atob(credId), (c) => c.charCodeAt(0));

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ id: rawId, type: 'public-key' }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}
