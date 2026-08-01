const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const fetch = require('node-fetch');

// This secret is set once via the CLI (see instructions below) and is
// injected securely at runtime. It never lives in your code or in Git.
const BLUESMIND_API_KEY = defineSecret('BLUESMIND_API_KEY');

exports.aiProxy = onRequest(
  { secrets: [BLUESMIND_API_KEY], cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Use POST' });
    }

    const { model, messages, temperature = 0.4 } = req.body || {};
    const apiKey = BLUESMIND_API_KEY.value();

    if (!apiKey) {
      return res.status(500).json({ error: 'BLUESMIND_API_KEY secret is not set' });
    }

    try {
      const response = await fetch('https://api.bluesminds.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          messages,
          temperature,
          max_tokens: 2000
        })
      });

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
  }
);
