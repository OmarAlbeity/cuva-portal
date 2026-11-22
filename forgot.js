/* =====================================================================
 * Forgot-password page (forgot.html)
 * Step 1: email → server emails a 6-digit code.
 * Step 2: code + new password → signed in, other logins signed out.
 * ===================================================================== */
const Page = (() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const RESEND_SECONDS = 60;
  let email = '';
  let countdown = null;

  function startResendTimer(seconds = RESEND_SECONDS) {
    const btn = byId('fp-resend');
    let left = seconds;
    clearInterval(countdown);
    btn.disabled = true;
    btn.textContent = `Resend code in ${left}s`;
    countdown = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(countdown);
        btn.disabled = false;
        btn.textContent = 'Resend code';
      } else {
        btn.textContent = `Resend code in ${left}s`;
      }
    }, 1000);
  }

  function showStep2(message) {
    byId('form-forgot').classList.add('hidden');
    byId('form-reset').classList.remove('hidden');
    byId('reset-intro').textContent = 'Enter the code from the email and choose a new password.';
    byId('fp-sent-msg').textContent = message;
    byId('fp-sent-to').textContent = email;
    byId('fp-code').focus();
    startResendTimer();
  }

  async function request(button) {
    const res = await UI.busy(button, () => API.forgotPassword(email));
    return res.message || 'If an account uses this email, a code has been sent.';
  }

  async function sendCode(e) {
    e.preventDefault();
    email = byId('fp-email').value.trim().toLowerCase();
    try {
      showStep2(await request(byId('fp-send')));
    } catch (err) {
      UI.toast(err.message, 'error');
      const wait = /wait (\d+) seconds/.exec(err.message);
      if (wait && byId('form-reset').classList.contains('hidden')) showStep2('A code was sent recently. Use the latest email.');
      if (wait) startResendTimer(Number(wait[1]));
    }
  }

  async function resend(button) {
    try {
      const msg = await request(button);
      byId('fp-sent-msg').textContent = msg;
      UI.toast('A new code was sent. Use the newest email.', 'success');
      startResendTimer();
    } catch (err) {
      UI.toast(err.message, 'error');
      const wait = /wait (\d+) seconds/.exec(err.message);
      startResendTimer(wait ? Number(wait[1]) : 5);
    }
  }

  function changeEmail() {
    clearInterval(countdown);
    byId('form-reset').classList.add('hidden');
    byId('form-forgot').classList.remove('hidden');
    byId('reset-intro').textContent = "Enter the email address you registered with. We'll send you a 6-digit code.";
    byId('fp-email').focus();
  }

  async function resetPassword(e) {
    e.preventDefault();
    const code = byId('fp-code').value.replace(/\s+/g, '');
    const password = byId('fp-password').value;

    if (!/^\d{6}$/.test(code)) return UI.toast('The code is 6 digits.', 'error');
    if (password.length < 8) return UI.toast('Password must be at least 8 characters long.', 'error');
    if (password !== byId('fp-password2').value) return UI.toast('The two passwords do not match.', 'error');

    try {
      await UI.busy(byId('fp-reset'), () => API.resetPassword(email, code, password));
      UI.flash('Password changed. You are now signed in.', 'success');
      location.href = UI.redirectTarget();
    } catch (err) {
      UI.toast(err.message, 'error');
      if (err.code === 'EXPIRED' || err.code === 'TOO_MANY') {
        byId('fp-code').value = '';
        byId('fp-resend').disabled = false;
        byId('fp-resend').textContent = 'Send a new code';
        clearInterval(countdown);
      } else {
        byId('fp-code').select();
      }
    }
  }

  async function init() {
    await UI.init(null);
    byId('link-signin').href = UI.signInUrl(UI.redirectTarget());
    const prefill = new URLSearchParams(location.search).get('email');
    if (prefill) byId('fp-email').value = prefill;
  }

  return { init, sendCode, resend, changeEmail, resetPassword };
})();

Page.init();
