import { isAuthed } from '../../lib/adminAuth.js';
import { deleteScan } from '../../lib/scanLog.js';

export async function onRequestPost({ request, env }) {
  if (!(await isAuthed(request, env))) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id } = await request.json().catch(() => ({}));
    if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
    await deleteScan(env, id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}
