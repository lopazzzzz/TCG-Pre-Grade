// Single-admin session auth. No user accounts — just one shared password
// (env.ADMIN_PASSWORD) gating access, and a signed, httpOnly session cookie
// so the browser doesn't need to resend the password on every request.
//
// Uses the Web Crypto API (crypto.subtle) instead of Node's `crypto` module,
// since Cloudflare Workers/Pages Functions run on a Workers runtime, not
// Node.js — Web Crypto is the portable, standard way to do HMAC signing here.

const COOKIE_NAME = 'cardify_admin';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function toBase64Url(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Constant-time string comparison — avoids leaking timing info about how
// many leading characters matched, which matters for password/signature
// checks even in a low-stakes personal tool.
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSign(data, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return toBase64Url(new Uint8Array(sigBuf));
}

async function sign(payload, secret) {
  const encoder = new TextEncoder();
  const b64 = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = await hmacSign(b64, secret);
  return `${b64}.${sig}`;
}

async function verify(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expectedSig = await hmacSign(b64, secret);
  if (!constantTimeEqual(sig, expectedSig)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(b64)));
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

function isLocalRequest(request) {
  try {
    const host = new URL(request.url).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

async function isAuthed(request, env) {
  if (!env.ADMIN_SESSION_SECRET) throw new Error('Server missing ADMIN_SESSION_SECRET');
  const cookies = parseCookies(request.headers.get('cookie'));
  return Boolean(await verify(cookies[COOKIE_NAME], env.ADMIN_SESSION_SECRET));
}

function checkPassword(candidate, env) {
  if (!env.ADMIN_PASSWORD) throw new Error('Server missing ADMIN_PASSWORD');
  return constantTimeEqual(String(candidate || ''), String(env.ADMIN_PASSWORD));
}

async function sessionCookieHeader(request, env) {
  if (!env.ADMIN_SESSION_SECRET) throw new Error('Server missing ADMIN_SESSION_SECRET');
  const token = await sign({ exp: Date.now() + SESSION_TTL_MS }, env.ADMIN_SESSION_SECRET);
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isLocalRequest(request) ? '' : '; Secure'}`;
}

function clearCookieHeader(request) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isLocalRequest(request) ? '' : '; Secure'}`;
}

export { isAuthed, checkPassword, sessionCookieHeader, clearCookieHeader };
