// Grading rubric, prompt construction, and per-grading-company estimate math.
//
// Centering is measured geometrically by the client (see js/centering.js) and
// passed in as ground truth — the vision model is only asked to judge
// Corners/Surface/Edges, which are genuinely visual/subjective calls a vision
// model is suited for. The per-company overall-grade formulas below are
// approximations built
// from each company's published grading standards:
//  - BGS publishes its weighted-average formula and Black Label rule, so that
//    part is a faithful implementation, not a guess.
//  - TAG publishes tight numeric centering tolerance tiers (its main
//    differentiator), which we encode directly.
//  - PSA and CGC don't publish an exact formula; we use the commonly
//    documented "worst factor gates the grade" heuristic, tuned with each
//    company's known tendencies. These two are explicitly lower-confidence.

const SYSTEM_PROMPT = `You are an expert trading card grader trained on the published grading standards of PSA, BGS (Beckett), CGC, and TAG, evaluating Pokemon and One Piece TCG cards.

You will be shown: a full front photo, a full back photo, and four zoomed corner crops each for front and back. You will also be told the card's precisely MEASURED centering ratio (front and back) — do not re-estimate centering, it is provided as ground truth.

Your job is to judge only:
1. CORNERS — sharpness, whitening, fraying, rounding, on all 8 corners (4 front + 4 back). A single soft/whitened corner caps the score.
2. SURFACE — scratches, print lines, indentations, scuffs, holo/foil scratches, staining, gloss consistency, on both front and back.
3. EDGES — whitening, chipping, roughness, nicks along all edges, front and back.

Score each 1-10 in 0.5 increments, using this scale as a guide (matching PSA/BGS/CGC conventions):
- 10 = flawless under close inspection
- 9-9.5 = essentially flawless, at most one truly minor/microscopic flaw
- 8-8.5 = one small visible flaw or light wear
- 7-7.5 = a couple of noticeable flaws
- 6 and below = multiple or significant flaws

For every flaw you notice, add an entry to "defects" with:
- category: "corners" | "surface" | "edges"
- side: "front" | "back"
- zone: which ninth of the card the flaw is in, imagining the card divided into a 3x3 grid — one of: "top-left", "top-center", "top-right", "middle-left", "center", "middle-right", "bottom-left", "bottom-center", "bottom-right"
- location: a short human-readable location, e.g. "front top-left corner", "back surface, center-right", "front bottom edge"
- description: what the flaw is
- severity: "minor" | "moderate" | "major"

Respond with ONLY a JSON object, no markdown fences, no commentary, matching exactly:
{
  "corners_score": number,
  "surface_score": number,
  "edges_score": number,
  "defects": [ { "category": string, "side": string, "zone": string, "location": string, "description": string, "severity": string } ],
  "summary": string
}`;

function buildUserText({ game, cardName, setName, cardNumber, centeringFrontRatio, centeringBackRatio }) {
  const label = game === 'onepiece' ? 'One Piece TCG' : 'Pokemon TCG';
  const idBits = [cardName, setName, cardNumber].filter(Boolean).join(' / ');
  return [
    `Card game: ${label}`,
    idBits ? `Card identity: ${idBits}` : null,
    `Measured centering (front, ground truth, do not re-estimate): ${centeringFrontRatio}`,
    `Measured centering (back, ground truth, do not re-estimate): ${centeringBackRatio}`,
    'Images below in order: front full, back full, front top-left corner, front top-right corner, front bottom-left corner, front bottom-right corner, back top-left corner, back top-right corner, back bottom-left corner, back bottom-right corner.',
  ].filter(Boolean).join('\n');
}

const VALID_ZONES = new Set([
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]);

function normalizeDefect(d) {
  return {
    category: typeof d.category === 'string' ? d.category : 'surface',
    side: d.side === 'back' ? 'back' : 'front',
    zone: VALID_ZONES.has(d.zone) ? d.zone : 'center',
    location: typeof d.location === 'string' ? d.location : '',
    description: typeof d.description === 'string' ? d.description : '',
    severity: ['minor', 'moderate', 'major'].includes(d.severity) ? d.severity : 'minor',
  };
}

function parseGradingResponse(text) {
  const cleaned = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const parsed = JSON.parse(cleaned);

  const num = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('Non-numeric score in Claude response');
    return Math.min(10, Math.max(1, Math.round(n * 2) / 2));
  };

  return {
    corners_score: num(parsed.corners_score),
    surface_score: num(parsed.surface_score),
    edges_score: num(parsed.edges_score),
    defects: Array.isArray(parsed.defects) ? parsed.defects.map(normalizeDefect) : [],
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  };
}

// ---- Centering ratio helpers ----

// Ratio text like "58/42" -> larger side as a percentage (e.g. 58).
function ratioMetric(ratioText) {
  const parts = String(ratioText).split('/').map((p) => parseFloat(p));
  if (parts.length !== 2 || parts.some((p) => Number.isNaN(p))) return 50;
  return Math.max(parts[0], parts[1]);
}

function scoreFromThresholds(metric, thresholds) {
  for (const t of thresholds) {
    if (metric <= t.max) return t.score;
  }
  return thresholds[thresholds.length - 1].score - 1.5 > 0
    ? thresholds[thresholds.length - 1].score - 1.5
    : 1;
}

