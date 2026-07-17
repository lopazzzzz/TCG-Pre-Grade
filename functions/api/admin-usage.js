import { isAuthed } from '../../lib/adminAuth.js';
import { getQuotaStatus, resetQuota } from '../../lib/quota.js';

export async function onRequestGet({ request, env }) {
  if (!(await isAuthed(request, env))) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const status = await getQuotaStatus(env);
    return Response.json(status);
  } catch (err) {
    return Response.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  if (!(await isAuthed(request, env))) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    await resetQuota(env);
    const status = await getQuotaStatus(env);
    return Response.json(status);
  } catch (err) {
    return Response.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}
