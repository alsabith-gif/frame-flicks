// pages/contentTypes.js — Client-mode-only page for managing the list of
// Content Type options (Reel, Long-form, Shorts, etc.) used on the
// Dashboard's Add/Edit Project form and its filter dropdown. Renaming or
// deleting a type here only changes the list going forward — projects
// that already have a type saved on them keep showing that label even if
// it's later renamed or removed from this list.

import { getContentTypes, saveContentTypes } from '../storage.js';
import { escHtml } from '../format.js';
import { showToast } from '../toast.js';
import { openConfirm } from '../modal.js';

function render() {
  const types = getContentTypes();
  const listEl = document.getElementById('ctList');
  const emptyEl = document.getElementById('ctEmpty');

  if (!types.length) {
    listEl.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  listEl.innerHTML = types.map((t, i) => `
    <div class="ct-row" data-i="${i}">
      <span class="ct-name">${escHtml(t)}</span>
      <div class="row-actions">
        <button class="btn btn-icon btn-sm" data-rename="${i}" title="Rename">✏️</button>
        <button class="btn btn-icon btn-sm" data-del="${i}" title="Delete">🗑️</button>
      </div>
    </div>`).join('');

  listEl.querySelectorAll('[data-rename]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const list = getContentTypes();
      const i = Number(btn.dataset.rename);
      const current = list[i];
      const next = prompt('Rename content type', current);
      if (next && next.trim() && next.trim() !== current) {
        list[i] = next.trim();
        saveContentTypes(list);
        showToast('Renamed — existing projects keep their saved label');
        render();
      }
    });
  });

  listEl.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.del);
      openConfirm('Remove this content type? Projects that already used it keep their label — it just won\'t be offered for new projects.', () => {
        const list = getContentTypes().filter((_, idx) => idx !== i);
        saveContentTypes(list);
        showToast('Content type removed');
        render();
      });
    });
  });
}

function wireAdd() {
  const input = document.getElementById('ctNewName');
  const addBtn = document.getElementById('ctAddBtn');

  function add() {
    const name = input.value.trim();
    if (!name) { showToast('Enter a name first'); return; }
    const list = getContentTypes();
    if (list.some((t) => t.toLowerCase() === name.toLowerCase())) {
      showToast('That content type already exists');
      return;
    }
    list.push(name);
    saveContentTypes(list);
    input.value = '';
    showToast('Content type added');
    render();
  }

  addBtn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
}

export function init() {
  wireAdd();
  render();
}
