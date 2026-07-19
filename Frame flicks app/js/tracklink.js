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

// Opens a small modal with the link (copyable) and a QR code (viewable +
// downloadable as a PNG) — for when it's easier to show/send a code than
// to type or paste a link, e.g. in person or over a call.
export async function openLinkShareModal(entry) {
  if (!entry?.trackCode) return;
  const link = trackLinkFor(entry);
  const { openModal, closeModal } = await import('./modal.js');
  const { showToast } = await import('./toast.js');

  const qr = qrcode(0, 'M');
  qr.addData(link);
  qr.make();
  const qrSvg = qr.createSvgTag({ cellSize: 6, margin: 2 });

  const body = document.createElement('div');
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:16px;">
      <div id="qrWrap" style="background:#fff;padding:10px;border-radius:8px;border:1px solid var(--border);">${qrSvg}</div>
      <div class="form-field full" style="width:100%;">
        <label>Client progress link</label>
        <input type="text" id="shareLinkInput" value="${link.replace(/"/g, '&quot;')}" readonly>
      </div>
      <div class="form-actions" style="width:100%;">
        <button class="btn btn-ghost" id="closeShareBtn">Close</button>
        <button class="btn btn-ghost" id="downloadQrBtn">⬇️ Download QR</button>
        <button class="btn btn-primary" id="copyShareLinkBtn">Copy Link</button>
      </div>
    </div>`;

  openModal('Share with client', body);

  body.querySelector('#closeShareBtn').addEventListener('click', closeModal);
  body.querySelector('#shareLinkInput').addEventListener('click', (e) => e.target.select());
  body.querySelector('#copyShareLinkBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      showToast('Client link copied! 🔗');
    } catch (err) {
      window.prompt('Copy this link to send to your client:', link);
    }
  });
  body.querySelector('#downloadQrBtn').addEventListener('click', () => {
    const svgEl = body.querySelector('#qrWrap svg');
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 4;
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(pngBlob);
        a.download = `${(entry.project || 'project').replace(/[^a-z0-9]+/gi, '-')}-qr.png`;
        a.click();
      });
    };
    img.src = url;
  });
}
