/* =====================================================================
 * Organizer Desk page (organizer.html)
 * Access guard, Super Admin permissions, door check-in, activity CRUD,
 * roster with check-in, CSV export, category manager.
 * The server re-checks every permission; the guard here is only UI.
 * ===================================================================== */
const Page = (() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const esc = UI.esc;

  let events = [];
  let categories = [];   // [{ id, name }]
  let roster = [];

  // =================================================================
  // ACCESS GUARD & LOADING
  // =================================================================
  function showGuard() {
    byId('organizer-guard-notice').classList.remove('hidden');
    byId('organizer-main-content').classList.add('hidden');
    byId('organizer-loading').classList.add('hidden');
    UI.icons();
  }

  /** Handles API errors; falls back to the guard if access was lost. */
  function fail(err) {
    if (err && (err.status === 401 || err.status === 403)) {
      UI.toast(err.message, 'error');
      if (err.status === 401) return UI.goToSignIn('organizer.html', 'Your session has ended. Please sign in again.');
      return showGuard();
    }
    UI.handleError(err, 'organizer.html');
  }

  async function loadEvents() {
    events = (await API.events()).events;
  }

  async function loadCategories() {
    categories = (await API.categories()).categories;
  }

  async function loadRoster() {
    const filterId = byId('admin-event-filter').value;
    roster = (await API.roster(filterId === 'all' ? null : filterId)).registrations;
  }

  // =================================================================
  // SUPER ADMIN: ORGANIZER PERMISSIONS
  // =================================================================
  function renderOrganizerList(organizers) {
    byId('superadmin-authorized-count').textContent = `${organizers.length} Authorized Organizers`;

    byId('authorized-ids-list').innerHTML = organizers.map(o => `
      <div class="flex items-center justify-between gap-2 p-3 sm:p-2.5 rounded-xl bg-white/10 border border-white/10 text-xs">
        <div class="flex items-center gap-2 min-w-0">
          <span class="w-2 h-2 flex-shrink-0 rounded-full ${o.isRoot ? 'bg-amber-400' : 'bg-emerald-400'}"></span>
          <div class="min-w-0">
            <span class="font-mono font-bold text-white">${esc(o.studentId)}</span>
            <span class="text-[10px] text-rose-200 block truncate">${esc(o.name || 'Unregistered Account')} ${o.isRoot ? '(Root Super Admin)' : ''}</span>
          </div>
        </div>
        ${o.isRoot
          ? '<span class="flex-shrink-0 px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 font-black border border-amber-500/40">ROOT</span>'
          : `<button data-id="${esc(o.studentId)}" onclick="Page.revokeOrganizer(this.dataset.id)" title="Revoke Organizer Access" aria-label="Revoke organizer access"
               class="flex-shrink-0 w-9 h-9 flex items-center justify-center hover:bg-rose-900/60 rounded-lg text-rose-300 hover:text-white transition">
               <i data-lucide="user-minus" class="w-4 h-4"></i>
             </button>`}
      </div>`).join('');

    UI.icons();
  }

  async function grantOrganizer(button) {
    const input = byId('sa-grant-id-input');
    const id = (input.value || '').trim();
    if (!/^\d{6,16}$/.test(id)) {
      UI.toast('Please enter a valid Student ID (6–16 digits).', 'error');
      return;
    }
    try {
      const { organizers } = await UI.busy(button, () => API.addOrganizer(id));
      input.value = '';
      renderOrganizerList(organizers);
      UI.toast(`Privilege granted: Student ID ${id} can now access the Organizer Desk.`, 'success');
    } catch (err) {
      if (err.status === 409) return UI.toast(err.message, 'info');
      fail(err);
    }
  }

  function revokeOrganizer(id) {
    UI.confirm(
      'Revoke Organizer Privileges',
      `Are you sure you want to remove organizer privileges from Student ID ${id}? They will no longer be able to access this desk.`,
      async () => {
        try {
          const { organizers } = await API.removeOrganizer(id);
          renderOrganizerList(organizers);
          UI.toast(`Revoked organizer access for ${id}.`, 'info');
        } catch (err) {
          fail(err);
        }
      }
    );
  }

  // =================================================================
  // ACTIVITIES (table on desktop, cards on phone)
  // =================================================================
  const scheduleText = ev => `${UI.fmtShort(ev.startTime)} ${UI.fmtTime(ev.startTime)} - ${UI.fmtTime(ev.endTime)}`;
  const regWindowText = ev => `${UI.fmtShort(ev.regOpenTime)} to ${UI.fmtShort(ev.regCloseTime)}`;
  const certBadge = ev => ev.hasCertificate
    ? '<span class="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold text-[10px]">Yes</span>'
    : '<span class="text-slate-400">No</span>';

  function eventActions(ev, size = 'sm') {
    const btn = size === 'lg' ? 'w-10 h-10' : 'w-8 h-8';
    return `
      <div class="flex items-center justify-end gap-1.5 flex-shrink-0">
        <button onclick="Page.openEditor(${ev.id})" title="Edit Schedule / Info" aria-label="Edit activity"
          class="${btn} flex items-center justify-center hover:bg-slate-100 rounded-lg text-slate-600 hover:text-brand-600 transition">
          <i data-lucide="pen-line" class="w-4 h-4"></i>
        </button>
        <button onclick="Page.deleteEvent(${ev.id})" title="Cancel Activity" aria-label="Delete activity"
          class="${btn} flex items-center justify-center hover:bg-rose-50 rounded-lg text-slate-400 hover:text-rose-600 transition">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>`;
  }

  function renderEvents() {
    byId('admin-event-count').textContent = `${events.length} Activities`;
    const emptyMsg = 'No activities yet. Tap "Create Activity" to publish one.';

    byId('admin-events-list-body').innerHTML = events.length === 0
      ? `<tr><td colspan="6" class="py-8 text-center text-slate-400 italic">${emptyMsg}</td></tr>`
      : events.map(ev => `
          <tr class="hover:bg-slate-50/80 transition">
            <td class="py-3 px-4">
              <p class="font-bold text-slate-900">${esc(ev.title)}</p>
              <span class="text-[10px] text-brand-600 font-semibold">${esc(ev.category)} • ${esc(ev.venue)}</span>
            </td>
            <td class="py-3 px-4 font-medium text-slate-600 whitespace-nowrap">${esc(scheduleText(ev))}</td>
            <td class="py-3 px-4 text-slate-500 whitespace-nowrap">${esc(regWindowText(ev))}</td>
            <td class="py-3 px-4"><span class="font-bold ${ev.registeredCount >= ev.quota ? 'text-rose-600' : 'text-slate-800'}">${ev.registeredCount} / ${ev.quota}</span></td>
            <td class="py-3 px-4">${certBadge(ev)}</td>
            <td class="py-3 px-4 text-right">${eventActions(ev)}</td>
          </tr>`).join('');

    byId('admin-events-cards').innerHTML = events.length === 0
      ? `<p class="col-span-full py-8 text-center text-slate-400 italic text-xs">${emptyMsg}</p>`
      : events.map(ev => `
          <article class="p-4 rounded-2xl border border-slate-200 bg-slate-50/40 space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-bold text-slate-900 text-sm leading-snug break-words">${esc(ev.title)}</p>
                <p class="text-[11px] text-brand-600 font-semibold mt-0.5 break-words">${esc(ev.category)} • ${esc(ev.venue)}</p>
              </div>
              ${eventActions(ev, 'lg')}
            </div>
            <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
              <div><dt class="text-slate-400 uppercase font-semibold text-[10px]">Schedule</dt><dd class="font-medium text-slate-700">${esc(scheduleText(ev))}</dd></div>
              <div><dt class="text-slate-400 uppercase font-semibold text-[10px]">Registration</dt><dd class="text-slate-600">${esc(regWindowText(ev))}</dd></div>
              <div><dt class="text-slate-400 uppercase font-semibold text-[10px]">Quota</dt><dd class="font-bold ${ev.registeredCount >= ev.quota ? 'text-rose-600' : 'text-slate-800'}">${ev.registeredCount} / ${ev.quota}</dd></div>
              <div><dt class="text-slate-400 uppercase font-semibold text-[10px]">Certificate</dt><dd>${certBadge(ev)}</dd></div>
            </dl>
          </article>`).join('');

    populateDoorEvents();

    // Roster filter dropdown
    const filter = byId('admin-event-filter');
    const current = filter.value;
    filter.innerHTML = `<option value="all">All Activities (Master Roster)</option>` +
      events.map(e => `<option value="${e.id}">${esc(e.title)}</option>`).join('');
    filter.value = events.some(e => String(e.id) === current) ? current : 'all';

    UI.icons();
  }

  // =================================================================
  // ROSTER & CHECK-IN
  // =================================================================
  function statusPill(checkedIn) {
    return `<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${checkedIn ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">${checkedIn ? 'Checked In' : 'Pending Door'}</span>`;
  }

  function checkInButton(reg, checkedIn, full = false) {
    if (checkedIn) {
      return `<button onclick="Page.toggleAttendance(${reg.id}, false, this)" class="${full ? 'w-full py-2.5 rounded-xl border border-slate-200' : ''} text-[11px] font-bold text-slate-400 hover:text-slate-600 underline">Undo Check-in</button>`;
    }
    return `<button onclick="Page.toggleAttendance(${reg.id}, true, this)" class="${full ? 'w-full py-3 text-xs rounded-xl' : 'px-2.5 py-1 text-[11px] rounded-lg'} bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-sm transition">Check-in Now</button>`;
  }

  function renderRoster() {
    const tbody = byId('admin-roster-body');
    const cards = byId('admin-roster-cards');
    const checkedInCount = roster.filter(r => r.status === 'CHECKED_IN').length;
    byId('roster-summary').textContent = `${roster.length} registered • ${checkedInCount} checked in`;

    if (roster.length === 0) {
      const msg = 'No student registrations recorded for this selection.';
      tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-slate-400 italic">${msg}</td></tr>`;
      cards.innerHTML = `<p class="col-span-full py-8 text-center text-slate-400 italic text-xs">${msg}</p>`;
      return;
    }

    tbody.innerHTML = roster.map(reg => {
      const s = reg.student;
      const checkedIn = reg.status === 'CHECKED_IN';
      return `
        <tr class="hover:bg-slate-50/80 transition">
          <td class="py-3 px-4 font-bold text-slate-900">${esc(s.name)}</td>
          <td class="py-3 px-4 font-mono text-slate-600">${esc(s.studentId)}</td>
          <td class="py-3 px-4 text-slate-600">${esc(s.wechat)}</td>
          <td class="py-3 px-4 text-slate-500">${esc(s.major)} (${esc(s.grade)})</td>
          <td class="py-3 px-4 text-slate-700 max-w-xs truncate">${esc(reg.eventTitle)}</td>
          <td class="py-3 px-4">${statusPill(checkedIn)}</td>
          <td class="py-3 px-4 font-mono text-[11px] text-slate-500">${esc(reg.token)}</td>
          <td class="py-3 px-4 text-right">${checkInButton(reg, checkedIn)}</td>
        </tr>`;
    }).join('');

    cards.innerHTML = roster.map(reg => {
      const s = reg.student;
      const checkedIn = reg.status === 'CHECKED_IN';
      return `
        <article class="p-4 rounded-2xl border border-slate-200 bg-slate-50/40 space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-bold text-slate-900 text-sm break-words">${esc(s.name)}</p>
              <p class="font-mono text-[11px] text-slate-500">${esc(s.studentId)}</p>
            </div>
            ${statusPill(checkedIn)}
          </div>
          <dl class="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
            <div><dt class="text-slate-400 uppercase font-semibold text-[10px]">WeChat</dt><dd class="text-slate-700 break-all">${esc(s.wechat)}</dd></div>
            <div><dt class="text-slate-400 uppercase font-semibold text-[10px]">Major &amp; Grade</dt><dd class="text-slate-700 break-words">${esc(s.major)} (${esc(s.grade)})</dd></div>
            <div class="col-span-2"><dt class="text-slate-400 uppercase font-semibold text-[10px]">Activity</dt><dd class="text-slate-700 break-words">${esc(reg.eventTitle)}</dd></div>
            <div class="col-span-2"><dt class="text-slate-400 uppercase font-semibold text-[10px]">Ticket Token</dt><dd class="font-mono text-slate-600 break-all">${esc(reg.token)}</dd></div>
          </dl>
          ${checkInButton(reg, checkedIn, true)}
        </article>`;
    }).join('');
  }

  async function changeRosterFilter() {
    try {
      await loadRoster();
      renderRoster();
    } catch (err) {
      fail(err);
    }
  }

  async function toggleAttendance(regId, checkIn, button) {
    const row = roster.find(r => r.id === regId);
    if (!row) return;
    try {
      const { registration } = await UI.busy(button, () => API.setRegistrationStatus(regId, checkIn ? 'CHECKED_IN' : 'REGISTERED', row.eventId, row.studentId));
      Object.assign(row, registration);
      renderRoster();
      UI.toast(`Attendance updated for student token ${registration.token}.`, 'success');
    } catch (err) {
      fail(err);
    }
  }

  // =================================================================
  // DOOR CHECK-IN
  // =================================================================
  /** Activity chosen in "Checking in for" (null = any). */
  function doorEventId() {
    const v = byId('door-event').value;
    return v ? Number(v) : null;
  }

  /** Fills "Checking in for", pre-selecting the activity happening now (or next). */
  function populateDoorEvents() {
    const select = byId('door-event');
    const previous = select.value;
    select.innerHTML = '<option value="">Any activity</option>' +
      events.map(e => `<option value="${e.id}">${esc(e.title)} — ${esc(UI.fmtShort(e.startTime))} ${esc(UI.fmtTime(e.startTime))}</option>`).join('');

    if (previous && events.some(e => String(e.id) === previous)) {
      select.value = previous;
      return;
    }
    const now = Date.now();
    const HOUR = 3600e3;
    const current = events.find(e => Date.parse(e.startTime) - 2 * HOUR <= now && now <= Date.parse(e.endTime) + HOUR);
    const next = events
      .filter(e => Date.parse(e.endTime) > now)
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))[0];
    const pick = current || next;
    select.value = pick ? String(pick.id) : '';
  }

  /** Turns a check-in result into the wording shown on the desk and in the scanner. */
  function describeResult(result, token) {
    switch (result.result) {
      case 'OK':
        return { tone: 'ok', title: 'VALID • Checked in', autoResume: true,
                 detail: `${result.studentName} (${result.studentId}) — ${result.eventTitle}` };
      case 'ALREADY':
        return { tone: 'warn', title: 'Already used', autoResume: false,
                 detail: `${result.studentName} (${result.studentId}) was checked in${result.checkedInAt ? ` at ${UI.fmtTime(result.checkedInAt)}` : ''} — ${result.eventTitle}` };
      case 'WRONG_EVENT':
        return { tone: 'error', title: 'Wrong activity — not admitted', autoResume: false,
                 detail: `${result.studentName} (${result.studentId}) is registered for "${result.eventTitle}", not this one.` };
      default:
        return { tone: 'error', title: 'INVALID pass', autoResume: false,
                 detail: `No registration matches ${token}.` };
    }
  }

  /** Sends a token to the server; refreshes the roster after a successful check-in. */
  async function checkToken(token) {
    const result = await API.checkIn(token, doorEventId());
    if (result.result === 'OK') changeRosterFilter();
    return result;
  }

  function showDeskFeedback(result, token) {
    const d = describeResult(result, token);
    const styles = {
      ok:    ['bg-emerald-50 border-emerald-200 text-emerald-900', 'circle-check-big', 'text-emerald-600'],
      warn:  ['bg-amber-50 border-amber-200 text-amber-900', 'triangle-alert', 'text-amber-600'],
      error: ['bg-rose-50 border-rose-200 text-rose-800', 'octagon-alert', 'text-rose-600']
    }[d.tone];
    const feedback = byId('scan-feedback');
    feedback.classList.remove('hidden');
    feedback.innerHTML = `
      <div class="p-4 border rounded-2xl flex items-start gap-3 text-xs ${styles[0]}">
        <i data-lucide="${styles[1]}" class="w-6 h-6 flex-shrink-0 ${styles[2]}"></i>
        <div class="min-w-0">
          <p class="font-black text-sm">${esc(d.title)}</p>
          <p class="break-words">${esc(d.detail)}</p>
        </div>
      </div>`;
    UI.icons();
  }

  /** Manual entry (typed token or a USB/Bluetooth scanner that types it). */
  async function verifyScan(button) {
    const input = byId('scan-token-input');
    const token = (input.value || '').trim().toUpperCase();
    if (!token) {
      UI.toast('Please enter or scan a pass token code.', 'error');
      return;
    }
    try {
      const result = await UI.busy(button, () => checkToken(token));
      showDeskFeedback(result, token);
    } catch (err) {
      return fail(err);
    }
    input.value = '';
    input.focus();
  }

  /** Camera scanner. */
  function openScanner() {
    const select = byId('door-event');
    const label = select.value ? select.options[select.selectedIndex].text : 'Any activity';
    let lastResult = null;

    Scanner.onClose(() => {
      if (lastResult) showDeskFeedback(lastResult.result, lastResult.token);
    });

    Scanner.open({
      subtitle: `For: ${label}`,
      onToken: async token => {
        try {
          const result = await checkToken(token);
          lastResult = { result, token };
          return describeResult(result, token);
        } catch (err) {
          if (err && (err.status === 401 || err.status === 403)) {
            Scanner.close();
            fail(err);
          }
          throw err;
        }
      }
    });
  }

  // =================================================================
  // CSV EXPORT (Excel-friendly, safe against formula injection)
  // =================================================================
  function csvCell(value) {
    let s = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;          // stop Excel treating text as a formula
    return `"${s.replace(/"/g, '""')}"`;
  }

  function exportCSV() {
    if (roster.length === 0) {
      UI.toast('No attendees to export.', 'info');
      return;
    }

    const header = ['Student Name', 'Student ID', 'WeChat Handle', 'Major', 'Grade', 'Activity Name', 'Door Check-in Status', 'Pass Token', 'Registered At (UTC+8)', 'Checked In At (UTC+8)'];
    const stamp = iso => iso ? UI.fmt(iso, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    const lines = [header.map(csvCell).join(',')].concat(roster.map(r => [
      r.student.name, r.student.studentId, r.student.wechat, r.student.major, r.student.grade,
      r.eventTitle, r.status, r.token, stamp(r.registeredAt), stamp(r.checkedInAt)
    ].map(csvCell).join(',')));

    // BOM so Excel shows Chinese names correctly
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `CUVA_Attendance_Roster_${UI.fmt(new Date().toISOString(), { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    UI.toast('CSV attendance roster downloaded successfully.', 'success');
  }

  // =================================================================
  // CREATE / EDIT / DELETE ACTIVITY
  // =================================================================
  function populateCategorySelect(extra) {
    const names = categories.map(c => c.name);
    if (extra && !names.includes(extra)) names.push(extra);   // keep a since-deleted category on edit
    byId('ev-category').innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  }

  function openEditor(eventId = null) {
    byId('form-event-editor').reset();

    if (eventId) {
      const ev = events.find(e => e.id === eventId);
      if (!ev) return;
      populateCategorySelect(ev.category);
      byId('event-editor-modal-title').textContent = 'Modify Activity Details';
      byId('ev-edit-id').value = ev.id;
      byId('ev-title').value = ev.title;
      byId('ev-category').value = ev.category;
      byId('ev-quota').value = ev.quota;
      byId('ev-venue').value = ev.venue;
      byId('ev-start-time').value = UI.toInputValue(ev.startTime);
      byId('ev-end-time').value = UI.toInputValue(ev.endTime);
      byId('ev-reg-open').value = UI.toInputValue(ev.regOpenTime);
      byId('ev-reg-close').value = UI.toInputValue(ev.regCloseTime);
      byId('ev-certificate').checked = !!ev.hasCertificate;
      byId('ev-desc').value = ev.desc;
    } else {
      populateCategorySelect();
      byId('event-editor-modal-title').textContent = 'Publish Campus Activity';
      byId('ev-edit-id').value = '';

      // Defaults (campus time): tomorrow 19:00–21:00, registration opens now, closes tomorrow 17:00
      const today = UI.toInputValue(new Date().toISOString());          // "YYYY-MM-DDTHH:mm" campus time
      const tomorrowDate = UI.toInputValue(new Date(Date.now() + 864e5).toISOString()).slice(0, 10);
      byId('ev-start-time').value = `${tomorrowDate}T19:00`;
      byId('ev-end-time').value = `${tomorrowDate}T21:00`;
      byId('ev-reg-open').value = today;
      byId('ev-reg-close').value = `${tomorrowDate}T17:00`;
      byId('ev-certificate').checked = false;
    }

    UI.openModal('modal-event-editor');
    UI.icons();
  }

  async function saveEvent(e) {
    e.preventDefault();
    const editId = byId('ev-edit-id').value;
    const submitBtn = byId('ev-submit');

    const data = {
      title: byId('ev-title').value.trim(),
      category: byId('ev-category').value,
      quota: parseInt(byId('ev-quota').value, 10),
      venue: byId('ev-venue').value.trim(),
      startTime: UI.fromInputValue(byId('ev-start-time').value),
      endTime: UI.fromInputValue(byId('ev-end-time').value),
      regOpenTime: UI.fromInputValue(byId('ev-reg-open').value),
      regCloseTime: UI.fromInputValue(byId('ev-reg-close').value),
      hasCertificate: byId('ev-certificate').checked,
      desc: byId('ev-desc').value.trim()
    };

    if (data.endTime <= data.startTime) return UI.toast('Activity finish time must be later than start time.', 'error');
    if (data.regCloseTime <= data.regOpenTime) return UI.toast('Registration closing time must be after opening time.', 'error');

    try {
      await UI.busy(submitBtn, () => editId ? API.updateEvent(editId, data) : API.createEvent(data));
      UI.toast(editId ? `Updated activity: ${data.title}` : `Published new activity: ${data.title}`, 'success');
      UI.closeModal('modal-event-editor');
      await loadEvents();
      renderEvents();
    } catch (err) {
      fail(err);
    }
  }

  function deleteEvent(eventId) {
    const ev = events.find(e => e.id === eventId);
    if (!ev) return;

    UI.confirm(
      'Delete Activity',
      `Are you sure you want to cancel and remove "${ev.title}"? (${ev.registeredCount} registered student passes will be cancelled).`,
      async () => {
        try {
          await API.deleteEvent(eventId);
          await loadEvents();
          renderEvents();
          await loadRoster();
          renderRoster();
          UI.toast(`Activity "${ev.title}" has been deleted.`, 'info');
        } catch (err) {
          fail(err);
        }
      }
    );
  }

  // =================================================================
  // CATEGORIES
  // =================================================================
  function renderCategoryList() {
    byId('categories-manage-list').innerHTML = categories.map(cat => `
      <div class="flex items-center justify-between gap-2 p-2.5 pl-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs">
        <span class="font-bold text-slate-800 min-w-0 break-words">${esc(cat.name)}</span>
        <div class="flex items-center gap-1 flex-shrink-0">
          <button onclick="Page.renameCategory(${cat.id})" aria-label="Rename category" class="w-9 h-9 flex items-center justify-center hover:bg-slate-200 rounded-lg text-slate-500 hover:text-slate-900"><i data-lucide="pencil" class="w-4 h-4"></i></button>
          <button onclick="Page.deleteCategory(${cat.id})" aria-label="Delete category" class="w-9 h-9 flex items-center justify-center hover:bg-rose-100 rounded-lg text-slate-400 hover:text-rose-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>
      </div>`).join('');
    UI.icons();
  }

  async function addCategory(button) {
    const input = byId('new-category-input');
    const val = (input.value || '').trim();
    if (!val) return;
    try {
      await UI.busy(button, () => API.addCategory(val));
      input.value = '';
      await loadCategories();
      renderCategoryList();
      UI.toast(`Added category: ${val}`, 'success');
    } catch (err) {
      if (err.status === 409) return UI.toast(err.message, 'info');
      fail(err);
    }
  }

  function renameCategory(id) {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;
    UI.prompt('Rename Activity Category', 'Enter new name for this category:', cat.name, async newName => {
      if (newName === cat.name) return;
      try {
        await API.renameCategory(id, newName);
        await Promise.all([loadCategories(), loadEvents()]);
        renderCategoryList();
        renderEvents();
        UI.toast(`Renamed category to "${newName}".`, 'success');
      } catch (err) {
        fail(err);
      }
    });
  }

  function deleteCategory(id) {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;
    if (categories.length <= 1) return UI.toast('You must maintain at least one category.', 'error');

    UI.confirm('Delete Category', `Delete category "${cat.name}"? Existing activities under this category will be preserved.`, async () => {
      try {
        await API.deleteCategory(id);
        await loadCategories();
        renderCategoryList();
        UI.toast(`Category "${cat.name}" removed.`, 'info');
      } catch (err) {
        fail(err);
      }
    });
  }

  // =================================================================
  // BOOT
  // =================================================================
  async function init() {
    await UI.init('organizer');
    const user = UI.state.user;

    if (!user || !user.isOrganizer) return showGuard();

    try {
      const tasks = [loadEvents(), loadCategories(), loadRoster()];
      let organizers = null;
      if (user.isSuperAdmin) tasks.push(API.organizers().then(r => { organizers = r.organizers; }));
      await Promise.all(tasks);

      byId('organizer-loading').classList.add('hidden');
      byId('organizer-main-content').classList.remove('hidden');

      if (user.isSuperAdmin) {
        byId('super-admin-panel').classList.remove('hidden');
        byId('organizer-badge-role').textContent = 'Master Super Admin';
        renderOrganizerList(organizers);
      } else {
        byId('organizer-badge-role').textContent = 'Authorized Organizer';
      }

      renderEvents();
      renderRoster();
      renderCategoryList();
      UI.icons();
    } catch (err) {
      fail(err);
    }
  }

  return {
    init,
    grantOrganizer, revokeOrganizer,
    changeRosterFilter, toggleAttendance, verifyScan, openScanner, exportCSV,
    openEditor, saveEvent, deleteEvent,
    addCategory, renameCategory, deleteCategory
  };
})();

Page.init();