// General-purpose centering thresholds, based on PSA's widely-cited public
// numbers — used for the "Centering" sub-score shown in the UI, and as the
// baseline for PSA/CGC/BGS company math.
const GENERIC_FRONT_THRESHOLDS = [
  { max: 55, score: 10 },
  { max: 60, score: 9 },
  { max: 65, score: 8 },
  { max: 70, score: 7 },
  { max: 80, score: 6 },
  { max: 85, score: 5 },
];
const GENERIC_BACK_THRESHOLDS = [
  { max: 75, score: 10 },
  { max: 90, score: 9 },
  { max: 90, score: 8 },
  { max: 95, score: 7 },
];

// TAG publishes tighter TCG-specific tolerance tiers — its signature
// differentiator versus the other three companies.
const TAG_FRONT_THRESHOLDS = [
  { max: 52, score: 10 },
  { max: 55, score: 9.5 },
  { max: 60, score: 9 },
  { max: 65, score: 8.5 },
  { max: 70, score: 8 },
  { max: 80, score: 7 },
  { max: 90, score: 6 },
];
const TAG_BACK_THRESHOLDS = [
  { max: 52, score: 10 },
  { max: 65, score: 9.5 },
  { max: 75, score: 9 },
  { max: 85, score: 8 },
  { max: 95, score: 7 },
];

function centeringSubscore(frontRatio, backRatio, frontThresholds, backThresholds) {
  const frontScore = scoreFromThresholds(ratioMetric(frontRatio), frontThresholds);
  const backScore = scoreFromThresholds(ratioMetric(backRatio), backThresholds);
  // Back centering rarely gates the grade unless it is unusually bad —
  // weight it lightly against the front.
  return Math.round((frontScore * 0.8 + backScore * 0.2) * 2) / 2;
}

function roundHalf(n) {
  return Math.round(n * 2) / 2;
}

function clampScore(n) {
  return Math.min(10, Math.max(1, n));
}

// "Worst factor gates the grade" heuristic used for PSA and CGC, since
// neither company publishes an exact overall-grade formula.
function worstFactorGate(scores, leniency) {
  const min = Math.min(...scores);
  const minIndex = scores.indexOf(min);
  const others = scores.filter((_, i) => i !== minIndex);
  const avgOthers = others.reduce((a, b) => a + b, 0) / (others.length || 1);
  return clampScore(roundHalf(min + leniency * (avgOthers - min)));
}

function bgsFormula(centering, corners, edges, surface) {
  const raw = (centering + corners + edges + 2 * surface) / 5;
  const rounded = roundHalf(raw);
  const lowest = Math.min(centering, corners, edges, surface);
  const capped = Math.min(rounded, lowest + 1);
  const blackLabel = [centering, corners, edges, surface].every((s) => s >= 9.5);
  if (blackLabel) return clampScore(10);
  return clampScore(Math.min(capped, 9.5));
}

function confidenceFor({ baseConfidence, centeringFrontRatio, centeringBackRatio, thresholds, scores }) {
  let conf = baseConfidence;

  const frontMetric = ratioMetric(centeringFrontRatio);
  const nearestBoundaryDist = Math.min(...thresholds.map((t) => Math.abs(t.max - frontMetric)));
  if (nearestBoundaryDist <= 1.5) conf -= 15;
  else if (nearestBoundaryDist <= 3) conf -= 7;

  const spread = Math.max(...scores) - Math.min(...scores);
  if (spread > 2.5) conf -= 12;
  else if (spread > 1.5) conf -= 6;

  if (scores.every((s) => s >= 9.5)) conf += 10;

  return Math.min(95, Math.max(30, Math.round(conf)));
}

function computeCompanyEstimates({ centeringFrontRatio, centeringBackRatio, corners, surface, edges }) {
  const genericCentering = centeringSubscore(
    centeringFrontRatio, centeringBackRatio, GENERIC_FRONT_THRESHOLDS, GENERIC_BACK_THRESHOLDS
  );
  const tagCentering = centeringSubscore(
    centeringFrontRatio, centeringBackRatio, TAG_FRONT_THRESHOLDS, TAG_BACK_THRESHOLDS
  );

  const psaScore = worstFactorGate([genericCentering, corners, edges, surface], 0.3);
  const cgcScore = worstFactorGate([genericCentering, corners, edges, surface], 0.4);
  const bgsScore = bgsFormula(genericCentering, corners, edges, surface);
  const tagScore = worstFactorGate([tagCentering, corners, edges, surface], 0.25);

  return {
    centering_display_score: genericCentering,
    psa_estimate: psaScore,
    psa_confidence: confidenceFor({
      baseConfidence: 60,
      centeringFrontRatio, centeringBackRatio,
      thresholds: GENERIC_FRONT_THRESHOLDS,
      scores: [genericCentering, corners, edges, surface],
    }),
    cgc_estimate: cgcScore,
    cgc_confidence: confidenceFor({
      baseConfidence: 55,
      centeringFrontRatio, centeringBackRatio,
      thresholds: GENERIC_FRONT_THRESHOLDS,
      scores: [genericCentering, corners, edges, surface],
    }),
    bgs_estimate: bgsScore,
    bgs_confidence: confidenceFor({
      baseConfidence: 65,
      centeringFrontRatio, centeringBackRatio,
      thresholds: GENERIC_FRONT_THRESHOLDS,
      scores: [genericCentering, corners, edges, surface],
    }),
    tag_estimate: tagScore,
    tag_confidence: confidenceFor({
      baseConfidence: 78,
      centeringFrontRatio, centeringBackRatio,
      thresholds: TAG_FRONT_THRESHOLDS,
      scores: [tagCentering, corners, edges, surface],
    }),
  };
}

export {
  SYSTEM_PROMPT,
  buildUserText,
  parseGradingResponse,
  computeCompanyEstimates,
};
