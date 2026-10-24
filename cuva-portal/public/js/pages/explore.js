/* =====================================================================
 * Discover page (index.html)
 * Hero with the earliest upcoming activity, category filter, search,
 * activity cards and one-tap registration (rules enforced by the server).
 * ===================================================================== */
const Page = (() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const esc = UI.esc;

  let events = [];
  let categories = [];
  let selectedCategory = 'All';

  // ---------- Status (display only — the server makes the final decision) ----------
  function getRegistrationStatus(event) {
    const now = Date.now();
    if (now < Date.parse(event.regOpenTime))   return { canRegister: false, code: 'NOT_STARTED', label: `Opens ${UI.fmtDateTime(event.regOpenTime)}` };
    if (now > Date.parse(event.regCloseTime))  return { canRegister: false, code: 'CLOSED', label: 'Registration Closed (Time Expired)' };
    if (event.registeredCount >= event.quota)  return { canRegister: false, code: 'FULL', label: 'Activity Full (Limit Reached)' };
    return { canRegister: true, code: 'OPEN', label: 'Register Now' };
  }

  function myRegistrationFor(eventId) {
    return UI.state.myRegistrations.find(r => r.eventId === eventId) || null;
  }

  function renderRegisterButton(event, status, isRegistered, context = 'card') {
    const width = context === 'hero' ? 'w-full lg:w-auto' : 'w-full';

    if (isRegistered) {
      return `
        <button onclick="Page.viewPass(${event.id})" class="px-5 py-3 sm:py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm sm:text-xs rounded-xl shadow-md transition flex items-center justify-center gap-1.5 ${width}">
          <i data-lucide="ticket" class="w-4 h-4"></i> Registered • View Pass
        </button>`;
    }

    if (!status.canRegister) {
      const colors = context === 'card' ? 'bg-slate-100 text-slate-400 border border-slate-200' : 'bg-slate-700 text-slate-300';
      return `<button disabled class="px-4 py-3 sm:py-2.5 ${colors} font-bold text-sm sm:text-xs rounded-xl cursor-not-allowed ${width}">${esc(status.label)}</button>`;
    }

    const btnClass = context === 'hero'
      ? 'px-6 py-3.5 sm:py-3 bg-brand-500 hover:bg-brand-400 text-white font-black text-sm rounded-xl shadow-lg transition flex items-center justify-center gap-2'
      : 'px-4 py-3 sm:py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-bold text-sm sm:text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-1.5';

    return `
      <button onclick="Page.register(${event.id}, this)" class="${btnClass} ${width}">
        <i data-lucide="circle-check" class="w-4 h-4"></i> Register Now
      </button>`;
  }

  // ---------- Hero ----------
  function renderHero() {
    const hero = byId('hero-content');
    const now = Date.now();
    const upcoming = events
      .filter(ev => Date.parse(ev.endTime) > now)
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

    if (upcoming.length === 0) {
      hero.innerHTML = `
        <div class="space-y-2">
          <span class="inline-block px-2.5 py-1 bg-white/10 rounded-full text-[11px] font-bold uppercase tracking-wider text-rose-200">CUVA Campus Hub</span>
          <h2 class="text-xl sm:text-3xl font-black">No Upcoming Activities Scheduled</h2>
          <p class="text-sm text-slate-300">Check back soon! CUVA organizers are preparing fresh campus game nights and debate sessions.</p>
        </div>`;
      return;
    }

    const ev = upcoming[0];
    const status = getRegistrationStatus(ev);
    const seatsLeft = Math.max(0, ev.quota - ev.registeredCount);

    hero.innerHTML = `
      <div class="space-y-3 max-w-2xl min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="px-3 py-1 rounded-full bg-brand-600/30 text-rose-200 border border-brand-500/40 text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span> Earliest Upcoming Activity
          </span>
          <span class="px-2.5 py-0.5 rounded-full bg-white/10 text-white text-[11px] font-semibold">${esc(ev.category)}</span>
          ${ev.hasCertificate ? '<span class="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold flex items-center gap-1"><i data-lucide="award" class="w-3 h-3 text-amber-400"></i> Certificate Awarded</span>' : ''}
        </div>
        <h2 class="text-xl sm:text-3xl font-black tracking-tight leading-tight break-words">${esc(ev.title)}</h2>
        <p class="text-sm text-slate-300 line-clamp-3 sm:line-clamp-2 break-words">${esc(ev.desc)}</p>
        <div class="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-4 text-xs sm:text-sm text-slate-300 pt-1">
          <span class="flex items-center gap-1.5"><i data-lucide="calendar" class="w-4 h-4 text-brand-400 flex-shrink-0"></i> ${esc(UI.fmtDate(ev.startTime))} at ${esc(UI.fmtTime(ev.startTime))}</span>
          <span class="flex items-center gap-1.5 min-w-0"><i data-lucide="map-pin" class="w-4 h-4 text-brand-400 flex-shrink-0"></i> <span class="break-words min-w-0">${esc(ev.venue)}</span></span>
          <span class="flex items-center gap-1.5"><i data-lucide="users" class="w-4 h-4 text-brand-400 flex-shrink-0"></i> ${seatsLeft} spots left (${ev.registeredCount}/${ev.quota})</span>
        </div>
      </div>
      <div class="flex flex-col items-stretch lg:items-end gap-3 w-full lg:w-auto">
        ${renderRegisterButton(ev, status, !!myRegistrationFor(ev.id), 'hero')}
      </div>`;
    UI.icons();
  }

  // ---------- Category pills ----------
  function allCategories() {
    return ['All', ...categories];
  }

  function renderCategoryPills() {
    byId('category-pills').innerHTML = allCategories().map((cat, i) => {
      const active = selectedCategory === cat;
      const cls = active ? 'bg-slate-900 text-white font-extrabold shadow-sm' : 'bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold';
      return `<button onclick="Page.setCategory(${i})" class="flex-shrink-0 px-3.5 py-2 sm:py-1.5 rounded-xl text-xs whitespace-nowrap transition ${cls}">${esc(cat)}</button>`;
    }).join('');
  }

  function setCategory(index) {
    selectedCategory = allCategories()[index] || 'All';
    renderCategoryPills();
    renderActivities();
  }

  // ---------- Activity cards ----------
  function renderActivities() {
    const grid = byId('activities-grid');
    const query = (byId('search-activity-input').value || '').toLowerCase();

    const filtered = events
      .filter(ev => (selectedCategory === 'All' || ev.category === selectedCategory) &&
                    (ev.title.toLowerCase().includes(query) || ev.venue.toLowerCase().includes(query)))
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

    byId('activity-counter-badge').textContent = `${filtered.length} Activities`;

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full py-14 sm:py-16 px-6 text-center space-y-3 bg-white rounded-3xl border border-dashed border-slate-200">
          <div class="w-12 h-12 mx-auto rounded-full bg-slate-100 text-slate-400 flex items-center justify-center"><i data-lucide="inbox" class="w-6 h-6"></i></div>
          <p class="text-sm font-bold text-slate-700">No campus activities match your criteria</p>
          <p class="text-xs text-slate-400">Try adjusting your category filter or search keywords.</p>
        </div>`;
      UI.icons();
      return;
    }

    grid.innerHTML = filtered.map(ev => {
      const status = getRegistrationStatus(ev);
      const count = ev.registeredCount;
      const seatsLeft = Math.max(0, ev.quota - count);

      return `
        <article class="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-sm hover:shadow-md transition flex flex-col justify-between gap-5">
          <div class="space-y-3">
            <div class="flex items-center justify-between gap-2">
              <span class="px-2.5 py-1 rounded-xl bg-brand-50 text-brand-700 font-extrabold text-[11px] truncate">${esc(ev.category)}</span>
              ${ev.hasCertificate ? '<span class="flex-shrink-0 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-600 font-bold text-[10px] flex items-center gap-1 border border-emerald-100"><i data-lucide="award" class="w-3 h-3"></i> Certificate</span>' : ''}
            </div>
            <h3 class="font-black text-slate-900 text-base leading-snug break-words">${esc(ev.title)}</h3>
            <p class="text-sm sm:text-xs text-slate-500 line-clamp-3 leading-relaxed break-words">${esc(ev.desc)}</p>
          </div>

          <div class="space-y-4 pt-3 border-t border-slate-100 text-xs">
            <div class="space-y-1.5 text-slate-600">
              <div class="flex items-start gap-2"><i data-lucide="clock" class="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0"></i><span>${esc(UI.fmtDate(ev.startTime))} • ${esc(UI.fmtTime(ev.startTime))} - ${esc(UI.fmtTime(ev.endTime))}</span></div>
              <div class="flex items-start gap-2"><i data-lucide="map-pin" class="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0"></i><span class="break-words min-w-0">${esc(ev.venue)}</span></div>
              <div class="flex items-start gap-2"><i data-lucide="calendar-range" class="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0"></i><span class="text-[11px] text-slate-500">Reg: ${esc(UI.fmtDateTime(ev.regOpenTime))} - ${esc(UI.fmtDateTime(ev.regCloseTime))}</span></div>
            </div>
            <div>
              <div class="flex justify-between text-[11px] font-bold mb-1">
                <span class="text-slate-500">${count} students registered</span>
                <span class="${seatsLeft <= 5 ? 'text-amber-600' : 'text-slate-700'}">${seatsLeft} spots left</span>
              </div>
              <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div class="bg-brand-600 h-1.5 rounded-full" style="width: ${Math.min(100, (count / ev.quota) * 100)}%"></div>
              </div>
            </div>
            <div class="pt-1">${renderRegisterButton(ev, status, !!myRegistrationFor(ev.id), 'card')}</div>
          </div>
        </article>`;
    }).join('');

    UI.icons();
  }

  function renderAll() {
    renderHero();
    renderCategoryPills();
    renderActivities();
  }

  // ---------- Data ----------
  async function load() {
    const [e, c] = await Promise.all([API.events(), API.categories()]);
    events = e.events;
    categories = c.categories.map(x => x.name);
    if (selectedCategory !== 'All' && !categories.includes(selectedCategory)) selectedCategory = 'All';
  }

  async function refresh() {
    try {
      await load();
      renderAll();
    } catch { /* keep showing last data */ }
  }

  function upsertEvent(event) {
    const i = events.findIndex(e => e.id === event.id);
    if (i >= 0) events[i] = event; else events.push(event);
  }

  // ---------- Actions ----------
  async function register(eventId, button) {
    if (!UI.state.user) {
      UI.goToSignIn('index.html', 'Please sign in or create your student profile first.');
      return;
    }

    try {
      const { registration, event } = await UI.busy(button, () => API.register(eventId));
      UI.state.myRegistrations.unshift({ ...registration, event });
      upsertEvent(event);
      UI.updatePassCounter();
      renderHero();
      renderActivities();
      UI.toast(`Registered successfully for ${event.title}!`, 'success');
      UI.openPass(registration, event, UI.state.user);
    } catch (err) {
      if (err.code === 'ALREADY' && err.data.registration) {
        UI.toast('You are already registered for this activity!', 'info');
        UI.state.myRegistrations.unshift({ ...err.data.registration, event: err.data.event });
        UI.updatePassCounter();
        renderAll();
        UI.openPass(err.data.registration, err.data.event, UI.state.user);
        return;
      }
      UI.handleError(err, 'index.html');
      await refresh(); // seat counts / windows may have changed
    }
  }

  function viewPass(eventId) {
    const reg = myRegistrationFor(eventId);
    const ev = events.find(e => e.id === eventId) || (reg && reg.event);
    if (reg && ev) UI.openPass(reg, ev, UI.state.user);
  }

  // ---------- Boot ----------
  async function init() {
    byId('activities-grid').innerHTML = UI.skeletonCards(3);
    await UI.init('explore');

    try {
      await load();
    } catch (err) {
      UI.handleError(err);
      byId('hero-content').innerHTML = '<p class="text-sm text-slate-300">Could not load activities. Please refresh the page or try again shortly.</p>';
      byId('activities-grid').innerHTML = '';
      return;
    }
    renderAll();

    setInterval(() => { renderHero(); renderActivities(); }, 30_000); // registration windows open/close
    setInterval(refresh, 120_000);                                     // seat counts from other students
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  return { init, setCategory, renderActivities, register, viewPass };
})();

Page.init();
