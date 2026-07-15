const { isAuthed } = require('./lib/adminAuth');
const { getScan, getScanImage } = require('./lib/scanLog');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if (!isAuthed(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  try {
    const id = (event.queryStringParameters || {}).id;
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };

    const scan = await getScan(id);
    if (!scan) return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };

    const [front, back] = await Promise.all([getScanImage(id, 'front'), getScanImage(id, 'back')]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ...scan,
        front_image_data_url: front ? `data:image/jpeg;base64,${front.toString('base64')}` : null,
        back_image_data_url: back ? `data:image/jpeg;base64,${back.toString('base64')}` : null,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unknown error' }) };
  }
};
