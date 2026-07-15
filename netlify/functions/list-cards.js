const { getSupabaseAdmin } = require('./lib/supabaseAdmin');

const SIGNED_URL_TTL_SECONDS = 3600;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const supabase = getSupabaseAdmin();
    const params = event.queryStringParameters || {};
    const game = params.game;

    let query = supabase
      .from('pregrades')
      .select('id, created_at, game, card_name, set_name, card_number, front_image_url, back_image_url, psa_estimate, cgc_estimate, bgs_estimate, tag_estimate')
      .order('created_at', { ascending: false });

    if (game === 'pokemon' || game === 'onepiece') {
      query = query.eq('game', game);
    }

    const { data, error } = await query;
    if (error) throw error;

    const withUrls = await Promise.all((data || []).map(async (row) => {
      const { data: signed } = await supabase.storage
        .from('card-images')
        .createSignedUrl(row.front_image_url, SIGNED_URL_TTL_SECONDS);
      return { ...row, front_thumb_url: signed ? signed.signedUrl : null };
    }));

    return { statusCode: 200, body: JSON.stringify({ cards: withUrls }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unknown error' }) };
  }
};
