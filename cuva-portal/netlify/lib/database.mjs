/* =====================================================================
 * CUVA Portal — DATABASE (netlify/lib/database.mjs)
 * ---------------------------------------------------------------------
 * The single place that reads/writes data. Storage: Netlify Blobs
 * (built into Netlify, nothing to set up), store name "cuva".
 *
 * Layout (one JSON document per key):
 *   users/{studentId}              profile + password hash
 *   events/{id}                    activity details + seat counter (registeredCount)
 *   regs/{eventId}/{studentId}     one registration (QR token, door status, student snapshot)
 *   myregs/{studentId}/{eventId}   index for "My Passes"
 *   tokens/{token}                 door token → { eventId, studentId }
 *   config/categories              category list
 *   config/organizers              organizer student IDs
 *   config/session-secret          auto-generated signing key for login cookies
 *
 * Safety rules:
 *  - Each registration is its own record created with "only if new", so two
 *    students can never overwrite each other; a confirmed pass is never lost.
 *  - Seats are taken with a conditional (ETag) update on the event's counter,
 *    retried on conflict, so the quota holds when many register at once.
 *  - A write only counts as successful when the store returns a new ETag.
 * All times are ISO-8601 UTC strings.
 * ===================================================================== */
import { getStore } from '@netlify/blobs';
import { timingSafeEqual } from 'node:crypto';
import * as security from './security.mjs';

export const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || '202453080043';
export const STATUS = Object.freeze({ REGISTERED: 'REGISTERED', CHECKED_IN: 'CHECKED_IN' });
export const GRADES = Object.freeze(['Bachelor', 'Master', 'PhD']);

const SESSION_DAYS = 14;
const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;
const SEAT_RECOUNT_IDLE_MS = 60_000;
const DEFAULT_CATEGORIES = ['Board Games', 'Parliamentary Debate', 'Language & Culture', 'Workshops & Skills', 'Movie & Social'];

const store = () => getStore({ name: 'cuva', consistency: 'strong' });
const nowISO = () => new Date().toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class ConflictError extends Error {
  constructor() {
    super('The server is busy. Please try again.');
    this.status = 503;
  }
}

// =====================================================================
// LOW-LEVEL HELPERS
// =====================================================================
async function getJSON(key) {
  return (await store().get(key, { type: 'json' })) ?? null;
}

/**
 * Atomic read-modify-write on one key.
 * mutate(current | null) returns { write?: newValue, result } — omit `write` to change nothing.
 * Retries automatically if another request changed the key in between.
 */
async function update(key, mutate, { retries = 15 } = {}) {
  const s = store();
  for (let attempt = 0; attempt < retries; attempt++) {
    const current = await s.getWithMetadata(key, { type: 'json' });
    const out = await mutate(current ? structuredClone(current.data) : null);
    if (!('write' in out)) return out.result;

    if (current && !current.etag) {
      // Never fall back to an unconditional write: that could silently overwrite someone else's change
      throw new Error(`Storage returned no version tag for "${key}"; refusing an unsafe write.`);
    }
    const condition = current ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    if (await conditionalSet(key, out.write, condition)) return out.result;

    await sleep(20 + Math.random() * 80 * (attempt + 1));
  }
  throw new ConflictError();
}

/**
 * Conditional write. Returns true only when the store confirms a new version (ETag).
 * (The SDK reports `modified: true` for any non-412 reply, including server errors,
 * so the returned ETag is checked as well.)
 */
async function conditionalSet(key, value, condition) {
  const res = await store().setJSON(key, value, condition);
  return res.modified === true && typeof res.etag === 'string' && res.etag.length > 0;
}

/** Runs fn over items with at most `limit` in flight (keeps big rosters fast but polite). */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

async function listKeys(prefix) {
  const { blobs } = await store().list({ prefix });
  return blobs.map(b => b.key);
}

