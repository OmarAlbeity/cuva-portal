/* =====================================================================
 * CUVA Portal — Shared UI (common.js)
 * ---------------------------------------------------------------------
 * Loaded on every page after api.js. Provides:
 *   - session (current user + their passes), header, phone tab bar, footer
 *   - esc(): HTML-escapes all user text before it is put in the page
 *   - campus-time helpers (all times shown in China Standard Time, UTC+8)
 *   - toasts, "flash" toasts that survive a redirect, modals, dialogs
 *   - the QR entry-pass ticket, safe redirects between pages
 * ===================================================================== */
const UI = (() => {
  'use strict';

  const NAV_ITEMS = [
    { id: 'explore',   href: 'index.html',     short: 'Discover',  long: 'Discover Activities', icon: 'compass' },
    { id: 'passes',    href: 'passes.html',    short: 'My Passes', long: 'My Entry Passes',     icon: 'ticket', showCount: true },
    { id: 'organizer', href: 'organizer.html', short: 'Organizer', long: 'Organizer Desk',      icon: 'shield-check' }
  ];

  // Only these pages are accepted as ?redirect= targets (prevents open redirects)
  const REDIRECT_PAGES = NAV_ITEMS.map(n => n.href);
  const FLASH_KEY = 'cuva_flash_message';

  const LOGO_SVG = `
    <svg viewBox="0 0 400 240" class="w-full h-full object-contain" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M15 140 C 60 145, 95 160, 150 145 C 120 158, 80 162, 28 152 Z" fill="#0072CE" />
      <path d="M12 140 C 45 155, 100 148, 145 146 C 105 160, 50 166, 12 140 Z" fill="#0072CE" />
      <path d="M45 175 C 90 180, 130 190, 175 165 C 140 185, 95 190, 45 175 Z" fill="#00A651" />
      <path d="M40 176 C 85 188, 130 178, 175 168 C 130 192, 80 192, 40 176 Z" fill="#00A651" />
      <path d="M225 150 C 270 135, 315 138, 355 145 C 310 152, 265 148, 225 150 Z" fill="#231F20" />
      <path d="M228 152 C 265 136, 310 136, 350 144 C 305 156, 260 154, 228 152 Z" fill="#231F20" />
      <path d="M215 175 C 265 185, 330 160, 385 172 C 335 188, 265 195, 215 175 Z" fill="#FDB913" />
      <path d="M198 22 C 160 -8, 92 18, 95 86 C 98 135, 160 175, 185 200 C 182 178, 155 155, 132 118 C 112 85, 125 45, 162 40 C 185 36, 202 52, 212 65 C 220 52, 240 35, 265 40 C 300 45, 315 85, 292 122 C 268 160, 205 192, 185 200 C 215 170, 290 125, 288 78 C 285 25, 230 -5, 198 22 Z" fill="#ED1C24" />
      <path d="M125 78 C 115 82, 110 88, 118 96 C 130 96, 142 85, 155 98 C 165 110, 172 135, 188 170 C 196 150, 206 130, 218 108 C 228 92, 248 65, 256 50 C 250 48, 242 54, 236 66 L 218 95 C 218 95, 232 70, 240 56 C 234 54, 228 58, 222 70 L 205 98 C 205 98, 218 75, 224 64 C 218 63, 214 66, 208 76 L 194 102 C 182 120, 168 130, 158 120 C 145 106, 145 88, 125 78 Z" fill="#FFFFFF" />
      <path d="M105 195 C 135 220, 225 228, 270 190 C 225 210, 150 215, 105 195 Z" fill="#ED1C24" />
    </svg>`;

  let activePage = null;

  /** Shared session state, filled by init(). */
  const state = {
    user: null,              // { studentId, name, wechat, major, grade, isOrganizer, isSuperAdmin } or null
    superAdminId: '',
    myRegistrations: []      // the signed-in student's passes (each with .event)
  };

  // =================================================================
  // HELPERS
  // =================================================================
  const byId = id => document.getElementById(id);

  /** HTML-escape any user-provided text before inserting it into markup. */
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Render Lucide icons (bundled locally in vendor/icons.js). */
  function icons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons();
  }

  // =================================================================
  // CAMPUS TIME (China Standard Time, UTC+8, no daylight saving)
  // Everyone sees the same activity times regardless of their phone's time zone.
  // =================================================================
  const CAMPUS_TZ = 'Asia/Shanghai';
  const CAMPUS_OFFSET_MS = 8 * 3600 * 1000;

  /** Format an ISO time in campus time, e.g. fmt(iso, { month: 'short', day: 'numeric' }). */
  function fmt(iso, options) {
    return new Date(iso).toLocaleString('en-US', { ...options, timeZone: CAMPUS_TZ });
  }

  const fmtDate     = iso => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime     = iso => fmt(iso, { hour: '2-digit', minute: '2-digit' });
  const fmtShort    = iso => fmt(iso, { month: 'numeric', day: 'numeric' });
  const fmtDateTime = iso => fmt(iso, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtFullDate = iso => fmt(iso, { year: 'numeric', month: 'numeric', day: 'numeric' });

  /** ISO (UTC) → value for <input type="datetime-local"> in campus time. */
  function toInputValue(iso) {
    return new Date(new Date(iso).getTime() + CAMPUS_OFFSET_MS).toISOString().slice(0, 16);
  }

  /** <input type="datetime-local"> value (campus time) → ISO (UTC). */
  function fromInputValue(value) {
    return new Date(`${value}:00+08:00`).toISOString();
  }

  // Kept for older page code
  const formatSimpleDate = fmtDateTime;

  // =================================================================
  // REDIRECTS BETWEEN PAGES
  // =================================================================
  function currentPageHref() {
    const item = NAV_ITEMS.find(n => n.id === activePage);
    return item ? item.href : 'index.html';
  }

  /** Where to go after sign-in/sign-up (from ?redirect=), defaulting to index.html. */
  function redirectTarget() {
    const r = new URLSearchParams(location.search).get('redirect');
    return REDIRECT_PAGES.includes(r) ? r : 'index.html';
  }

  function signInUrl(redirect) {
    return `signin.html?redirect=${encodeURIComponent(redirect || currentPageHref())}`;
  }

  function signUpUrl(redirect) {
    return `signup.html?redirect=${encodeURIComponent(redirect || currentPageHref())}`;
  }

  function goToSignIn(redirect, message) {
    if (message) flash(message, 'info');
    location.href = signInUrl(redirect);
  }

  // =================================================================
  // LAYOUT: HEADER, BOTTOM NAV, FOOTER
  // =================================================================
  function renderHeader() {
    const slot = byId('app-header');
    if (!slot) return;

    const desktopLinks = NAV_ITEMS.map(item => {
      const active = item.id === activePage;
      const cls = active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900';
      const label = item.showCount ? `${item.long} (<span data-pass-count>0</span>)` : item.long;
      const icon = item.id === 'organizer' ? '<i data-lucide="shield-check" class="w-3.5 h-3.5 text-brand-600"></i>' : '';
      return `<a href="${item.href}" ${active ? 'aria-current="page"' : ''} class="px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 ${cls}">${icon}${label}</a>`;
    }).join('');

    slot.outerHTML = `
      <header class="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm safe-top">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-center justify-between gap-3 h-16 sm:h-20">
            <div class="flex items-center gap-3 sm:gap-4 min-w-0">
              <button type="button" onclick="UI.openModal('modal-logo-info')" aria-label="About the CUVA emblem"
                class="flex-shrink-0 w-11 h-11 sm:w-16 sm:h-16 rounded-2xl bg-white border border-slate-200 shadow-sm p-1 sm:p-1.5 flex items-center justify-center transition-transform hover:scale-105">
                ${LOGO_SVG}
              </button>
              <a href="index.html" class="min-w-0 block">
                <div class="flex items-center gap-2">
                  <span class="text-[10px] sm:text-xs uppercase tracking-widest font-extrabold text-brand-600 bg-brand-50 px-2 sm:px-2.5 py-0.5 rounded-md border border-brand-100 flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-brand-600"></span> CUVA Portal
                  </span>
                  <span class="text-[11px] font-semibold text-slate-400 hidden sm:inline">NUIST Campus</span>
                </div>
                <h1 class="text-[13px] sm:text-xl font-black text-slate-900 tracking-tight leading-tight line-clamp-2 sm:line-clamp-none mt-0.5">College of United Volunteer Association</h1>
                <p class="hidden sm:block text-xs text-slate-500 font-medium">Student Activity Registration &amp; Check-in System</p>
              </a>
            </div>
            <div class="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <nav class="hidden md:flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200" aria-label="Main">${desktopLinks}</nav>
              <div id="auth-actions" class="flex items-center gap-2 min-h-[40px]"></div>
            </div>
          </div>
        </div>
      </header>`;
  }

  function renderBottomNav() {
    const slot = byId('app-bottom-nav');
    if (!slot) return;

    const links = NAV_ITEMS.map(item => {
      const active = item.id === activePage;
      const color = active ? 'text-brand-600' : 'text-slate-500';
      const badge = item.showCount
        ? '<span data-pass-badge class="hidden absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[10px] font-black leading-[18px] text-center">0</span>'
        : '';
      return `
        <a href="${item.href}" ${active ? 'aria-current="page"' : ''} class="relative flex flex-col items-center justify-center gap-1 text-[11px] font-bold ${color} active:bg-slate-100 transition">
          ${active ? '<span class="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-10 bg-brand-600 rounded-b-full"></span>' : ''}
          <span class="relative"><i data-lucide="${item.icon}" class="w-5 h-5"></i>${badge}</span>
          <span>${item.short}</span>
        </a>`;
    }).join('');

    slot.outerHTML = `
      <nav class="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 bottom-nav" aria-label="Main">
        <div class="grid grid-cols-3 h-16">${links}</div>
      </nav>`;
  }

  function renderFooter() {
    const slot = byId('app-footer');
    if (!slot) return;
    slot.outerHTML = `
      <footer class="mt-auto border-t border-slate-200 bg-white py-6 sm:py-8 text-xs text-slate-500">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-2 sm:gap-4 text-center">
          <div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span class="font-extrabold text-slate-900">CUVA</span>
            <span class="hidden sm:inline">•</span>
            <span>College of United Volunteer Association • NUIST</span>
          </div>
          <div class="flex items-center gap-4 text-slate-400">
            <span>Campus Activity Portal</span><span>•</span><span>All times in China Standard Time (UTC+8)</span>
          </div>
        </div>
      </footer>`;
  }

  function renderAuthActions() {
    const container = byId('auth-actions');
    if (!container) return;
    const user = state.user;

    if (user) {
      const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => [...p][0]).join('').toUpperCase() || '?';
      container.innerHTML = `
        <div class="flex items-center gap-2">
          <div class="sm:hidden w-9 h-9 rounded-full bg-brand-50 border border-brand-100 text-brand-700 text-xs font-black flex items-center justify-center" title="${esc(user.name)} • ${esc(user.studentId)}">${esc(initials)}</div>
          <div class="text-right hidden sm:block">
            <p class="text-xs font-bold text-slate-800 leading-tight">${esc(user.name)}</p>
            <p class="text-[10px] font-mono text-slate-400">${esc(user.studentId)} • ${esc(user.grade)}</p>
          </div>
          <button onclick="UI.signOut(this)" title="Log Out" aria-label="Log out"
            class="w-10 h-10 sm:w-auto sm:h-auto sm:px-3 sm:py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1">
            <i data-lucide="log-out" class="w-4 h-4 sm:w-3.5 sm:h-3.5"></i>
            <span class="hidden sm:inline">Logout</span>
          </button>
        </div>`;
    } else {
      container.innerHTML = `
        <div class="flex items-center gap-1.5 sm:gap-2">
          <a href="${signInUrl()}" class="px-3 py-2 sm:py-1.5 text-xs font-bold text-slate-700 hover:text-slate-900 rounded-xl hover:bg-slate-100 border border-slate-200 sm:border-transparent transition">Sign In</a>
          <a href="${signUpUrl()}" class="hidden sm:inline-block px-3.5 py-1.5 text-xs font-bold bg-brand-600 hover:bg-brand-500 text-white rounded-xl shadow-sm transition">Register ID</a>
        </div>`;
    }
    icons();
  }

  function updatePassCounter() {
    const n = state.user ? state.myRegistrations.length : 0;
    document.querySelectorAll('[data-pass-count]').forEach(el => { el.textContent = n; });
    document.querySelectorAll('[data-pass-badge]').forEach(el => {
      el.textContent = n;
      el.classList.toggle('hidden', n === 0);
    });
  }

  async function signOut(button) {
    try {
      await busy(button, () => API.signOut());
    } catch { /* cookie may already be gone; continue */ }
    flash('Logged out successfully.', 'info');
    location.reload();
  }

  // =================================================================
  // LOADING HELPERS
  // =================================================================
  /** Disables a button and shows a spinner while fn() runs. Returns fn's result. */
  async function busy(button, fn) {
    if (!button || button.disabled) return fn();
    const original = button.innerHTML;
    const width = button.offsetWidth;
    button.disabled = true;
    button.style.minWidth = `${width}px`;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = '<span class="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin align-middle"></span>';
    try {
      return await fn();
    } finally {
      button.disabled = false;
      button.style.minWidth = '';
      button.removeAttribute('aria-busy');
      button.innerHTML = original;
      icons();
    }
  }

  /** Grey placeholder cards shown while data loads. */
  function skeletonCards(count = 3) {
    return Array.from({ length: count }, () => `
      <div class="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 animate-pulse space-y-4" aria-hidden="true">
        <div class="h-4 w-24 bg-slate-100 rounded-lg"></div>
        <div class="h-5 w-3/4 bg-slate-200 rounded-lg"></div>
        <div class="space-y-2"><div class="h-3 bg-slate-100 rounded"></div><div class="h-3 w-5/6 bg-slate-100 rounded"></div></div>
        <div class="h-11 bg-slate-100 rounded-xl"></div>
      </div>`).join('');
  }

  /** Standard handling for a failed API call. */
  function handleError(err, redirect) {
    if (err && err.status === 401 && err.code === 'AUTH_REQUIRED') {
      goToSignIn(redirect, 'Your session has ended. Please sign in again.');
      return;
    }
    toast((err && err.message) || 'Something went wrong.', 'error');
  }

  // =================================================================
  // MODALS
  // =================================================================
  function modalShell(id, widthClass, inner, { dismissBackdrop = false, panelClass = 'p-5 sm:p-8' } = {}) {
    return `
      <div id="${id}" ${dismissBackdrop ? 'data-dismiss-backdrop' : ''} class="modal fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm hidden flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true">
        <div class="modal-panel relative bg-white w-full ${widthClass} max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 sheet-safe ${panelClass}">
          <div class="sm:hidden w-10 h-1 rounded-full bg-slate-200 mx-auto -mt-1 mb-3"></div>
          ${inner}
        </div>
      </div>`;
  }

  function openModal(id) {
    const el = byId(id);
    if (!el) return;
    el.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeModal(id) {
    const el = byId(id);
    if (el) el.classList.add('hidden');
    if (!document.querySelector('.modal:not(.hidden)')) document.body.classList.remove('modal-open');
  }

  document.addEventListener('click', e => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('modal') && t.hasAttribute('data-dismiss-backdrop')) closeModal(t.id);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = document.querySelectorAll('.modal:not(.hidden)');
    if (open.length) closeModal(open[open.length - 1].id);
  });

  function closeButton(modalId) {
    return `
      <button type="button" onclick="UI.closeModal('${modalId}')" aria-label="Close"
        class="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition">
        <i data-lucide="x" class="w-4 h-4"></i>
      </button>`;
  }

  function ensureLogoModal() {
    if (byId('modal-logo-info')) return;
    document.body.insertAdjacentHTML('beforeend', modalShell('modal-logo-info', 'sm:max-w-sm', `
      ${closeButton('modal-logo-info')}
      <div class="space-y-4">
        <div class="w-20 h-20 rounded-2xl bg-white border border-slate-200 shadow-sm p-2 flex items-center justify-center mx-auto">${LOGO_SVG}</div>
        <div class="text-center">
          <h4 class="font-black text-slate-900 text-base">CUVA Official Identity</h4>
          <p class="text-xs text-slate-500 mt-1">College of United Volunteer Association emblem featuring the signature warm red heart, peaceful dove hand, and multi-colored waves representing united students.</p>
        </div>
        <button onclick="UI.closeModal('modal-logo-info')" class="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm sm:text-xs rounded-xl transition">Got it</button>
      </div>`, { dismissBackdrop: true, panelClass: 'p-6' }));
  }

  // ---------- Confirm dialog (callback may be async) ----------
  let pendingConfirm = null;

  function ensureConfirmDialog() {
    if (byId('modal-confirm')) return;
    document.body.insertAdjacentHTML('beforeend', modalShell('modal-confirm', 'sm:max-w-sm', `
      <div class="space-y-4">
        <div class="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto"><i data-lucide="triangle-alert" class="w-6 h-6"></i></div>
        <div class="text-center space-y-1">
          <h4 id="confirm-title" class="font-black text-slate-900 text-base">Confirm Action</h4>
          <p id="confirm-desc" class="text-xs text-slate-500">Are you sure you want to proceed?</p>
        </div>
        <div class="grid grid-cols-2 gap-2 pt-2">
          <button type="button" onclick="UI.closeConfirm()" class="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm sm:text-xs rounded-xl transition">Cancel</button>
          <button id="confirm-btn-action" type="button" class="py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm sm:text-xs rounded-xl shadow-md transition">Confirm</button>
        </div>
      </div>`, { panelClass: 'p-6' }));
    icons();
  }

  function confirmDialog(title, message, onConfirm) {
    ensureConfirmDialog();
    byId('confirm-title').textContent = title;
    byId('confirm-desc').textContent = message;
    pendingConfirm = onConfirm;
    const btn = byId('confirm-btn-action');
    btn.onclick = async () => {
      const fn = pendingConfirm;
      if (!fn) return closeConfirm();
      try {
        await busy(btn, () => fn());
      } finally {
        closeConfirm();
      }
    };
    openModal('modal-confirm');
  }

  function closeConfirm() {
    closeModal('modal-confirm');
    pendingConfirm = null;
  }

  // ---------- Prompt dialog (callback may be async) ----------
  let pendingPrompt = null;

  function ensurePromptDialog() {
    if (byId('modal-prompt')) return;
    document.body.insertAdjacentHTML('beforeend', modalShell('modal-prompt', 'sm:max-w-sm', `
      <form id="prompt-form" class="space-y-4">
        <div class="space-y-1">
          <h4 id="prompt-title" class="font-black text-slate-900 text-base">Edit Value</h4>
          <p id="prompt-desc" class="text-xs text-slate-500">Please provide a new value:</p>
        </div>
        <input type="text" id="prompt-input" maxlength="40" class="w-full px-3.5 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-slate-50 text-xs font-medium">
        <div class="grid grid-cols-2 gap-2 pt-1">
          <button type="button" onclick="UI.closePrompt()" class="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm sm:text-xs rounded-xl transition">Cancel</button>
          <button type="submit" id="prompt-btn-save" class="py-3 bg-brand-600 hover:bg-brand-500 text-white font-bold text-sm sm:text-xs rounded-xl shadow-md transition">Save</button>
        </div>
      </form>`, { panelClass: 'p-6' }));

    byId('prompt-form').addEventListener('submit', async e => {
      e.preventDefault();
      const val = byId('prompt-input').value.trim();
      const fn = pendingPrompt;
      if (!val || !fn) return closePrompt();
      try {
        await busy(byId('prompt-btn-save'), () => fn(val));
      } finally {
        closePrompt();
      }
    });
  }

  function promptDialog(title, desc, defaultValue, onSave) {
    ensurePromptDialog();
    byId('prompt-title').textContent = title;
    byId('prompt-desc').textContent = desc;
    const input = byId('prompt-input');
    input.value = defaultValue || '';
    pendingPrompt = onSave;
    openModal('modal-prompt');
    setTimeout(() => input.focus(), 100);
  }

  function closePrompt() {
    closeModal('modal-prompt');
    pendingPrompt = null;
  }

  // ---------- QR entry pass ----------
  function ensurePassModal() {
    if (byId('modal-pass')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="modal-pass" data-dismiss-backdrop class="modal fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm hidden flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true">
        <div class="modal-panel relative bg-white w-full sm:max-w-sm max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100">
          <button onclick="UI.closeModal('modal-pass')" aria-label="Close" class="absolute top-4 right-4 z-10 w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
          <div class="cuva-gradient-bg p-6 text-white text-center relative overflow-hidden">
            <div class="absolute -right-10 -bottom-10 w-32 h-32 rounded-full bg-brand-600/30 blur-xl"></div>
            <div class="flex items-center justify-center gap-2 mb-2">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span class="text-[10px] font-black uppercase tracking-widest text-rose-200">Official Entry Pass</span>
            </div>
            <h3 id="pass-event-title" class="text-base font-black leading-tight text-white mb-1 px-6"></h3>
            <span id="pass-event-category" class="inline-block px-2.5 py-0.5 rounded-full bg-white/20 text-[10px] font-bold"></span>
          </div>
          <div class="p-5 sm:p-6 space-y-5 text-center sheet-safe">
            <div class="flex flex-col items-center justify-center space-y-2">
              <div id="pass-qrcode" class="p-3 bg-white border border-slate-200 rounded-2xl shadow-inner flex items-center justify-center"></div>
              <span id="pass-token-display" class="font-mono text-sm sm:text-xs font-black text-slate-700 tracking-wider break-all"></span>
            </div>
            <div class="ticket-dashed-border"></div>
            <div class="space-y-2 text-left text-xs bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
              <div class="flex justify-between gap-3"><span class="text-slate-400 font-medium flex-shrink-0">Attendee:</span><span id="pass-student-name" class="font-bold text-slate-800 text-right break-words min-w-0"></span></div>
              <div class="flex justify-between gap-3"><span class="text-slate-400 font-medium flex-shrink-0">Student ID:</span><span id="pass-student-id" class="font-mono font-bold text-slate-800 text-right"></span></div>
              <div class="flex justify-between gap-3"><span class="text-slate-400 font-medium flex-shrink-0">WeChat:</span><span id="pass-wechat" class="font-medium text-slate-700 text-right break-all"></span></div>
              <div class="flex justify-between gap-3"><span class="text-slate-400 font-medium flex-shrink-0">Schedule:</span><span id="pass-event-time" class="font-medium text-slate-700 text-right"></span></div>
              <div class="flex justify-between gap-3"><span class="text-slate-400 font-medium flex-shrink-0">Location:</span><span id="pass-event-venue" class="font-medium text-slate-700 text-right break-words min-w-0"></span></div>
              <div id="pass-status-row" class="flex justify-between gap-3"><span class="text-slate-400 font-medium flex-shrink-0">Door status:</span><span id="pass-status" class="font-bold text-right"></span></div>
              <div id="pass-cert-row" class="flex justify-between gap-3 text-emerald-700 font-bold pt-1 border-t border-slate-200">
                <span>Certificate:</span><span class="text-right">Participation Certificate Eligible</span>
              </div>
            </div>
            <p class="text-[10px] text-slate-400">Please have this QR ticket ready upon entering the venue for rapid check-in.</p>
            <button onclick="UI.closeModal('modal-pass')" class="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm sm:text-xs rounded-xl transition">Done</button>
          </div>
        </div>
      </div>`);
  }

  /** Shows the QR ticket. All values set with textContent (safe for user text). */
  function openPass(registration, event, student) {
    ensurePassModal();

    byId('pass-event-title').textContent = event.title;
    byId('pass-event-category').textContent = event.category;
    byId('pass-token-display').textContent = registration.token;
    byId('pass-student-name').textContent = student.name;
    byId('pass-student-id').textContent = student.studentId;
    byId('pass-wechat').textContent = student.wechat;
    byId('pass-event-time').textContent = `${fmtFullDate(event.startTime)} ${fmtTime(event.startTime)} - ${fmtTime(event.endTime)}`;
    byId('pass-event-venue').textContent = event.venue;
    byId('pass-cert-row').style.display = event.hasCertificate ? 'flex' : 'none';

    const checkedIn = registration.status === 'CHECKED_IN';
    const statusEl = byId('pass-status');
    statusEl.textContent = checkedIn ? 'Checked In' : 'Not yet checked in';
    statusEl.className = `font-bold text-right ${checkedIn ? 'text-emerald-700' : 'text-amber-700'}`;

    const qr = byId('pass-qrcode');
    qr.innerHTML = '';
    try {
      new QRCode(qr, {
        text: registration.token,
        width: 160,
        height: 160,
        colorDark: '#1e1b4b',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch {
      qr.textContent = registration.token;
    }

    icons();
    openModal('modal-pass');
  }

  // =================================================================
  // TOASTS
  // =================================================================
  function ensureToastContainer() {
    if (byId('toast-container')) return;
    document.body.insertAdjacentHTML('beforeend', '<div id="toast-container" class="toast-stack" aria-live="polite"></div>');
  }

  function toast(message, type = 'info') {
    ensureToastContainer();
    const container = byId('toast-container');

    let icon = 'info';
    let colors = 'bg-slate-900 text-white border border-slate-800';
    if (type === 'success') {
      icon = 'circle-check';
      colors = 'bg-emerald-900/95 text-emerald-100 border border-emerald-700 backdrop-blur-md';
    } else if (type === 'error') {
      icon = 'circle-alert';
      colors = 'bg-rose-900/95 text-rose-100 border border-rose-700 backdrop-blur-md';
    }

    const el = document.createElement('div');
    el.className = `flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl text-xs font-bold pointer-events-auto transition-all duration-300 transform translate-y-2 opacity-0 ${colors}`;
    el.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4 flex-shrink-0"></i> <span></span>`;
    el.querySelector('span').textContent = message;
    container.appendChild(el);
    icons();

    setTimeout(() => el.classList.remove('translate-y-2', 'opacity-0'), 50);
    setTimeout(() => {
      el.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  function flash(message, type = 'info') {
    try { sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, type })); } catch { /* ignore */ }
  }

  function consumeFlash() {
    try {
      const raw = sessionStorage.getItem(FLASH_KEY);
      if (!raw) return;
      sessionStorage.removeItem(FLASH_KEY);
      const { message, type } = JSON.parse(raw);
      if (message) toast(message, type);
    } catch { /* ignore */ }
  }

  // =================================================================
  // PAGE BOOT
  // =================================================================
  /**
   * Call once at the start of each page script (await it).
   * page: 'explore' | 'passes' | 'organizer' | null
   */
  async function init(page) {
    activePage = page;
    document.body.classList.add('has-bottom-nav');
    renderHeader();
    renderBottomNav();
    renderFooter();
    ensureLogoModal();
    ensureToastContainer();
    consumeFlash();
    icons();

    try {
      const session = await API.session();
      state.user = session.user;
      state.superAdminId = session.superAdminId || '';
      if (state.user) {
        state.myRegistrations = (await API.myRegistrations()).registrations;
      }
    } catch (err) {
      toast(err.message || 'Could not reach the server.', 'error');
    }

    document.querySelectorAll('[data-super-admin-id]').forEach(el => { el.textContent = state.superAdminId; });
    renderAuthActions();
    updatePassCounter();
    icons();
  }

  return {
    init, state, icons, esc,

    // time
    fmt, fmtDate, fmtTime, fmtShort, fmtDateTime, fmtFullDate, formatSimpleDate, toInputValue, fromInputValue,

    // redirects
    redirectTarget, signInUrl, signUpUrl, goToSignIn,

    // header
    renderAuthActions, updatePassCounter, signOut,

    // loading & errors
    busy, skeletonCards, handleError,

    // modals
    openModal, closeModal,
    confirm: confirmDialog, closeConfirm,
    prompt: promptDialog, closePrompt,
    openPass,

    // toasts
    toast, flash
  };
})();
