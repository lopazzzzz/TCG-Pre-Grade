# Cardify

Personal pre-grading tool for Pokemon / One Piece TCG cards. Upload front + back
photos, get an estimated Centering / Corners / Surface / Edges breakdown and a
per-company (PSA / CGC / BGS / TAG) grade estimate with confidence, then export
a shareable report image.

This is an AI-assisted **estimate** for personal reference — it is not
affiliated with PSA, CGC, BGS, or TAG and does not guarantee actual submission
results.

## 1. Get a Gemini API key

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) →
   sign in with a Google account → **Create API key**.
2. Note it down. The app calls `gemini-3.1-flash-lite`,
   which has a generous free tier (~1,000 requests/day at time of writing —
   check [ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits)
   for the current number) — for personal use this is effectively free.
   Google model names change fairly often; if analysis starts failing with a
   "model no longer available" error, check
   [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)
   for the current flash-lite model ID and update it in `gemini-proxy/index.js`.
3. This key gets used by the **Gemini proxy** (step 1.5 below), not directly
   by the Cloudflare site — keep reading.

## 1.5. Deploy the Gemini proxy (Google Cloud Run)

The Gemini call is relayed through a small service on Google Cloud Run
instead of being called directly from Cloudflare. This isn't optional
plumbing: Cloudflare executes each request at whichever of its 300+ global
edge locations is nearest the visitor, and Google's API occasionally rejects
the call with **"User location is not supported for the API use"** when that
particular edge IP gets geo-attributed to an unsupported country — it's
intermittent and varies by which network/location a visitor happens to be
on. Cloud Run runs from one fixed region and calls Gemini over Google's own
network, which avoids that problem entirely.

Full setup steps are in [`gemini-proxy/README.md`](gemini-proxy/README.md).
Summary: create a Google Cloud project (needs a billing account attached,
same as Cloudflare R2 did, but this stays free at personal-use volume),
deploy `gemini-proxy/` to Cloud Run connected to the same GitHub repo, and
set `GEMINI_API_KEY` + a `PROXY_SECRET` (any long random string) as its
environment variables. You'll need the resulting service URL and that same
`PROXY_SECRET` for step 3 below.

## 2. Set up the admin dashboard

The app automatically logs every completed scan (card details, scores,
images) to a Cloudflare R2 bucket — no external database needed — viewable at
`/admin.html`, gated behind a single shared password (no user accounts).

Pick two values, to be set as environment variables in step 3:
- `ADMIN_PASSWORD` — whatever password you'll log in with.
- `ADMIN_SESSION_SECRET` — any long random string (used to sign the login
  session cookie so it can't be forged). Generate one with, e.g.,
  `openssl rand -hex 32`.

## 3. Deploy to Cloudflare Pages

1. Create a free [Cloudflare account](https://dash.cloudflare.com/sign-up) if
   you don't have one.
2. **Create the R2 bucket**: dashboard → **R2 Object Storage** → **Create
   bucket** → name it `cardify-scans` (matches `wrangler.toml`). R2's free
   tier (10 GB storage, 1M reads / 1M writes per month) requires adding a
   payment method to your account even though the free tier itself costs
   nothing — Cloudflare does this to prevent abuse, you won't be charged
   unless you exceed the free tier.
3. Push this `tcg-pregrade/` folder to its own git repository (GitHub/GitLab).
4. In Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to
   Git**, pick the repo. Build settings: no build command needed, output
   directory `/` (the repo root) — `wrangler.toml` already declares this via
   `pages_build_output_dir`.
5. After the first deploy, go to the project's **Settings → Bindings** and
   add an **R2 bucket** binding: variable name `SCAN_BUCKET`, bucket
   `cardify-scans` (this mirrors `wrangler.toml` for the deployed
   environment; the dashboard binding is what production actually uses).
6. Go to **Settings → Environment variables** and add `GEMINI_PROXY_URL`
   (the Cloud Run service URL from step 1.5, including a trailing `/`),
   `PROXY_SECRET` (matching the one set on Cloud Run), `ADMIN_PASSWORD`, and
   `ADMIN_SESSION_SECRET` (mark them all as **Secret**, not plaintext).
7. Redeploy (**Deployments → Retry deployment**, or just push a commit) so the
   new bindings/env vars take effect. Cloudflare gives you a URL like
   `https://<something>.pages.dev` — open it on both desktop Chrome and mobile
   Chrome to confirm everything works (camera upload on mobile, drag-and-drop
   on desktop), and open `/admin.html` to confirm the dashboard logs in and
   shows scans after you analyze a card.

## 4. Local development

```
npm install -g wrangler   # once
cd tcg-pregrade
wrangler pages dev . --r2 SCAN_BUCKET \
  -b GEMINI_PROXY_URL=https://your-proxy.a.run.app/ \
  -b PROXY_SECRET=dev-secret \
  -b ADMIN_PASSWORD=your-password \
  -b ADMIN_SESSION_SECRET=$(openssl rand -hex 32)
```

The Gemini proxy itself can also run locally (see
[`gemini-proxy/README.md`](gemini-proxy/README.md)) if you'd rather not hit
the real deployed Cloud Run service while developing.

`wrangler pages dev` serves the static frontend and runs the Pages Functions
locally under `/api/*`, with a local-only simulated R2 bucket (no data ever
touches your real Cloudflare account). Opening `index.html` directly as a
`file://` path will NOT work — the AI analysis call needs the function
server.

## How it works

1. **Upload** front/back photos.
2. **Align card corners** — drag the 4 points onto the card's actual corners
   in the photo (works even if the photo was taken at an angle, not just
   straight overhead). The image is warped back into a clean rectangle before
   anything else happens, since every later measurement assumes a
   front-on, un-skewed photo.
3. **Centering** is then measured geometrically (edge-detection over the
   card's inner border) on the corrected image — not guessed by the AI — with
   draggable guide lines to correct the auto-detection if needed.
4. **Light / X-ray tool** lets you slide between a normal and a
   contrast-enhanced view of either side to eyeball surface issues yourself.
5. **Corners / Surface / Edges** are judged by Gemini 3.1 Flash-Lite vision,
   given the full corrected photos plus 4 auto-generated zoomed corner crops
   per side.
6. **Per-company estimates**: BGS uses its publicly documented weighted
   formula; TAG uses its published (tighter) centering tolerance tiers; PSA
   and CGC use a "worst factor gates the grade" heuristic since neither
   publishes an exact formula — see `lib/gradingPrompt.js`
   for the full logic and reasoning behind each company's numbers.
   **Confidence %** drops for borderline centering measurements or cards with
   a wide spread between sub-scores, and rises for clearly flawless or
   clearly flawed cards.
7. **Save as Image** renders a full report (front/back with corner crops and
   centering guides, sub-scores, company grades, flagged defects with cropped
   thumbnails) as a downloadable PNG, generated entirely in the browser and
   saved straight to your device.
8. Every completed scan is also logged server-side (images + full result) to
   a Cloudflare R2 bucket for the admin dashboard at `/admin.html` — see "Set
   up the admin dashboard" above.

None of this replaces an in-hand human grader — glare, gloss, and physical
feel of a card can reveal things a photo can't. Treat results as a strong
pre-screen, not a guarantee.
