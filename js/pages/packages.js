// pages/packages.js — the package builder (admin only, internal). Packages live in the
// synced pricing data (`packageLib`). They are never deleted, only archived, so an old
// invoice that used one always still finds it.
import { getPricing, savePricing } from '../storage.js';
import { PACKAGE_KINDS, normalizePackage } from '../pricing.js';
import { escHtml, currency } from '../format.js';
import { openModal, closeModal } from '../modal.js';
import { showToast } from '../toast.js';

let P; let kindFilter = ''; let showArchived = false;
const $ = (id) => document.getElementById(id);
const persist = () => savePricing(P);

function summary(k) {
  const bits = k.items.map((i) => `${i.count} ${i.label}`);
  if (k.revisions) bits.push(`${k.revisions} revision${k.revisions > 1 ? 's' : ''}`);
  if (k.deliveryDays) bits.push(`delivery in ${k.deliveryDays} day${k.deliveryDays > 1 ? 's' : ''}`);
  return bits.join(' · ') || 'No items yet';
}

function render() {
  const list = P.packageLib.filter((k) => (!kindFilter || k.kind === kindFilter) && (showArchived || k.active));
  $('pkList').innerHTML = list.length ? list.map((k) => `
    <div class="pk-card ${k.active ? '' : 'is-archived'}" data-id="${escHtml(k.id)}">
      <div class="pk-top"><div><div class="pk-name">${escHtml(k.name)} ${k.popular ? '<span class="badge badge-blue">Most popular</span>' : ''} ${k.active ? '' : '<span class="badge badge-muted">Archived</span>'}</div>
        <div class="pk-sub">${escHtml(PACKAGE_KINDS[k.kind])} package</div></div><div class="pk-price">${escHtml(currency(k.price))}${k.kind === 'monthly' ? ' / month' : k.kind === 'weekly' ? ' / week' : ''}</div></div>
      <div class="pk-sub">${escHtml(summary(k))}</div>
      ${k.addOns.length ? `<div class="pk-sub">Add-ons: ${k.addOns.map((a) => `${escHtml(a.label)} (${escHtml(currency(a.price))})`).join(', ')}</div>` : ''}
      <div class="pk-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="edit">✏️ Edit</button><button type="button" class="btn btn-ghost btn-sm" data-act="dup">⧉ Duplicate</button>
        <button type="button" class="btn btn-ghost btn-sm" data-act="arch">${k.active ? '🗄️ Archive' : '↩️ Restore'}</button></div>
    </div>`).join('') : '<p class="muted">No packages here yet. Press "+ Add Package".</p>';
}