// =====================================================================
// SESSION SIGNING KEY
// =====================================================================
let cachedSecret = process.env.SESSION_SECRET || null;

async function sessionSecret() {
  if (cachedSecret) return cachedSecret;
  const s = store();
  await s.set('config/session-secret', security.randomSecret(), { onlyIfNew: true });
  cachedSecret = await s.get('config/session-secret', { type: 'text' });
  return cachedSecret;
}

// =====================================================================
// USERS & SESSIONS
// =====================================================================
async function getUserRecord(studentId) {
  return getJSON(`users/${studentId}`);
}

async function toUserDTO(rec) {
  if (!rec) return null;
  const isSuperAdmin = rec.studentId === SUPER_ADMIN_ID;
  return {
    studentId: rec.studentId,
    name: rec.name,
    wechat: rec.wechat,
    major: rec.major,
    grade: rec.grade,
    isSuperAdmin,
    isOrganizer: isSuperAdmin || (await isOrganizer(rec.studentId))
  };
}

/** Returns the new user DTO, or null if the Student ID is taken. */
export async function createUser({ studentId, name, wechat, major, grade, password }) {
  const rec = {
    studentId, name, wechat, major, grade,
    passwordHash: await security.hashPassword(password),
    createdAt: nowISO(),
    failedLogins: 0,
    lockedUntil: null
  };
  return (await conditionalSet(`users/${studentId}`, rec, { onlyIfNew: true })) ? toUserDTO(rec) : null;
}

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Checks ID + password. Returns { user } on success,
 * { error: 'INVALID' } or { error: 'LOCKED', minutes } otherwise.
 * Locks an account for 15 min after 10 wrong passwords.
 */
export async function authenticate(studentId, password) {
  let rec = await getUserRecord(studentId);

  // First sign-in of the Super Admin: create the account from SUPER_ADMIN_PASSWORD (set in Netlify)
  if (!rec && studentId === SUPER_ADMIN_ID) {
    const envPw = process.env.SUPER_ADMIN_PASSWORD || '';
    if (envPw.length >= 8 && sameText(password, envPw)) {
      await createUser({
        studentId: SUPER_ADMIN_ID, name: 'Super Admin Officer', wechat: 'cuva_superadmin',
        major: 'Computer & Software', grade: 'Bachelor', password: envPw
      });
      rec = await getUserRecord(studentId);
    }
  }

  if (!rec) {
    await security.verifyAgainstDummy(password);
    return { error: 'INVALID' };
  }

  if (rec.lockedUntil && Date.parse(rec.lockedUntil) > Date.now()) {
    return { error: 'LOCKED', minutes: Math.ceil((Date.parse(rec.lockedUntil) - Date.now()) / 60000) };
  }

  const ok = await security.verifyPassword(password, rec.passwordHash);

  // Record the outcome (best effort)
  try {
    await update(`users/${studentId}`, u => {
      if (!u) return { result: null };
      if (ok) {
        if (!u.failedLogins && !u.lockedUntil) return { result: null };
        return { write: { ...u, failedLogins: 0, lockedUntil: null }, result: null };
      }
      const failed = (u.failedLogins || 0) + 1;
      const locked = failed >= MAX_FAILED_LOGINS;
      return {
        write: { ...u, failedLogins: locked ? 0 : failed, lockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null },
        result: null
      };
    }, { retries: 3 });
  } catch { /* ignore */ }

  return ok ? { user: await toUserDTO(rec) } : { error: 'INVALID' };
}

/** Creates a signed session cookie value. */
export async function createSession(studentId) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  return { token: security.signSession({ sid: studentId, exp }, await sessionSecret()), maxAgeSeconds: SESSION_DAYS * 86400 };
}

export async function getSessionUser(token) {
  if (!token) return null;
  const payload = security.verifySession(token, await sessionSecret());
  if (!payload) return null;
  return toUserDTO(await getUserRecord(payload.sid));
}

