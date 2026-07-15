const { isAuthed } = require('./lib/adminAuth');
const { listScans } = require('./lib/scanLog');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if (!isAuthed(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  try {
    const scans = await listScans({ limit: 300 });
    return { statusCode: 200, body: JSON.stringify({ scans }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unknown error' }) };
  }
};
