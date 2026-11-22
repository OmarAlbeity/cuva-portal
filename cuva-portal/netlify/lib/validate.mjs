/* =====================================================================
 * Input validation. Every value from a browser passes through here
 * before it reaches the database.
 * ===================================================================== */
import { GRADES } from './database.mjs';

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const STUDENT_ID_RE = /^\d{6,16}$/;

export function text(value, label, { min = 1, max }) {
  const v = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (v.length < min) throw new ValidationError(`${label} is required.`);
  if (v.length > max) throw new ValidationError(`${label} must be at most ${max} characters.`);
  return v;
}

function longText(value, label, { max }) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) throw new ValidationError(`${label} is required.`);
  if (v.length > max) throw new ValidationError(`${label} must be at most ${max} characters.`);
  return v;
}

export function studentId(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!STUDENT_ID_RE.test(v)) throw new ValidationError('Student ID must be 6–16 digits.');
  return v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function email(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!v) throw new ValidationError('Email address is required.');
  if (v.length > 254 || !EMAIL_RE.test(v)) throw new ValidationError('Please enter a valid email address.');
  return v;
}

export function resetCode(value) {
  const v = typeof value === 'string' ? value.replace(/\s+/g, '') : '';
  if (!/^\d{6}$/.test(v)) throw new ValidationError('The code is 6 digits.');
  return v;
}

export function password(value) {
  if (typeof value !== 'string' || value.length < 8) throw new ValidationError('Password must be at least 8 characters long.');
  if (value.length > 128) throw new ValidationError('Password must be at most 128 characters.');
  return value;
}

function isoTime(value, label) {
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(t)) throw new ValidationError(`${label} is not a valid date/time.`);
  return new Date(t).toISOString();
}

export function positiveId(value, label = 'ID') {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ValidationError(`Invalid ${label}.`);
  return n;
}

export function signup(body) {
  if (!GRADES.includes(body.grade)) throw new ValidationError('Grade Level must be Bachelor, Master or PhD.');
  return {
    name: text(body.name, 'Full Name', { max: 60 }),
    studentId: studentId(body.studentId),
    wechat: text(body.wechat, 'WeChat Handle', { max: 40 }),
    major: text(body.major, 'Major / School', { max: 80 }),
    grade: body.grade,
    email: email(body.email),
    password: password(body.password)
  };
}

/** categoryAllowed(name) → Promise<boolean> */
export async function eventPayload(body, categoryAllowed) {
  const e = {
    title: text(body.title, 'Activity Title', { max: 120 }),
    category: text(body.category, 'Category', { max: 40 }),
    venue: text(body.venue, 'Venue', { max: 120 }),
    quota: Number(body.quota),
    startTime: isoTime(body.startTime, 'Start time'),
    endTime: isoTime(body.endTime, 'Finish time'),
    regOpenTime: isoTime(body.regOpenTime, 'Registration opening time'),
    regCloseTime: isoTime(body.regCloseTime, 'Registration closing time'),
    hasCertificate: body.hasCertificate === true,
    desc: longText(body.desc, 'Description', { max: 2000 })
  };
  if (!Number.isInteger(e.quota) || e.quota < 1 || e.quota > 500) throw new ValidationError('Quota must be a whole number from 1 to 500.');
  if (!(await categoryAllowed(e.category))) throw new ValidationError('Please choose an existing category.');
  if (e.endTime <= e.startTime) throw new ValidationError('Activity finish time must be later than start time.');
  if (e.regCloseTime <= e.regOpenTime) throw new ValidationError('Registration closing time must be after opening time.');
  return e;
}