// =====================================================================
// ORGANIZERS
// =====================================================================
async function organizerIds() {
  const doc = await getJSON('config/organizers');
  return doc ? doc.ids : [];
}

export async function isOrganizer(studentId) {
  return studentId === SUPER_ADMIN_ID || (await organizerIds()).includes(studentId);
}

export async function listOrganizers() {
  const ids = [SUPER_ADMIN_ID, ...(await organizerIds()).filter(id => id !== SUPER_ADMIN_ID)];
  const users = await Promise.all(ids.map(getUserRecord));
  return ids.map((id, i) => ({ studentId: id, name: users[i]?.name || null, isRoot: id === SUPER_ADMIN_ID }));
}

/** Returns false if already an organizer. */
export async function addOrganizer(studentId) {
  if (studentId === SUPER_ADMIN_ID) return false;
  return update('config/organizers', doc => {
    const ids = doc ? doc.ids : [];
    if (ids.includes(studentId)) return { result: false };
    return { write: { ids: [...ids, studentId] }, result: true };
  });
}

/** Returns false for the root Super Admin or if not an organizer. */
export async function removeOrganizer(studentId) {
  if (studentId === SUPER_ADMIN_ID) return false;
  return update('config/organizers', doc => {
    const ids = doc ? doc.ids : [];
    if (!ids.includes(studentId)) return { result: false };
    return { write: { ids: ids.filter(id => id !== studentId) }, result: true };
  });
}

// =====================================================================
// CATEGORIES
// =====================================================================
export async function listCategories() {
  const doc = await getJSON('config/categories');
  if (doc) return doc.items;

  // First use: create the defaults (only one request wins; others re-read)
  const items = DEFAULT_CATEGORIES.map((name, i) => ({ id: i + 1, name }));
  await store().setJSON('config/categories', { nextId: items.length + 1, items }, { onlyIfNew: true });
  return (await getJSON('config/categories')).items;
}

export async function categoryExists(name) {
  const lower = String(name).toLowerCase();
  return (await listCategories()).some(c => c.name.toLowerCase() === lower);
}

/** Returns the new category, or null if the name exists. */
export async function addCategory(name) {
  await listCategories(); // ensure defaults exist
  return update('config/categories', doc => {
    if (doc.items.some(c => c.name.toLowerCase() === name.toLowerCase())) return { result: null };
    const category = { id: doc.nextId, name };
    return { write: { nextId: doc.nextId + 1, items: [...doc.items, category] }, result: category };
  });
}

/** Renames the category and every activity using it. Returns 'NOT_FOUND' | 'EXISTS' | 'OK'. */
export async function renameCategory(id, newName) {
  await listCategories();
  const outcome = await update('config/categories', doc => {
    const cat = doc.items.find(c => c.id === id);
    if (!cat) return { result: { code: 'NOT_FOUND' } };
    if (doc.items.some(c => c.id !== id && c.name.toLowerCase() === newName.toLowerCase())) return { result: { code: 'EXISTS' } };
    return {
      write: { ...doc, items: doc.items.map(c => (c.id === id ? { ...c, name: newName } : c)) },
      result: { code: 'OK', oldName: cat.name }
    };
  });
  if (outcome.code !== 'OK') return outcome.code;

  const keys = await listKeys('events/');
  await Promise.all(keys.map(key => update(key, ev => {
    if (!ev || ev.category !== outcome.oldName) return { result: null };
    return { write: { ...ev, category: newName }, result: null };
  })));
  return 'OK';
}

/** Activities keep their category text. Returns 'NOT_FOUND' | 'LAST' | 'OK'. */
export async function deleteCategory(id) {
  await listCategories();
  return update('config/categories', doc => {
    if (!doc.items.some(c => c.id === id)) return { result: 'NOT_FOUND' };
    if (doc.items.length <= 1) return { result: 'LAST' };
    return { write: { ...doc, items: doc.items.filter(c => c.id !== id) }, result: 'OK' };
  });
}

