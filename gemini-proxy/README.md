# Cardify Gemini proxy

A thin relay for the Gemini API call, deployed on **Google Cloud Run**.

## Why this exists

The main app runs on Cloudflare, which executes each request at whichever of
its 300+ global edge locations is physically closest to the visitor. That
means the outbound call to Gemini can appear to come from any of those edge
IPs — and some of them get misattributed by Google's geo-IP check to a
country the Gemini API doesn't support, causing an intermittent
**"User location is not supported for the API use"** error that varies by
which network/location the visitor happens to be on.

Cloud Run runs in one fixed region you choose at deploy time, and the call
below goes from Google's own network to Google's own API — so it never hits
that edge-IP-geolocation problem. This service carries no grading logic at
all; it only forwards the already-built Gemini request through a stable
network path and returns Gemini's response unchanged.

## Deploy

1. Create a Google Cloud project (or use an existing one) at
   [console.cloud.google.com](https://console.cloud.google.com). Enabling
   Cloud Run requires a billing account attached, same as Cloudflare R2 did —
   this free-tier usage (a personal pre-grading tool) won't come close to
   incurring charges (2 million requests/month free).
2. In the Cloud Console, go to **Cloud Run → Create Service**.
3. Choose **"Continuously deploy from a repository"**, connect the same
   GitHub repo used for the main site, and set:
   - **Source location**: this `gemini-proxy/` subfolder
   - **Region**: pick one close to your users, e.g. `asia-southeast1`
     (Singapore)
   - **Authentication**: allow unauthenticated invocations (the service has
     its own `PROXY_SECRET` check instead)
4. Under **Variables & Secrets**, add:
   - `GEMINI_API_KEY` — the same key used before (from
     [aistudio.google.com/apikey](https://aistudio.google.com/apikey))
   - `PROXY_SECRET` — any long random string, e.g. from `openssl rand -hex 32`
     (must match the `PROXY_SECRET` set on the Cloudflare side)
5. Deploy. Cloud Run gives you a service URL like
   `https://cardify-gemini-proxy-xxxxx.a.run.app` — use that (with a trailing
   `/`) as `GEMINI_PROXY_URL` in the Cloudflare Pages project's environment
   variables, alongside the matching `PROXY_SECRET`.

## Local development

```
cd gemini-proxy
npm install
PROXY_SECRET=dev-secret GEMINI_API_KEY=your-key node index.js
```
