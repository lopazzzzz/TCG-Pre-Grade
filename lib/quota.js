// Self-enforced daily cap on Gemini analysis calls — a safety net so the app
// stops making calls itself once it's used a configurable share of Gemini's
// free daily quota, rather than relying on the user noticing a billing
// alert email. Cloudflare Workers/R2 and Gemini's own free tier already
// hard-stop for free when THEIR limits are hit (no surprise charges there),
// so this exists purely to give a clear, in-app "paused, resumes at X" state
// instead of visitors hitting a raw quota error from Google.
//
// Usage is tracked per UTC calendar day as a small counter in the same R2
// bucket used for scan logs (key: usage/YYYY-MM-DD.json). UTC is used as a
// simple, unambiguous reset boundary — it may not land on the exact same
// moment as Gemini's own quota reset, but for a personal-use safety margin
// that precision doesn't matter.

function todayKey() {
  return `usage/${new Date().toISOString().slice(0, 10)}.json`;
}

function dailyLimit(env) {
  const n = Number(env.DAILY_ANALYSIS_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 1000; // conservative default; adjust once you confirm Gemini's current free-tier daily limit
}

function thresholdFraction(env) {
  const n = Number(env.DAILY_ANALYSIS_THRESHOLD_PCT);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n / 100 : 0.7;
}

function nextResetIso() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next.toISOString();
}

async function readCount(env) {
  const obj = await env.SCAN_BUCKET.get(todayKey());
  if (!obj) return 0;
  const data = await obj.json();
  return data.count || 0;
}

// Returns the current status without incrementing anything — used both to
// gate a new request and to show a live stat in the admin dashboard.
export async function getQuotaStatus(env) {
  const count = await readCount(env);
  const limit = dailyLimit(env);
  const threshold = Math.round(limit * thresholdFraction(env));
  return {
    count,
    limit,
    threshold,
    blocked: count >= threshold,
    resetAt: nextResetIso(),
  };
}

// Records one more analysis attempt for today. Called right before the
// actual Gemini call, not just on success — a request that reaches Gemini
// consumes its quota regardless of whether Gemini's response is itself an
// error, so underclaiming successes-only would let real usage drift ahead
// of what this tracker believes it is.
export async function recordAnalysis(env) {
  const key = todayKey();
  const count = (await readCount(env)) + 1;
  await env.SCAN_BUCKET.put(key, JSON.stringify({ count, updatedAt: new Date().toISOString() }), {
    httpMetadata: { contentType: 'application/json' },
  });
  return count;
}

// Admin-only manual override — for when the assumed limit turns out to be
// wrong, or the day genuinely needs to resume early.
export async function resetQuota(env) {
  await env.SCAN_BUCKET.delete(todayKey());
}