// =====================================================================
// EVENTS
// =====================================================================
function toEventDTO(ev) {
  if (!ev) return null;
  const { createdAt, ...rest } = ev;
  return { ...rest, registeredCount: Math.max(0, ev.registeredCount || 0) };
}

async function getEventRecord(id) {
  return getJSON(`events/${id}`);
}

export async function listEvents() {
  const keys = await listKeys('events/');
  return (await mapLimit(keys, 25, getJSON))
    .filter(Boolean)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .map(toEventDTO);
}

export async function getEvent(id) {
  return toEventDTO(await getEventRecord(id));
}

export async function createEvent(data) {
  const ev = { id: security.newId(), ...data, registeredCount: 0, createdAt: nowISO() };
  if (!(await conditionalSet(`events/${ev.id}`, ev, { onlyIfNew: true }))) throw new ConflictError();
  return toEventDTO(ev);
}

/** Returns the updated event, or null if not found. The seat counter is kept. */
export async function updateEvent(id, data) {
  return update(`events/${id}`, ev => {
    if (!ev) return { result: null };
    const next = { ...ev, ...data, id: ev.id, registeredCount: ev.registeredCount };
    return { write: next, result: toEventDTO(next) };
  });
}

/** Deletes the event and all its passes. Returns number of passes cancelled, or -1 if not found. */
export async function deleteEvent(id) {
  const ev = await getEventRecord(id);
  if (!ev) return -1;
  const s = store();
  await s.delete(`events/${id}`);
  const regs = await registrationsForEvent(id);
  await mapLimit(regs, 20, async r => {
    await s.delete(`tokens/${r.token}`);
    await s.delete(`myregs/${r.studentId}/${id}`);
    await s.delete(`regs/${id}/${r.studentId}`);
  });
  return regs.length;
}

// =====================================================================
// REGISTRATIONS
// =====================================================================
function toRegistrationDTO(reg) {
  return {
    id: reg.id,
    eventId: reg.eventId,
    studentId: reg.studentId,
    token: reg.token,
    status: reg.status,
    registeredAt: reg.registeredAt,
    checkedInAt: reg.checkedInAt || null
  };
}

async function registrationsForEvent(eventId) {
  const keys = await listKeys(`regs/${eventId}/`);
  return (await mapLimit(keys, 25, getJSON)).filter(Boolean);
}

/** Moves the seat counter by +1 / -1. Returns 'OK' | 'NOT_FOUND' | { result: 'FULL', idleMs }. */
async function changeSeats(eventId, delta) {
  return update(`events/${eventId}`, ev => {
    if (!ev) return { result: 'NOT_FOUND' };
    const count = ev.registeredCount || 0;
    if (delta > 0 && count >= ev.quota) return { result: 'FULL', idleMs: Date.now() - Date.parse(ev.seatsUpdatedAt || ev.createdAt || 0) };
    return { write: { ...ev, registeredCount: Math.max(0, count + delta), seatsUpdatedAt: nowISO() }, result: 'OK' };
  });
}

/**
 * Self-healing seat counter: compares it with the registrations actually stored.
 *   mode 'up'    → only raises the counter (safe while other sign-ups are in flight)
 *   mode 'exact' → sets it to the real number
 * Returns the real number of registrations.
 */
async function syncSeats(eventId, mode, knownCount = null) {
  const real = knownCount ?? (await listKeys(`regs/${eventId}/`)).length;
  try {
    await update(`events/${eventId}`, ev => {
      if (!ev) return { result: null };
      const current = ev.registeredCount || 0;
      const target = mode === 'up' ? Math.max(current, real) : real;
      if (target === current) return { result: null };
      return { write: { ...ev, registeredCount: target, seatsUpdatedAt: nowISO() }, result: null };
    }, { retries: 5 });
  } catch { /* best effort */ }
  return real;
}

