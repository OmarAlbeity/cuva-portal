/* =====================================================================
 * Sign-up page (signup.html)
 * Creates the student profile on the server, signs it in, and returns to
 * ?redirect=<page>. If the ID already exists, goes to sign-in with it pre-filled.
 * ===================================================================== */
const Page = (() => {
  'use strict';

  const byId = id => document.getElementById(id);

  async function submit(e) {
    e.preventDefault();

    const data = {
      name: byId('su-name').value.trim(),
      studentId: byId('su-studentid').value.trim(),
      wechat: byId('su-wechat').value.trim(),
      email: byId('su-email').value.trim(),
      major: byId('su-major').value.trim(),
      grade: byId('su-grade').value,
      password: byId('su-password').value
    };
    const redirect = UI.redirectTarget();

    if (data.password.length < 8) {
      UI.toast('Password must be at least 8 characters long.', 'error');
      return;
    }

    try {
      await UI.busy(byId('su-submit'), () => API.signUp(data));
      UI.flash(`Welcome, ${data.name}! Your student profile is active.`, 'success');
      location.href = redirect;
    } catch (err) {
      if (err.code === 'EXISTS') {
        UI.flash(err.message, 'error');
        location.href = `${UI.signInUrl(redirect)}&id=${encodeURIComponent(data.studentId)}`;
        return;
      }
      UI.toast(err.message, 'error');
    }
  }

  async function init() {
    await UI.init(null);
    byId('link-signin').href = UI.signInUrl(UI.redirectTarget());
  }

  return { init, submit };
})();

Page.init();
