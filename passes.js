/* =====================================================================
 * My Entry Passes page (passes.html)
 * Lists the signed-in student's registrations with their QR passes.
 * ===================================================================== */
const Page = (() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const esc = UI.esc;

  function renderSignedOut(container) {
    container.innerHTML = `
      <div class="col-span-full py-14 sm:py-16 text-center space-y-4 bg-white rounded-3xl border border-dashed border-slate-200 p-6">
        <div class="w-12 h-12 mx-auto rounded-full bg-brand-50 text-brand-600 flex items-center justify-center"><i data-lucide="lock" class="w-6 h-6"></i></div>
        <h3 class="font-bold text-slate-800 text-sm">Sign in to view your activity passes</h3>
        <p class="text-xs text-slate-400 max-w-sm mx-auto">All your verified CUVA registrations and entrance QR tickets are stored securely in your student profile.</p>
        <a href="${UI.signInUrl('passes.html')}" class="inline-block w-full sm:w-auto px-5 py-3 sm:py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-bold text-sm sm:text-xs rounded-xl shadow-sm transition">Student Sign In</a>
      </div>`;
  }

  function renderEmpty(container) {
    container.innerHTML = `
      <div class="col-span-full py-14 sm:py-16 text-center space-y-3 bg-white rounded-3xl border border-dashed border-slate-200 p-6">
        <div class="w-12 h-12 mx-auto rounded-full bg-slate-100 text-slate-400 flex items-center justify-center"><i data-lucide="ticket" class="w-6 h-6"></i></div>
        <p class="font-bold text-slate-700 text-sm">No activity registrations yet</p>
        <p class="text-xs text-slate-400">Browse campus board games, debates, and activities to secure your spot.</p>
        <a href="index.html" class="inline-block w-full sm:w-auto px-4 py-3 sm:py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold text-sm sm:text-xs rounded-xl transition">Browse Activities</a>
      </div>`;
  }

  function render() {
    const container = byId('my-passes-grid');

    if (!UI.state.user) {
      renderSignedOut(container);
      UI.icons();
      return;
    }

    const regs = UI.state.myRegistrations;
    if (regs.length === 0) {
      renderEmpty(container);
      UI.icons();
      return;
    }

    container.innerHTML = regs.map(reg => {
      const ev = reg.event;
      const checkedIn = reg.status === 'CHECKED_IN';

      if (!ev) {
        return `
          <article class="bg-white rounded-3xl p-5 sm:p-6 border border-dashed border-slate-200 text-xs text-slate-500 space-y-1">
            <p class="font-bold text-slate-700 text-sm">Archived Activity</p>
            <p>This activity was cancelled by the organizers.</p>
            <p class="font-mono text-[11px] break-all">${esc(reg.token)}</p>
          </article>`;
      }

      return `
        <article class="bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-sm flex flex-col justify-between gap-4">
          <div class="flex justify-between items-start gap-3">
            <div class="min-w-0">
              <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-brand-50 text-brand-700">${esc(ev.category)}</span>
              <h4 class="font-black text-slate-900 text-base mt-1 leading-snug break-words">${esc(ev.title)}</h4>
            </div>
            <span class="flex-shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${checkedIn ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${checkedIn ? 'Checked In' : 'Confirmed'}</span>
          </div>

          <div class="space-y-1.5 text-xs text-slate-600">
            <div class="flex items-start gap-2"><i data-lucide="calendar" class="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0"></i><span>${esc(UI.fmtDate(ev.startTime))} • ${esc(UI.fmtTime(ev.startTime))} - ${esc(UI.fmtTime(ev.endTime))}</span></div>
            <div class="flex items-start gap-2"><i data-lucide="map-pin" class="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0"></i><span class="break-words min-w-0">${esc(ev.venue)}</span></div>
            <div class="flex items-start gap-2"><i data-lucide="hash" class="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0"></i><span class="font-mono text-[11px] text-slate-500 font-bold break-all">${esc(reg.token)}</span></div>
          </div>

          <button onclick="Page.viewPass(${reg.id})" class="w-full py-3 sm:py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm sm:text-xs rounded-xl transition flex items-center justify-center gap-1.5">
            <i data-lucide="qr-code" class="w-4 h-4"></i> View Entry QR Pass
          </button>
        </article>`;
    }).join('');

    UI.icons();
  }

  function viewPass(registrationId) {
    const reg = UI.state.myRegistrations.find(r => r.id === registrationId);
    if (reg && reg.event) UI.openPass(reg, reg.event, UI.state.user);
  }

  async function init() {
    byId('my-passes-grid').innerHTML = UI.skeletonCards(2);
    await UI.init('passes');
    render();

    // Refresh status (e.g. "Checked In") when the student returns to the app
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden || !UI.state.user) return;
      try {
        UI.state.myRegistrations = (await API.myRegistrations()).registrations;
        UI.updatePassCounter();
        render();
      } catch { /* keep last data */ }
    });
  }

  return { init, viewPass };
})();

Page.init();
