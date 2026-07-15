const { randomUUID } = require('crypto');
const { getSupabaseAdmin } = require('./lib/supabaseAdmin');

function dataUrlToBuffer(dataUrl) {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Invalid image data URL');
  return { contentType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      game, cardName, setName, cardNumber,
      frontImageDataUrl, backImageDataUrl,
      centering, cornersScore, surfaceScore, edgesScore,
      companies, defects, aiRawResponse, notes,
    } = body;

    if (!game || !frontImageDataUrl || !backImageDataUrl || !centering || !companies) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const supabase = getSupabaseAdmin();
    const id = randomUUID();

    const front = dataUrlToBuffer(frontImageDataUrl);
    const back = dataUrlToBuffer(backImageDataUrl);
    const frontExt = front.contentType.split('/')[1] || 'jpg';
    const backExt = back.contentType.split('/')[1] || 'jpg';
    const frontPath = `${id}/front.${frontExt}`;
    const backPath = `${id}/back.${backExt}`;

    const [frontUpload, backUpload] = await Promise.all([
      supabase.storage.from('card-images').upload(frontPath, front.buffer, { contentType: front.contentType, upsert: false }),
      supabase.storage.from('card-images').upload(backPath, back.buffer, { contentType: back.contentType, upsert: false }),
    ]);
    if (frontUpload.error) throw frontUpload.error;
    if (backUpload.error) throw backUpload.error;

    const { error: insertError } = await supabase.from('pregrades').insert({
      id,
      game,
      card_name: cardName || null,
      set_name: setName || null,
      card_number: cardNumber || null,
      front_image_url: frontPath,
      back_image_url: backPath,
      centering_score: centering.score,
      centering_front_ratio: centering.front_ratio,
      centering_back_ratio: centering.back_ratio,
      corners_score: cornersScore,
      surface_score: surfaceScore,
      edges_score: edgesScore,
      psa_estimate: companies.psa.estimate,
      psa_confidence: companies.psa.confidence,
      cgc_estimate: companies.cgc.estimate,
      cgc_confidence: companies.cgc.confidence,
      bgs_estimate: companies.bgs.estimate,
      bgs_confidence: companies.bgs.confidence,
      tag_estimate: companies.tag.estimate,
      tag_confidence: companies.tag.confidence,
      defects: defects || [],
      ai_raw_response: aiRawResponse || null,
      notes: notes || null,
    });
    if (insertError) throw insertError;

    return { statusCode: 200, body: JSON.stringify({ id }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unknown error' }) };
  }
};
