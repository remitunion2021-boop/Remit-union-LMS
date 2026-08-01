// Netlify Function — AI proxy (Bluesmind)
// Runs on Netlify's free tier (no credit card required), same site as index.html.
// The key lives ONLY in Netlify's Environment Variables (Site settings → Environment
// variables), never in this file or in Git.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Use POST' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { model, messages, temperature = 0.4 } = payload;
  const apiKey = process.env.BLUESMIND_API_KEY;

  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'BLUESMIND_API_KEY is not set in Netlify environment variables' }) };
  }

  // Retry on transient upstream failures (network errors + 502/503/504 gateway
  // timeouts, which BluesMinds' own gateway can return under free-tier load).
  async function callBluesmind(attempt = 1) {
    let response;
    try {
      response = await fetch('https://api.bluesminds.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model || process.env.BLUESMIND_MODEL || 'gpt-4o-mini',
          messages,
          temperature,
          max_tokens: Math.min(Number(payload.max_tokens) || 2000, 2000)
        })
      });
    } catch (err) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 700 * attempt));
        return callBluesmind(attempt + 1);
      }
      throw err;
    }

    if (!response.ok && [502, 503, 504].includes(response.status) && attempt < 3) {
      await new Promise(r => setTimeout(r, 700 * attempt));
      return callBluesmind(attempt + 1);
    }
    return response;
  }

  try {
    const response = await callBluesmind();

    if (!response.ok) {
      const text = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: `Bluesmind error: ${text.slice(0, 200)}` }) };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || '';
    return { statusCode: 200, body: JSON.stringify({ content }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
