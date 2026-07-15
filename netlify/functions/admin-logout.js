const { clearCookieHeader } = require('./lib/adminAuth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  return {
    statusCode: 200,
    headers: { 'Set-Cookie': clearCookieHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  };
};
