/* =====================================================================
 * Security helpers: password hashing and signed session cookies.
 * Node built-in crypto only.
 * ===================================================================== */
import crypto from 'node:crypto';

// ---------- Password hashing (scrypt, per-user random salt) ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scrypt(password, salt, keylen, opts) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Spend the same time when the account does not exist (prevents ID probing by timing)
let dummyHash = null;
export async function verifyAgainstDummy(password) {
  dummyHash ||= await hashPassword(crypto.randomBytes(12).toString('hex'));
  await verifyPassword(password, dummyHash);
  return false;
}

// ---------- Signed session tokens: base64url(payload).base64url(hmac) ----------
const b64url = buf => Buffer.from(buf).toString('base64url');

export function signSession(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Returns the payload if the signature is valid and not expired, else null. */
export function verifySession(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomSecret() {
  return crypto.randomBytes(48).toString('base64url');
}

export function randomCode(length, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

/** Numeric, time-ordered, collision-resistant ID (safe JS integer). */
export function newId() {
  return Date.now() * 1000 + crypto.randomInt(1000);
}
