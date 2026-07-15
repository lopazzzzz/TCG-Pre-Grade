const { SYSTEM_PROMPT, buildUserText, parseGradingResponse, computeCompanyEstimates } = require('./lib/gradingPrompt');
const { logScan } = require('./lib/scanLog');

const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const IMAGE_LABELS = [
  'front full', 'back full',
  'front top-left corner', 'front top-right corner', 'front bottom-left corner', 'front bottom-right corner',
  'back top-left corner', 'back top-right corner', 'back bottom-left corner', 'back bottom-right corner',
];

function dataUrlToInlineData(dataUrl) {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Invalid image data URL');
  return { inline_data: { mime_type: match[1], data: match[2] } };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const {
      game, cardName, setName, cardNumber,
      centeringFrontRatio, centeringBackRatio,
      images,
    } = body;

    if (!game || !centeringFrontRatio || !centeringBackRatio || !images) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const orderedImages = [
      images.frontFull, images.backFull,
      ...(images.frontCorners || []),
      ...(images.backCorners || []),
    ];

    if (orderedImages.length !== 10 || orderedImages.some((i) => !i)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Expected 10 images: front, back, 4 front corners, 4 back corners' }) };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Server missing GEMINI_API_KEY' }) };
    }

    const parts = [
      { text: buildUserText({ game, cardName, setName, cardNumber, centeringFrontRatio, centeringBackRatio }) },
    ];
    orderedImages.forEach((dataUrl, i) => {
      parts.push({ text: `Image ${i + 1}: ${IMAGE_LABELS[i]}` });
      parts.push(dataUrlToInlineData(dataUrl));
    });

    const requestBody = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1500 },
    };

    // Use the x-goog-api-key header (not ?key= query param) — this is the
    // method Google's current docs show, and the one confirmed to work with
    // both legacy "AIza" Standard keys and the newer "AQ.Ab" Auth keys that
    // Google AI Studio now issues by default.
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(requestBody),
    });

    const json = await res.json();
    if (!res.ok) {
      const message = json.error?.message || `Gemini API error (HTTP ${res.status})`;
      return { statusCode: 502, body: JSON.stringify({ error: message }) };
    }

    const text = json.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
    if (!text) throw new Error('No text response from Gemini');

    const graded = parseGradingResponse(text);
    const estimates = computeCompanyEstimates({
      centeringFrontRatio,
      centeringBackRatio,
      corners: graded.corners_score,
      surface: graded.surface_score,
      edges: graded.edges_score,
    });

    // Log every completed scan for the admin dashboard. Best-effort: a
    // logging failure should never break the user-facing analysis result.
    try {
      await logScan({ event, game, cardName, setName, cardNumber, centeringFrontRatio, centeringBackRatio, graded, estimates, images });
    } catch (logErr) {
      console.error('scan log write failed', logErr);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
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
        ai_raw_response: json,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unknown error' }) };
  }
};
