// Thin relay for the Gemini API call, deployed on Google Cloud Run.
//
// Why this exists: the main app runs on Cloudflare, which executes each
// request at whichever of its 300+ global edge locations is physically
// closest to the visitor. That means the outbound call to Gemini can
// appear to originate from any of those edge IPs — and some of them get
// misattributed by Google's geo-IP check to a country the Gemini API
// doesn't support, causing an intermittent "User location is not
// supported for the API use" error that varies by which network/location
// the visitor is on, not anything about the visitor themselves.
//
// Cloud Run runs in ONE fixed region you choose at deploy time, and the
// call below goes from Google's own network to Google's own API — so it
// never hits that edge-IP-geolocation problem. The Cloudflare function
// keeps 100% of the actual business logic (prompt, scoring, defect
// parsing) — this only relays the already-built Gemini request body
// through a stable network path and returns Gemini's response unchanged.
import express from 'express';

const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const app = express();
app.use(express.json({ limit: '20mb' })); // 10 images per request, base64-encoded

app.post('/', async (req, res) => {
  if (req.header('x-proxy-secret') !== process.env.PROXY_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    res.status(500).json({ error: 'Proxy missing GEMINI_API_KEY' });
    return;
  }

  try {
    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify(req.body),
    });
    const data = await geminiRes.json();
    res.status(geminiRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Proxy request to Gemini failed' });
  }
});

app.get('/', (_req, res) => res.status(200).send('ok'));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Gemini proxy listening on port ${port}`);
});
