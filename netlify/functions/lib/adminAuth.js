// Single-admin session auth. No user accounts — just one shared password
// (ADMIN_PASSWORD) gating access, and a signed, httpOnly session cookie so
// the browser doesn't need to resend the password on every request.

const crypto = require('crypto');

const COOKIE_NAME = 'cardify_admin';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('Server missing ADMIN_SESSION_SECRET');
  return secret;
}

function sign(payload) {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', getSecret()).update(b64).digest('base64url');
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function isAuthed(event) {
  const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
  return Boolean(verify(cookies[COOKIE_NAME]));
}

function checkPassword(candidate) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error('Server missing ADMIN_PASSWORD');
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sessionCookieHeader() {
  const token = sign({ exp: Date.now() + SESSION_TTL_MS });
  const isDev = process.env.NETLIFY_DEV === 'true';
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isDev ? '' : '; Secure'}`;
}

function clearCookieHeader() {
  const isDev = process.env.NETLIFY_DEV === 'true';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isDev ? '' : '; Secure'}`;
}

module.exports = { isAuthed, checkPassword, sessionCookieHeader, clearCookieHeader };
