import { checkPassword, sessionCookieHeader } from '../../lib/adminAuth.js';

export async function onRequestPost({ request, env }) {
  try {
    const { password } = await request.json().catch(() => ({}));
    if (!checkPassword(password, env)) {
      return Response.json({ error: 'Incorrect password' }, { status: 401 });
    }

    return Response.json(
      { ok: true },
      { headers: { 'Set-Cookie': await sessionCookieHeader(request, env) } },
    );
  } catch (err) {
    return Response.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}