async function reserveToken(category, eventId, studentId) {
  const suffix = String(category).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'CUVA';
  for (let i = 0; i < 10; i++) {
    const token = `CUVA-PASS-${security.randomCode(8)}-${suffix}`;
    if (await conditionalSet(`tokens/${token}`, { eventId, studentId }, { onlyIfNew: true })) return token;
  }
  throw new ConflictError();
}

/**
 * Registers a student. Returns { ok: true, registration, event } or { ok: false, code, message, ... }.
 *  1. checks the registration window and duplicates
 *  2. takes a seat on the event's counter (conditional update → quota holds)
 *  3. creates the student's own registration record ("only if new")
 * Any failure after step 2 gives the seat back.
 */
export async function registerForEvent(eventId, user) {
  const regKey = `regs/${eventId}/${user.studentId}`;
  const fail = (code, message) => ({ ok: false, code, message });

  const ev = await getEventRecord(eventId);
  if (!ev) return fail('NOT_FOUND', 'Activity not found.');

  const existing = await getJSON(regKey);
  if (existing) {
    return { ...fail('ALREADY', 'You are already registered for this activity!'),
             registration: toRegistrationDTO(existing), event: toEventDTO(ev) };
  }

  const now = nowISO();
  if (now < ev.regOpenTime)  return fail('NOT_STARTED', 'Registration has not opened yet.');
  if (now > ev.regCloseTime) return fail('CLOSED', 'Registration Closed (Time Expired)');

  let seat = await changeSeats(eventId, +1);
  if (seat && seat.result === 'FULL' && seat.idleMs > SEAT_RECOUNT_IDLE_MS) {
    // Counter says full but hasn't moved for a while: no sign-up can still be in progress,
    // so it is safe to recount the saved registrations (fixes a counter left high by an
    // interrupted request) and try once more.
    const real = await syncSeats(eventId, 'exact');
    if (real < ev.quota) seat = await changeSeats(eventId, +1);
  }
  const seatResult = typeof seat === 'string' ? seat : seat.result;
  if (seatResult === 'NOT_FOUND') return fail('NOT_FOUND', 'Activity not found.');
  if (seatResult === 'FULL') return fail('FULL', 'Activity Full (Limit Reached)');

  let token = null;
  try {
    token = await reserveToken(ev.category, eventId, user.studentId);
    const reg = {
      id: security.newId(),
      eventId,
      studentId: user.studentId,
      token,
      status: STATUS.REGISTERED,
      registeredAt: now,
      checkedInAt: null,
      // Snapshot so the roster needs no extra lookups
      student: { name: user.name, wechat: user.wechat, major: user.major, grade: user.grade }
    };

    reg.registeredAt = nowISO();
    if (!(await conditionalSet(regKey, reg, { onlyIfNew: true }))) {
      // Same student double-submitted: keep the first registration, give this seat back
      await changeSeats(eventId, -1);
      await store().delete(`tokens/${token}`);
      const first = await getJSON(regKey);
      return { ...fail('ALREADY', 'You are already registered for this activity!'),
               registration: first ? toRegistrationDTO(first) : null, event: await getEvent(eventId) };
    }

    // Second, independent quota guard: if more records exist than seats, the latest
    // registrations (by time, then id) withdraw themselves before anyone is told "OK".
    const keys = await listKeys(`regs/${eventId}/`);
    if (keys.length <= ev.quota) await syncSeats(eventId, 'up', keys.length);
    if (keys.length > ev.quota) {
      const all = (await mapLimit(keys, 25, getJSON)).filter(Boolean)
        .sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.id - b.id);
      const rank = all.findIndex(r => r.studentId === user.studentId);
      if (rank >= ev.quota) {
        await store().delete(regKey);
        await store().delete(`tokens/${token}`);
        await changeSeats(eventId, -1);
        return fail('FULL', 'Activity Full (Limit Reached)');
      }
    }

    await store().setJSON(`myregs/${user.studentId}/${eventId}`, { eventId });
    return { ok: true, registration: toRegistrationDTO(reg), event: await getEvent(eventId) };
  } catch (err) {
    await changeSeats(eventId, -1).catch(() => {});
    if (token) await store().delete(`tokens/${token}`).catch(() => {});
    throw err;
  }
}

