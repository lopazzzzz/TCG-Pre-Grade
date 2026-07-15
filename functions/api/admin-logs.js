import { isAuthed } from '../../lib/adminAuth.js';
import { listScans } from '../../lib/scanLog.js';

export async function onRequestGet({ request, env }) {
  if (!(await isAuthed(request, env))) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const scans = await listScans(env, { limit: 300 });
    return Response.json({ scans });
  } catch (err) {
    return Response.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}
