// router.js — client-side routing (not URL-based). showPage(name) fetches the
// partial, injects it, lazy-loads css + js module, and updates the shell UI.

const PAGE_META = {
  prospects: { title: 'Prospects', addLabel: '+ Add Prospect' },
  goals: { title: 'Daily Goals', addLabel: null },
  analysis: { title: 'Analysis', addLabel: null },
  income: { title: 'Income Tracker', addLabel: '+ Add Project' },
  scripts: { title: 'DM Scripts', addLabel: '+ Add Script' },
  followup: { title: 'Smart Follow-ups', addLabel: null },
  tips: { title: 'Tips', addLabel: null },
  settings: { title: 'Settings', addLabel: null },
};

const partialCache = new Map(); // name -> html string
const cssInjected = new Set();
const moduleCache = new Map(); // name -> imported module

let currentPageModule = null;
let currentPageName = null;

async function loadPartial(name) {
  if (partialCache.has(name)) return partialCache.get(name);
  const res = await fetch(`pages/${name}.html`);
  if (!res.ok) throw new Error(`Failed to load pages/${name}.html`);
  const html = await res.text();
  partialCache.set(name, html);
  return html;
}

function ensureCss(name) {
  if (cssInjected.has(name)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `css/${name}.css`;
  link.dataset.pageCss = name;
  document.head.appendChild(link);
  cssInjected.add(name);
}

async function loadPageModule(name) {
  if (moduleCache.has(name)) return moduleCache.get(name);
  const mod = await import(`./pages/${name}.js`);
  moduleCache.set(name, mod);
  return mod;
}

function setActiveNav(name) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === name);
  });
}

function closeDrawer() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
}

function wireAddButton(name, mod) {
  const btn = document.getElementById('topAddBtn');
  const meta = PAGE_META[name];

  // Prefer a dynamic config from the page module if it provides one.
  let config = null;
  if (mod && typeof mod.getAddButton === 'function') {
    config = mod.getAddButton();
  } else if (meta.addLabel) {
    config = { label: meta.addLabel, onClick: () => mod && mod.onAddClick && mod.onAddClick() };
  }

  if (!config) {
    btn.style.display = 'none';
    btn.onclick = null;
    return;
  }

  btn.style.display = '';
  btn.textContent = config.label;
  btn.onclick = config.onClick;
}

export async function showPage(name) {
  if (!PAGE_META[name]) name = 'prospects';
  const outlet = document.getElementById('page-outlet');

  try {
    ensureCss(name);
    const html = await loadPartial(name);
    outlet.innerHTML = html;
    outlet.classList.remove('page-enter');
    void outlet.offsetWidth;
    outlet.classList.add('page-enter');

    const mod = await loadPageModule(name);
    currentPageModule = mod;
    currentPageName = name;

    if (typeof mod.init === 'function') {
      mod.init();
    }

    document.getElementById('pageTitle').textContent = PAGE_META[name].title;
    setActiveNav(name);
    wireAddButton(name, mod);
    closeDrawer();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  } catch (err) {
    console.error(err);
    outlet.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Could not load this page.</p></div>`;
  }
}

export function refreshAddButton(name) {
  if (currentPageModule) wireAddButton(name, currentPageModule);
}

// Re-runs init() on whichever page is on screen right now, so freshly
// synced cloud data shows up without a full reload or navigation.
export function refreshCurrentPage() {
  if (currentPageModule && typeof currentPageModule.init === 'function') {
    currentPageModule.init();
  }
}
