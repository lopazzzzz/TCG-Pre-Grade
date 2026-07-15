const Anthropic = require('@anthropic-ai/sdk');
const { SYSTEM_PROMPT, buildUserText, parseGradingResponse, computeCompanyEstimates } = require('./lib/claudePrompt');

const IMAGE_LABELS = [
  'front full', 'back full',
  'front top-left corner', 'front top-right corner', 'front bottom-left corner', 'front bottom-right corner',
  'back top-left corner', 'back top-right corner', 'back bottom-left corner', 'back bottom-right corner',
];

function dataUrlToBlock(dataUrl) {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) throw new Error('Invalid image data URL');
  return {
    type: 'image',
    source: { type: 'base64', media_type: match[1], data: match[2] },
  };
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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Server missing ANTHROPIC_API_KEY' }) };
    }

    const anthropic = new Anthropic({ apiKey });

    const content = [
      { type: 'text', text: buildUserText({ game, cardName, setName, cardNumber, centeringFrontRatio, centeringBackRatio }) },
    ];
    orderedImages.forEach((dataUrl, i) => {
      content.push({ type: 'text', text: `Image ${i + 1}: ${IMAGE_LABELS[i]}` });
      content.push(dataUrlToBlock(dataUrl));
    });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('No text response from Claude');

    const graded = parseGradingResponse(textBlock.text);
    const estimates = computeCompanyEstimates({
      centeringFrontRatio,
      centeringBackRatio,
      corners: graded.corners_score,
      surface: graded.surface_score,
      edges: graded.edges_score,
    });

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
        ai_raw_response: message,
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Unknown error' }) };
  }
};
