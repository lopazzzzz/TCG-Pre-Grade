const { checkPassword, sessionCookieHeader } = require('./lib/adminAuth');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { password } = JSON.parse(event.body || '{}');
    if (!checkPassword(password)) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Incorrect password' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Set-Cookie': sessionCookieHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unknown error' }) };
  }
};
