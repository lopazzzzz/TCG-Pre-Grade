# TCG Pre-Grade

Personal pre-grading tool for Pokemon / One Piece TCG cards. Upload front + back
photos, get an estimated Centering / Corners / Surface / Edges breakdown and a
per-company (PSA / CGC / BGS / TAG) grade estimate with confidence, plus a
saved history log. See `[plan file details / conversation]` for the full
design rationale.

This is an AI-assisted **estimate** for personal reference — it is not
affiliated with PSA, CGC, BGS, or TAG and does not guarantee actual submission
results.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → New project. Any name/region is fine.
2. Once it's up, open **SQL Editor → New query**, paste the contents of
   [`sql/schema.sql`](sql/schema.sql), and run it. This creates the `pregrades`
   table and a private `card-images` storage bucket.
3. Go to **Project Settings → API** and note down:
   - `Project URL` → this is `SUPABASE_URL`
   - `service_role` secret key → this is `SUPABASE_SERVICE_ROLE_KEY` (keep this
     secret — it bypasses Row Level Security; it only ever gets used inside
     Netlify Functions, never in the browser)

## 2. Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com) → API Keys → Create key.
   This is separate from any claude.ai/Claude Code subscription — it's billed
   per API call.
2. Note it down as `ANTHROPIC_API_KEY`. Each card analysis (10 images) costs
   roughly $0.01–0.05.

## 3. Deploy to Netlify

1. Push this `tcg-pregrade/` folder to its own git repository (GitHub/GitLab/Bitbucket).
2. In Netlify: **Add new site → Import an existing project**, connect the repo.
   Build settings are already defined in `netlify.toml` (build command
   `npm install`, functions in `netlify/functions`), so you shouldn't need to
   change anything.
3. Go to **Site settings → Environment variables** and add:
   - `ANTHROPIC_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy. Netlify will give you a URL like `https://<something>.netlify.app` —
   open it on both desktop Chrome and mobile Chrome to confirm everything works
   (camera upload on mobile, drag-and-drop on desktop).

Alternative for a quick start without git: `netlify deploy` (from the Netlify
CLI) run from inside this folder also works, using the same env vars set via
`netlify env:set`.

## 4. Local development

```
npm install -g netlify-cli   # once
cd tcg-pregrade
netlify env:set ANTHROPIC_API_KEY sk-ant-...
netlify env:set SUPABASE_URL https://xxxx.supabase.co
netlify env:set SUPABASE_SERVICE_ROLE_KEY eyJ...
netlify dev
```

`netlify dev` serves the static frontend and runs the Netlify Functions
locally with the same `/api/*` redirects used in production. Opening
`index.html` directly as a `file://` path will NOT work — the AI analysis and
save/history calls need the functions server.

## How the grading works

- **Centering** is measured geometrically in the browser (edge-detection over
  the card's inner border), not guessed by the AI — you get an exact ratio
  (e.g. `58/42`) with draggable guide lines to correct the auto-detection if
  needed. Take front/back photos reasonably tight/frame-filling for the best
  measurement.
- **Corners / Surface / Edges** are judged by Claude vision, given the full
  photos plus 4 auto-generated zoomed corner crops per side.
- **Per-company estimates**: BGS uses its publicly documented weighted formula;
  TAG uses its published (tighter) centering tolerance tiers; PSA and CGC use
  a "worst factor gates the grade" heuristic since neither publishes an exact
  formula — see `netlify/functions/lib/claudePrompt.js` for the full logic and
  reasoning behind each company's numbers.
- **Confidence %** drops for borderline centering measurements or cards with a
  wide spread between sub-scores, and rises for clearly flawless or clearly
  flawed cards.

None of this replaces an in-hand human grader — glare, gloss, and physical
feel of a card can reveal things a photo can't. Treat results as a strong
pre-screen, not a guarantee.
