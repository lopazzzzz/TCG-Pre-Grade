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
2. Note it down as `GEMINI_API_KEY`. The app calls `gemini-3.1-flash-lite`,
   which has a generous free tier (~1,000 requests/day at time of writing —
   check [ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits)
   for the current number) — for personal use this is effectively free.
   Google model names change fairly often; if analysis starts failing with a
   "model no longer available" error, check
   [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)
   for the current flash-lite model ID and update it in
   `netlify/functions/analyze-card.js`.

## 2. Set up the admin dashboard

The app automatically logs every completed scan (card details, scores,
images) to Netlify Blobs — no external database needed — viewable at
`/admin.html`, gated behind a single shared password (no user accounts).

Pick two values and set them as environment variables:
- `ADMIN_PASSWORD` — whatever password you'll log in with.
- `ADMIN_SESSION_SECRET` — any long random string (used to sign the login
  session cookie so it can't be forged). Generate one with, e.g.,
  `openssl rand -hex 32`.

## 3. Deploy to Netlify

1. Push this `tcg-pregrade/` folder to its own git repository (GitHub/GitLab/Bitbucket).
2. In Netlify: **Add new site → Import an existing project**, connect the repo.
   Build settings are already defined in `netlify.toml` (build command
   `npm install`, functions in `netlify/functions`), so you shouldn't need to
   change anything.
3. Go to **Site settings → Environment variables** and add `GEMINI_API_KEY`,
   `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET`.
4. Deploy. Netlify will give you a URL like `https://<something>.netlify.app` —
   open it on both desktop Chrome and mobile Chrome to confirm everything works
   (camera upload on mobile, drag-and-drop on desktop), and open `/admin.html`
   to confirm the dashboard logs in and shows scans after you analyze a card.

Alternative for a quick start without git: `netlify deploy` (from the Netlify
CLI) run from inside this folder also works, using the same env vars set via
`netlify env:set`.

## 4. Local development

```
npm install -g netlify-cli   # once
cd tcg-pregrade
netlify env:set GEMINI_API_KEY AIza...
netlify env:set ADMIN_PASSWORD your-password
netlify env:set ADMIN_SESSION_SECRET $(openssl rand -hex 32)
netlify dev
```

`netlify dev` serves the static frontend and runs the Netlify Function locally
with the same `/api/*` redirect used in production. Opening `index.html`
directly as a `file://` path will NOT work — the AI analysis call needs the
function server.

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
   publishes an exact formula — see `netlify/functions/lib/gradingPrompt.js`
   for the full logic and reasoning behind each company's numbers.
   **Confidence %** drops for borderline centering measurements or cards with
   a wide spread between sub-scores, and rises for clearly flawless or
   clearly flawed cards.
7. **Save as Image** renders a full report (front/back with corner crops and
   centering guides, sub-scores, company grades, flagged defects with cropped
   thumbnails) as a downloadable PNG, generated entirely in the browser and
   saved straight to your device.
8. Every completed scan is also logged server-side (images + full result) to
   Netlify Blobs for the admin dashboard at `/admin.html` — see "Set up the
   admin dashboard" above.

None of this replaces an in-hand human grader — glare, gloss, and physical
feel of a card can reveal things a photo can't. Treat results as a strong
pre-screen, not a guarantee.
