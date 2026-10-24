/* =====================================================================
 * CUVA Portal — API (Netlify Function, handles every /api/* request)
 * Permission checks happen HERE, on the server.
 *   access levels:  public | user | organizer | super
 * ===================================================================== */
import * as db from '../lib/database.mjs';
import * as v from '../lib/validate.mjs';

export const config = { path: '/api/*' };

const COOKIE_NAME = 'cuva_session';
const MAX_BODY_BYTES = 64 * 1024;

class HttpError extends Error {
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// =====================================================================
// ROUTES
// =====================================================================
const routes = [];
function route(method, pattern, access, handler) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, regex, keys, access, handler });
}

// ---------- Session & auth ----------
route('GET', '/api/session', 'public', ({ user }) => ({ user, superAdminId: db.SUPER_ADMIN_ID }));

route('POST', '/api/auth/signup', 'public', async ({ body, setSession }) => {
  const data = v.signup(body);
  if (data.studentId === db.SUPER_ADMIN_ID) {
    throw new HttpError(403, 'This Student ID is reserved for the Super Admin. Please sign in instead.');
  }
  const user = await db.createUser(data);
  if (!user) throw new HttpError(409, `Student ID ${data.studentId} is already registered! Please Sign In.`, 'EXISTS');
  await setSession(user.studentId);
  return { user };
});

route('POST', '/api/auth/signin', 'public', async ({ body, setSession }) => {
  const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^\d{6,16}$/.test(studentId) || !password || password.length > 128) {
    throw new HttpError(401, 'Invalid Student ID or password. Please try again.');
  }

  const result = await db.authenticate(studentId, password);
  if (result.error === 'LOCKED') {
    throw new HttpError(429, `Too many wrong passwords. This account is locked for ${result.minutes} more minute(s).`);
  }
  if (!result.user) throw new HttpError(401, 'Invalid Student ID or password. Please try again.');

  await setSession(result.user.studentId);
  return { user: result.user };
});

route('POST', '/api/auth/signout', 'public', ({ clearSession }) => {
  clearSession();
  return { ok: true };
});

// ---------- Public ----------
route('GET', '/api/events', 'public', async () => ({ events: await db.listEvents() }));
route('GET', '/api/categories', 'public', async () => ({ categories: await db.listCategories() }));

// ---------- Student ----------
route('GET', '/api/me/registrations', 'user', async ({ user }) => ({
  registrations: await db.listRegistrationsForStudent(user.studentId)
}));

route('POST', '/api/events/:id/register', 'user', async ({ user, params }) => {
  const result = await db.registerForEvent(v.positiveId(params.id, 'activity'), user);
  if (!result.ok) {
    const status = { NOT_FOUND: 404, ALREADY: 409 }[result.code] || 422;
    const extra = result.code === 'ALREADY' ? { registration: result.registration, event: result.event } : undefined;
    throw new HttpError(status, result.message, result.code, extra);
  }
  return { registration: result.registration, event: result.event };
});

// ---------- Organizer: activities ----------
route('POST', '/api/events', 'organizer', async ({ body }) => ({
  event: await db.createEvent(await v.eventPayload(body, db.categoryExists))
}));

route('PUT', '/api/events/:id', 'organizer', async ({ body, params }) => {
  const id = v.positiveId(params.id, 'activity');
  const existing = await db.getEvent(id);
  if (!existing) throw new HttpError(404, 'Activity not found.');
  // Allow keeping a category that was since deleted from the list
  const data = await v.eventPayload(body, async name => name === existing.category || db.categoryExists(name));
  const event = await db.updateEvent(id, data);
  if (!event) throw new HttpError(404, 'Activity not found.');
  return { event };
});

route('DELETE', '/api/events/:id', 'organizer', async ({ params }) => {
  const cancelled = await db.deleteEvent(v.positiveId(params.id, 'activity'));
  if (cancelled < 0) throw new HttpError(404, 'Activity not found.');
  return { ok: true, cancelledPasses: cancelled };
});

// ---------- Organizer: categories ----------
route('POST', '/api/categories', 'organizer', async ({ body }) => {
  const category = await db.addCategory(v.text(body.name, 'Category name', { max: 40 }));
  if (!category) throw new HttpError(409, 'Category already exists.');
  return { category };
});

route('PUT', '/api/categories/:id', 'organizer', async ({ body, params }) => {
  const result = await db.renameCategory(v.positiveId(params.id, 'category'), v.text(body.name, 'Category name', { max: 40 }));
  if (result === 'NOT_FOUND') throw new HttpError(404, 'Category not found.');
  if (result === 'EXISTS') throw new HttpError(409, 'A category with that name already exists.');
  return { ok: true };
});

