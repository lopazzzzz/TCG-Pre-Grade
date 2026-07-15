import { clearCookieHeader } from '../../lib/adminAuth.js';

export async function onRequestPost({ request }) {
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearCookieHeader(request) } },
  );
}
