const { getSupabaseAdmin } = require('./lib/supabaseAdmin');

const SIGNED_URL_TTL_SECONDS = 3600;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const id = (event.queryStringParameters || {}).id;
    if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from('pregrades').select('*').eq('id', id).single();
    if (error) throw error;
    if (!data) return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };

    const [{ data: frontSigned }, { data: backSigned }] = await Promise.all([
      supabase.storage.from('card-images').createSignedUrl(data.front_image_url, SIGNED_URL_TTL_SECONDS),
      supabase.storage.from('card-images').createSignedUrl(data.back_image_url, SIGNED_URL_TTL_SECONDS),
    ]);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ...data,
        front_image_signed_url: frontSigned ? frontSigned.signedUrl : null,
        back_image_signed_url: backSigned ? backSigned.signedUrl : null,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unknown error' }) };
  }
};