function openEditor(id) {
  const base = id ? P.packageLib.find((x) => x.id === id) : null;
  const W = normalizePackage(base ? JSON.parse(JSON.stringify(base)) : { id: 'pk' + Date.now(), name: '', kind: kindFilter || 'monthly', price: 0, items: [{ label: 'Reels', count: 4 }] });
  if (!base) W.name = '';
  const body = document.createElement('div');
  const $ = (x) => body.querySelector('#' + x);   // the form is not in the page until openModal runs
  const draw = () => {
    body.innerHTML = `<div class="form-grid">
      <div class="form-field"><label>Package name</label><input id="pkName" maxlength="60" value="${escHtml(W.name)}"></div>
      <div class="form-field"><label>Kind</label><select id="pkKindSel">${Object.entries(PACKAGE_KINDS).map(([k, v]) => `<option value="${k}" ${W.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="form-field"><label>Price (₹)</label><input type="number" min="0" id="pkPrice" value="${W.price}"></div>
      <div class="form-field"><label>Revisions included</label><input type="number" min="0" id="pkRev" value="${W.revisions}"></div>
      <div class="form-field"><label>Delivery within (days, 0 = not shown)</label><input type="number" min="0" id="pkDel" value="${W.deliveryDays}"></div>
    </div>
    <h3 class="inv-sub">What you deliver <span class="muted" style="font-weight:400">— a name and how many</span></h3>
    <div class="pk-rows" id="pkItems">${W.items.map((i, n) => `<div class="pk-row"><input data-i="${n}" data-f="label" value="${escHtml(i.label)}" placeholder="e.g. Reels"><input type="number" min="0" data-i="${n}" data-f="count" value="${i.count}"><button type="button" class="btn btn-icon btn-sm" data-idel="${n}">🗑️</button></div>`).join('')}</div>
    <button type="button" class="btn btn-ghost btn-sm" id="pkItemAdd">＋ Add item</button>
    <h3 class="inv-sub">Add-ons for this package <span class="muted" style="font-weight:400">— a name and a price</span></h3>
    <div class="pk-rows" id="pkAddons">${W.addOns.map((a, n) => `<div class="pk-row"><input data-a="${n}" data-f="label" value="${escHtml(a.label)}" placeholder="e.g. Drone shot"><input type="number" min="0" data-a="${n}" data-f="price" value="${a.price}"><button type="button" class="btn btn-icon btn-sm" data-adel="${n}">🗑️</button></div>`).join('')}</div>
    <button type="button" class="btn btn-ghost btn-sm" id="pkAddonAdd">＋ Add add-on</button>
    <div class="form-field" style="margin-top:10px"><label>Other lines to show (one per line, "text | small note")</label><textarea id="pkFeat" rows="4">${escHtml(W.features.join('\n'))}</textarea></div>
    <label style="font-size:13px;display:flex;gap:6px;align-items:center;margin:8px 0"><input type="checkbox" id="pkPop" ${W.popular ? 'checked' : ''} style="width:auto"> Show "Most popular"</label>
    <p class="muted" id="pkMsg" style="color:#c0392b;min-height:1em"></p>
    <div class="form-actions"><button class="btn btn-ghost" id="pkCancel">Cancel</button><button class="btn btn-primary" id="pkSave">Save package</button></div>`;
    const grab = () => {   // keep typed values when the rows are redrawn
      W.name = $('pkName').value; W.kind = $('pkKindSel').value; W.price = Number($('pkPrice').value) || 0; W.revisions = Number($('pkRev').value) || 0;
      W.deliveryDays = Number($('pkDel').value) || 0; W.features = $('pkFeat').value.split('\n'); W.popular = $('pkPop').checked;
    };
    body.querySelectorAll('#pkItems input').forEach((el) => el.addEventListener('input', () => { W.items[el.dataset.i][el.dataset.f] = el.dataset.f === 'count' ? Number(el.value) || 0 : el.value; }));
    body.querySelectorAll('#pkAddons input').forEach((el) => el.addEventListener('input', () => { W.addOns[el.dataset.a][el.dataset.f] = el.dataset.f === 'price' ? Number(el.value) || 0 : el.value; }));
    body.querySelectorAll('[data-idel]').forEach((b) => b.addEventListener('click', () => { grab(); W.items.splice(Number(b.dataset.idel), 1); draw(); }));
    body.querySelectorAll('[data-adel]').forEach((b) => b.addEventListener('click', () => { grab(); W.addOns.splice(Number(b.dataset.adel), 1); draw(); }));
    $('pkItemAdd').addEventListener('click', () => { grab(); W.items.push({ label: '', count: 1 }); draw(); });
    $('pkAddonAdd').addEventListener('click', () => { grab(); W.addOns.push({ label: '', price: 0 }); draw(); });
    $('pkCancel').addEventListener('click', closeModal);
    $('pkSave').addEventListener('click', () => {
      grab();
      if (!W.name.trim()) { $('pkMsg').textContent = 'Give the package a name.'; return; }
      const saved = normalizePackage({ ...W, name: W.name.trim(), active: base ? base.active : true });
      if (base) P.packageLib = P.packageLib.map((x) => (x.id === base.id ? saved : x)); else P.packageLib.push(saved);
      persist(); closeModal(); showToast('Package saved'); render();
    });
  };
  draw();
  openModal(base ? 'Edit package' : 'New package', body);
}

export function onAddClick() { openEditor(null); }

export function init() {
  P = getPricing(); kindFilter = ''; showArchived = false;
  $('pkKind').addEventListener('change', (e) => { kindFilter = e.target.value; render(); });
  $('pkArchived').addEventListener('change', (e) => { showArchived = e.target.checked; render(); });
  $('pkList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('.pk-card').dataset.id; const act = b.dataset.act;
    if (act === 'edit') openEditor(id);
    else if (act === 'arch') { P.packageLib = P.packageLib.map((x) => (x.id === id ? { ...x, active: !x.active } : x)); persist(); showToast('Done'); render(); }
    else if (act === 'dup') {
      const src = P.packageLib.find((x) => x.id === id);
      P.packageLib.push(normalizePackage({ ...JSON.parse(JSON.stringify(src)), id: 'pk' + Date.now(), name: `${src.name} (copy)`, active: true }));
      persist(); showToast('Copied'); render();
    }
  });
  render();
}
