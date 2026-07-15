import { isAuthed } from '../../lib/adminAuth.js';
import { getScan, getScanImage } from '../../lib/scanLog.js';

export async function onRequestGet({ request, env }) {
  if (!(await isAuthed(request, env))) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });

    const scan = await getScan(env, id);
    if (!scan) return Response.json({ error: 'Not found' }, { status: 404 });

    const [front, back] = await Promise.all([getScanImage(env, id, 'front'), getScanImage(env, id, 'back')]);

    return Response.json({
      ...scan,
      front_image_data_url: front ? `data:image/jpeg;base64,${front}` : null,
      back_image_data_url: back ? `data:image/jpeg;base64,${back}` : null,
    });
  } catch (err) {
    return Response.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}
