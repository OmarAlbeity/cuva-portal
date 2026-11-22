/* =====================================================================
 * Email sending (password-reset codes) through a Gmail account.
 *
 * Netlify environment variables:
 *   GMAIL_USER           cuvaportal@gmail.com
 *   GMAIL_APP_PASSWORD   16-character Google "App Password" (not the normal password)
 *
 * When running locally without these, the code is printed in the terminal instead.
 * ===================================================================== */
import nodemailer from 'nodemailer';

let transporter = null;

export function mailConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function getTransporter() {
  transporter ||= nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER.trim(),
      pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '')   // Google shows it with spaces
    }
  });
  return transporter;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Sends the 6-digit reset code. Throws if Gmail refuses. */
export async function sendResetCode({ to, name, code, minutes }) {
  if (!mailConfigured()) {
    if (process.env.CUVA_LOCAL_PREVIEW === '1') {
      console.log(`\n[local preview] Password reset code for ${to}: ${code}\n`);
      return;
    }
    throw new Error('Email sending is not set up (GMAIL_USER / GMAIL_APP_PASSWORD missing).');
  }

  const text = [
    `Hello ${name},`,
    '',
    `Your CUVA Portal password reset code is: ${code}`,
    '',
    `It is valid for ${minutes} minutes. Do not share it with anyone.`,
    'If you did not ask to reset your password, you can ignore this email.',
    '',
    'CUVA — College of United Volunteer Association, NUIST'
  ].join('\n');

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:440px;margin:0 auto;padding:24px;color:#0f172a">
    <p style="margin:0 0 4px;font-size:12px;font-weight:bold;letter-spacing:2px;color:#e11d48">CUVA PORTAL</p>
    <h2 style="margin:0 0 16px;font-size:20px">Password reset code</h2>
    <p style="margin:0 0 16px">Hello ${esc(name)},</p>
    <p style="margin:0 0 8px">Enter this code on the reset page:</p>
    <p style="margin:0 0 16px;font-size:34px;font-weight:bold;letter-spacing:8px;font-family:Consolas,monospace">${esc(code)}</p>
    <p style="margin:0 0 8px;color:#475569;font-size:13px">Valid for ${minutes} minutes. Do not share it with anyone.</p>
    <p style="margin:0;color:#475569;font-size:13px">If you did not ask to reset your password, ignore this email.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0">
    <p style="margin:0;color:#94a3b8;font-size:12px">CUVA — College of United Volunteer Association, NUIST</p>
  </div>`;

  await getTransporter().sendMail({
    from: `"CUVA Portal" <${process.env.GMAIL_USER.trim()}>`,
    to,
    subject: `CUVA Portal reset code: ${code}`,
    text,
    html
  });
}
