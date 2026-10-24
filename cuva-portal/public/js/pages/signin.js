/* =====================================================================
 * Sign-in page (signin.html)
 * After a successful sign-in, returns the student to ?redirect=<page>
 * (index.html, passes.html or organizer.html; defaults to index.html).
 * ===================================================================== */
const Page = (() => {
  'use strict';

  const byId = id => document.getElementById(id);

  async function submit(e) {
    e.preventDefault();
    const studentId = byId('si-studentid').value.trim();
    const password = byId('si-password').value;

    try {
      const { user } = await UI.busy(byId('si-submit'), () => API.signIn(studentId, password));
      UI.flash(`Welcome back, ${user.name}!`, 'success');
      location.href = UI.redirectTarget();
    } catch (err) {
      UI.toast(err.message, 'error');
      byId('si-password').value = '';
      byId('si-password').focus();
    }
  }

  async function init() {
    await UI.init(null);

    byId('link-signup').href = UI.signUpUrl(UI.redirectTarget());

    // Pre-fill ID when sent here from sign-up (ID already registered)
    const prefillId = new URLSearchParams(location.search).get('id');
    if (prefillId && /^\d{1,16}$/.test(prefillId)) {
      byId('si-studentid').value = prefillId;
      byId('si-password').focus();
    }

    const user = UI.state.user;
    if (user) {
      const note = byId('current-session-note');
      note.innerHTML = 'Currently signed in as <strong class="text-slate-800"></strong>. Signing in below switches account.';
      note.querySelector('strong').textContent = `${user.name} (${user.studentId})`;
      note.classList.remove('hidden');
    }
  }

  return { init, submit };
})();

Page.init();
