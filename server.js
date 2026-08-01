const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
// Prefer Node's built-in fetch (Node 18+) — it's more stable and avoids the
// ECONNRESET issue that older node-fetch versions can hit on some networks.
const fetch = globalThis.fetch || require('node-fetch');
const app = express();

app.use(express.json());

// Allow the frontend to talk to the API even if served from another port.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ---- Serve the static frontend (only the files the app actually needs) ----
// We whitelist specific files instead of serving the whole folder so that
// .env / server.js / package.json are NOT exposed over HTTP.
const PUBLIC_FILES = ['index.html', 'app.js', 'styles.css'];
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/:file', (req, res) => {
  const f = req.params.file;
  if (PUBLIC_FILES.includes(f)) {
    res.sendFile(path.join(__dirname, f));
  } else {
    res.status(404).end();
  }
});

// Helper: call Bluesmind with one automatic retry on transient network
// errors (e.g. ECONNRESET), which are usually caused by flaky networks,
// VPNs, or antivirus/firewall software intercepting HTTPS traffic.
async function callBluesmind(payload, apiKey, attempt = 1) {
  try {
    return await fetch('https://api.bluesminds.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    const transient = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(err.message || '');
    if (transient && attempt < 3) {
      await new Promise(r => setTimeout(r, 500 * attempt));
      return callBluesmind(payload, apiKey, attempt + 1);
    }
    throw err;
  }
}

// AI proxy endpoint
app.post('/api/ai-proxy', async (req, res) => {
  const { model, messages, temperature = 0.4 } = req.body;
  const apiKey = process.env.BLUESMIND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'BLUESMIND_API_KEY is not set in .env' });
  }

  try {
    const response = await callBluesmind({
      model: model || process.env.BLUESMIND_MODEL || 'gpt-4o-mini',
      messages,
      temperature,
      max_tokens: Math.min(Number(req.body.max_tokens) || 2000, 2000)
    }, apiKey);

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `Bluesmind error: ${text.slice(0, 200)}` });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

// Debug: show a masked version of the loaded key so you can verify .env
// is being read correctly (never logs the full key).
const loadedKey = process.env.BLUESMIND_API_KEY || '';
if (!loadedKey) {
  console.log('⚠️  BLUESMIND_API_KEY is NOT loaded — check your .env file.');
} else {
  console.log(`✅ BLUESMIND_API_KEY loaded: ${loadedKey.slice(0, 10)}...${loadedKey.slice(-4)} (length: ${loadedKey.length})`);
}

app.listen(PORT, () => console.log(`Proxy server running on http://localhost:${PORT}`));
