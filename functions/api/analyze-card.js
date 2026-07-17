import { SYSTEM_PROMPT, buildUserText, parseGradingResponse, computeCompanyEstimates } from '../../lib/gradingPrompt.js';
import { logScan } from '../../lib/scanLog.js';
import { getQuotaStatus, recordAnalysis } from '../../lib/quota.js';

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

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      game, cardName, setName, cardNumber,
      centeringFrontRatio, centeringBackRatio,
      images,
    } = body;

    if (!game || !centeringFrontRatio || !centeringBackRatio || !images) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const orderedImages = [
      images.frontFull, images.backFull,
      ...(images.frontCorners || []),
      ...(images.backCorners || []),
    ];

    if (orderedImages.length !== 10 || orderedImages.some((i) => !i)) {
      return Response.json({ error: 'Expected 10 images: front, back, 4 front corners, 4 back corners' }, { status: 400 });
    }

    const proxyUrl = env.GEMINI_PROXY_URL;
    const proxySecret = env.PROXY_SECRET;
    if (!proxyUrl || !proxySecret) {
      return Response.json({ error: 'Server missing GEMINI_PROXY_URL/PROXY_SECRET' }, { status: 500 });
    }

    // Self-enforced safety cap — stop making Gemini calls ourselves once
    // usage crosses a configurable share (default 70%) of a configurable
    // assumed daily free-tier limit, rather than relying on a billing
    // alert email that could go unnoticed. This is a personal-use safety
    // margin, not a precise mirror of Google's actual quota accounting.
    const quota = await getQuotaStatus(env);
    if (quota.blocked) {
      return Response.json({
        error: 'quota_paused',
        message: `Daily analysis limit reached (${quota.count}/${quota.limit}) — pre-grading is paused until it resets.`,
        resetAt: quota.resetAt,
        count: quota.count,
        limit: quota.limit,
      }, { status: 429 });
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

    // Relayed through a small Cloud Run service (see gemini-proxy/) rather
    // than calling Gemini directly from here — Cloudflare executes this
    // function at whichever edge location is nearest the visitor, and
    // Google's API occasionally rejects the outbound call with "User
    // location is not supported" when that edge IP gets geo-attributed to
    // an unsupported country. Cloud Run runs from one fixed region and
    // calls Gemini over Google's own network, sidestepping that entirely.
    // The proxy forwards Gemini's response (including its exact status
    // code and error shape) unchanged, so the handling below is identical
    // to calling Gemini directly.
    //
    // Counted here (right before the call), not only on success — a
    // request that reaches Gemini spends its quota regardless of whether
    // Gemini's own response is an error.
    try {
      await recordAnalysis(env);
    } catch (quotaErr) {
      console.error('quota tracking write failed', quotaErr);
    }
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-proxy-secret': proxySecret },
      body: JSON.stringify(requestBody),
    });

    const json = await res.json();
    if (!res.ok) {
      const message = json.error?.message || `Gemini API error (HTTP ${res.status})`;
      return Response.json({ error: message }, { status: 502 });
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
      await logScan(env, { request, game, cardName, setName, cardNumber, centeringFrontRatio, centeringBackRatio, graded, estimates, images });
    } catch (logErr) {
      console.error('scan log write failed', logErr);
    }

    return Response.json({
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
    });
  } catch (err) {
    return Response.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}