/** A student's own passes, newest first, each with its event. */
export async function listRegistrationsForStudent(studentId) {
  const keys = await listKeys(`myregs/${studentId}/`);
  const eventIds = keys.map(k => Number(k.split('/').pop()));
  const rows = await mapLimit(eventIds, 20, async eventId => {
    const [reg, ev] = await Promise.all([getJSON(`regs/${eventId}/${studentId}`), getEventRecord(eventId)]);
    return reg && ev ? { ...toRegistrationDTO(reg), event: toEventDTO(ev) } : null;
  });
  return rows.filter(Boolean).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
}

/** Organizer roster, optionally for one event. */
export async function listRoster(eventId = null) {
  let regs;
  if (eventId) {
    regs = await registrationsForEvent(eventId);
  } else {
    const keys = await listKeys('regs/');
    regs = (await mapLimit(keys, 25, getJSON)).filter(Boolean);
  }
  const events = new Map((await listEvents()).map(e => [e.id, e]));
  return regs
    .filter(r => events.has(r.eventId))
    .sort((a, b) => events.get(a.eventId).startTime.localeCompare(events.get(b.eventId).startTime) ||
                    a.registeredAt.localeCompare(b.registeredAt))
    .map(r => ({
      ...toRegistrationDTO(r),
      student: { studentId: r.studentId, ...r.student },
      eventTitle: events.get(r.eventId).title
    }));
}

/** Returns the updated registration, or null if not found. */
export async function setRegistrationStatus(eventId, studentId, status) {
  return update(`regs/${eventId}/${studentId}`, reg => {
    if (!reg) return { result: null };
    const updated = { ...reg, status, checkedInAt: status === STATUS.CHECKED_IN ? nowISO() : null };
    return { write: updated, result: toRegistrationDTO(updated) };
  });
}

/**
 * Door check-in by token. If expectedEventId is given, a pass for any other
 * activity is refused (WRONG_EVENT) and NOT checked in.
 * Returns { result: 'INVALID' }
 *       | { result: 'WRONG_EVENT' | 'ALREADY' | 'OK', studentName, studentId, eventTitle, checkedInAt? }
 */
export async function checkInByToken(token, expectedEventId = null) {
  const t = String(token).toUpperCase();
  const idx = await getJSON(`tokens/${t}`);
  if (!idx) return { result: 'INVALID' };
  const ev = await getEventRecord(idx.eventId);
  if (!ev) return { result: 'INVALID' };

  if (expectedEventId && Number(idx.eventId) !== Number(expectedEventId)) {
    const reg = await getJSON(`regs/${idx.eventId}/${idx.studentId}`);
    if (!reg || reg.token !== t) return { result: 'INVALID' };
    return { result: 'WRONG_EVENT', studentName: reg.student.name, studentId: reg.studentId, eventTitle: ev.title };
  }

  return update(`regs/${idx.eventId}/${idx.studentId}`, reg => {
    if (!reg || reg.token !== t) return { result: { result: 'INVALID' } };
    const info = { studentName: reg.student.name, studentId: reg.studentId, eventTitle: ev.title };
    if (reg.status === STATUS.CHECKED_IN) return { result: { result: 'ALREADY', ...info, checkedInAt: reg.checkedInAt } };
    const at = nowISO();
    return { write: { ...reg, status: STATUS.CHECKED_IN, checkedInAt: at }, result: { result: 'OK', ...info, checkedInAt: at } };
  });
}
