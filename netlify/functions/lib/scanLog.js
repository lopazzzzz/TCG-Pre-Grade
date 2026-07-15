// Every completed analysis gets logged here automatically (not opt-in) so
// the admin dashboard has a full audit trail of what was scanned, by whom
// (best-effort via request IP, no accounts), and what grade came back.
// Storage is Netlify Blobs — no external database/account needed, it's
// built into the Netlify site itself.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

function metaStore() {
  return getStore('cardify-scan-logs');
}
function imageStore() {
  return getStore('cardify-scan-images');
}

function clientIp(event) {
  const header = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'];
  if (!header) return null;
  return header.split(',')[0].trim();
}

async function logScan({ event, game, cardName, setName, cardNumber, centeringFrontRatio, centeringBackRatio, graded, estimates, images }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const meta = {
    id,
    createdAt,
    ip: clientIp(event),
    game,
    cardName: cardName || null,
    setName: setName || null,
    cardNumber: cardNumber || null,
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

  const images_store = imageStore();
  await Promise.all([
    metaStore().setJSON(`${createdAt}__${id}.json`, meta),
    images_store.set(`${id}-front.jpg`, images.frontFull.split(',')[1], { encoding: 'base64' }),
    images_store.set(`${id}-back.jpg`, images.backFull.split(',')[1], { encoding: 'base64' }),
  ]);

  return id;
}

async function listScans({ limit = 200 } = {}) {
  const store = metaStore();
  const { blobs } = await store.list();
  const sorted = blobs.map((b) => b.key).sort().reverse().slice(0, limit);
  const entries = await Promise.all(sorted.map((key) => store.get(key, { type: 'json' })));
  return entries.filter(Boolean);
}

async function getScan(id) {
  const store = metaStore();
  const { blobs } = await store.list();
  const key = blobs.map((b) => b.key).find((k) => k.endsWith(`__${id}.json`));
  if (!key) return null;
  return store.get(key, { type: 'json' });
}

async function getScanImage(id, side) {
  const buf = await imageStore().get(`${id}-${side}.jpg`, { type: 'arrayBuffer' });
  return buf ? Buffer.from(buf) : null;
}

async function deleteScan(id) {
  const store = metaStore();
  const { blobs } = await store.list();
  const key = blobs.map((b) => b.key).find((k) => k.endsWith(`__${id}.json`));
  await Promise.all([
    key ? store.delete(key) : Promise.resolve(),
    imageStore().delete(`${id}-front.jpg`),
    imageStore().delete(`${id}-back.jpg`),
  ]);
}

module.exports = { logScan, listScans, getScan, getScanImage, deleteScan };
