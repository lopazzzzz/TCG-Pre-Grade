// Every completed analysis gets logged here automatically (not opt-in) so
// the admin dashboard has a full audit trail of what was scanned, by whom
// (best-effort via request IP, no accounts), and what grade came back.
// Storage is a single Cloudflare R2 bucket (binding name SCAN_BUCKET), split
// by key prefix: `meta/...json` for the record, `images/...jpg` for photos.

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || null;
}

async function logScan(env, { request, game, cardName, setName, cardNumber, centeringFrontRatio, centeringBackRatio, graded, estimates, images }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const meta = {
    id,
    createdAt,
    ip: clientIp(request),
    game,
    cardName: cardName || null,
    setName: setName || null,
    cardNumber: cardNumber || null,
    frontThumb: images.frontThumb || null,
    centering: {
      score: estimates.centering_display_score,
      front_ratio: centeringFrontRatio,
      back_ratio: centeringBackRatio,
    },
    corners_score: graded.corners_score,
    surface_score: graded.surface_score,
    edges_score: graded.edges_score,
    defects: graded.defects,
    summary: graded.summary,
    companies: {
      psa: { estimate: estimates.psa_estimate, confidence: estimates.psa_confidence },
      cgc: { estimate: estimates.cgc_estimate, confidence: estimates.cgc_confidence },
      bgs: { estimate: estimates.bgs_estimate, confidence: estimates.bgs_confidence },
      tag: { estimate: estimates.tag_estimate, confidence: estimates.tag_confidence },
    },
  };

  const bucket = env.SCAN_BUCKET;
  await Promise.all([
    bucket.put(`meta/${createdAt}__${id}.json`, JSON.stringify(meta), { httpMetadata: { contentType: 'application/json' } }),
    bucket.put(`images/${id}-front.jpg`, base64ToBytes(images.frontFull.split(',')[1]), { httpMetadata: { contentType: 'image/jpeg' } }),
    bucket.put(`images/${id}-back.jpg`, base64ToBytes(images.backFull.split(',')[1]), { httpMetadata: { contentType: 'image/jpeg' } }),
  ]);

  return id;
}

async function listScans(env, { limit = 200 } = {}) {
  const bucket = env.SCAN_BUCKET;
  const keys = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix: 'meta/', cursor, limit: 1000 });
    keys.push(...page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const sorted = keys.sort().reverse().slice(0, limit);
  const entries = await Promise.all(sorted.map(async (key) => {
    const obj = await bucket.get(key);
    return obj ? obj.json() : null;
  }));
  return entries.filter(Boolean);
}

async function findMetaKey(env, id) {
  const page = await env.SCAN_BUCKET.list({ prefix: 'meta/' });
  return page.objects.map((o) => o.key).find((k) => k.endsWith(`__${id}.json`));
}

async function getScan(env, id) {
  const key = await findMetaKey(env, id);
  if (!key) return null;
  const obj = await env.SCAN_BUCKET.get(key);
  return obj ? obj.json() : null;
}

async function getScanImage(env, id, side) {
  const obj = await env.SCAN_BUCKET.get(`images/${id}-${side}.jpg`);
  if (!obj) return null;
  return bytesToBase64(new Uint8Array(await obj.arrayBuffer()));
}

async function deleteScan(env, id) {
  const key = await findMetaKey(env, id);
  await Promise.all([
    key ? env.SCAN_BUCKET.delete(key) : Promise.resolve(),
    env.SCAN_BUCKET.delete(`images/${id}-front.jpg`),
    env.SCAN_BUCKET.delete(`images/${id}-back.jpg`),
  ]);
}

export { logScan, listScans, getScan, getScanImage, deleteScan };