route('DELETE', '/api/categories/:id', 'organizer', async ({ params }) => {
  const result = await db.deleteCategory(v.positiveId(params.id, 'category'));
  if (result === 'NOT_FOUND') throw new HttpError(404, 'Category not found.');
  if (result === 'LAST') throw new HttpError(422, 'You must maintain at least one category.');
  return { ok: true };
});

// ---------- Organizer: roster & door ----------
route('GET', '/api/admin/registrations', 'organizer', async ({ query }) => {
  const eventId = query.get('eventId');
  return { registrations: await db.listRoster(eventId ? v.positiveId(eventId, 'activity') : null) };
});

route('PATCH', '/api/admin/registrations/:id', 'organizer', async ({ body, params }) => {
  if (!Object.values(db.STATUS).includes(body.status)) throw new HttpError(400, 'Invalid status.');
  v.positiveId(params.id, 'registration');
  const registration = await db.setRegistrationStatus(
    v.positiveId(body.eventId, 'activity'), v.studentId(String(body.studentId ?? '')), body.status);
  if (!registration) throw new HttpError(404, 'Registration not found.');
  return { registration };
});

route('POST', '/api/admin/checkin', 'organizer', async ({ body }) => {
  const token = typeof body.token === 'string' ? body.token.trim().toUpperCase() : '';
  if (!token || token.length > 64 || !/^[A-Z0-9-]+$/.test(token)) {
    return { result: 'INVALID' };
  }
  const eventId = body.eventId ? v.positiveId(body.eventId, 'activity') : null;
  return db.checkInByToken(token, eventId);
});

// ---------- Super Admin ----------
route('GET', '/api/admin/organizers', 'super', async () => ({ organizers: await db.listOrganizers() }));

route('POST', '/api/admin/organizers', 'super', async ({ body }) => {
  const id = v.studentId(body.studentId);
  if (!(await db.addOrganizer(id))) throw new HttpError(409, `Student ID ${id} already has organizer privileges.`);
  return { organizers: await db.listOrganizers() };
});

route('DELETE', '/api/admin/organizers/:studentId', 'super', async ({ params }) => {
  const id = decodeURIComponent(params.studentId);
  if (id === db.SUPER_ADMIN_ID) throw new HttpError(422, 'Root Super Admin cannot be removed.');
  if (!(await db.removeOrganizer(id))) throw new HttpError(404, 'That ID is not an organizer.');
  return { organizers: await db.listOrganizers() };
});

// =====================================================================
// REQUEST HANDLING
// =====================================================================
function match(method, pathname) {
  let pathMatched = false;
  for (const r of routes) {
    const m = r.regex.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    return { route: r, params };
  }
  return pathMatched ? { methodNotAllowed: true } : null;
}

function checkAccess(access, user) {
  if (access === 'public') return;
  if (!user) throw new HttpError(401, 'Please sign in first.', 'AUTH_REQUIRED');
  if (access === 'organizer' && !user.isOrganizer) throw new HttpError(403, 'Organizer privileges required.', 'FORBIDDEN');
  if (access === 'super' && !user.isSuperAdmin) throw new HttpError(403, `Only Super Admin (${db.SUPER_ADMIN_ID}) can modify privileges.`, 'FORBIDDEN');
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip bad cookie */ }
    }
  });
  return out;
}

function json(status, payload, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  cookies.forEach(c => headers.append('Set-Cookie', c));
  return new Response(JSON.stringify(payload), { status, headers });
}

export default async function handler(req) {
  const url = new URL(req.url);
  const method = req.method;
  const found = match(method, url.pathname.replace(/\/+$/, ''));
  if (!found) return json(404, { error: 'Not found.' });
  if (found.methodNotAllowed) return json(405, { error: 'Method not allowed.' });

  const setCookies = [];
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  const cookies = parseCookies(req.headers.get('cookie') || '');

  try {
    let body = {};
    if (method !== 'GET' && method !== 'HEAD') {
      // CSRF: refuse writes from other websites (SameSite cookies are the first line)
      const origin = req.headers.get('origin');
      if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Cross-site request blocked.');

      const raw = await req.text();
      if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large.');
      if (raw) {
        if (!(req.headers.get('content-type') || '').includes('application/json')) {
          throw new HttpError(415, 'Content-Type must be application/json.');
        }
        try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
      }
    }

    const user = await db.getSessionUser(cookies[COOKIE_NAME]);
    checkAccess(found.route.access, user);

    const result = await found.route.handler({
      user, body,
      params: found.params,
      query: url.searchParams,
      async setSession(studentId) {
        const { token, maxAgeSeconds } = await db.createSession(studentId);
        setCookies.push(`${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`);
      },
      clearSession() {
        setCookies.push(`${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
      }
    });
    return json(200, result, setCookies);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`${method} ${url.pathname}:`, err);
    return json(status, {
      error: status >= 500 && status !== 503 ? 'Something went wrong on the server. Please try again.' : err.message,
      code: err.code,
      ...(err.extra || {})
    });
  }
}
