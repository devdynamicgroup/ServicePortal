const { suggestFeedback, aiConfigured } = require('../services/feedback-suggest');

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 256 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleFeedbackSuggestRoute(req, res, urlPath) {
  if (urlPath === '/api/feedback/suggest' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      aiConfigured: aiConfigured(),
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
    });
    return true;
  }

  if (urlPath === '/api/feedback/suggest' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const payload = raw ? JSON.parse(raw) : {};
      const result = await suggestFeedback(payload);
      sendJson(res, 200, {
        ok: true,
        suggestion: result.text,
        source: result.source,
        rating: result.rating,
        aiConfigured: aiConfigured()
      });
    } catch (error) {
      console.warn('POST /api/feedback/suggest failed', error.message);
      sendJson(res, 500, {
        ok: false,
        error: error.message || 'Could not generate suggestion'
      });
    }
    return true;
  }

  return false;
}

module.exports = { handleFeedbackSuggestRoute };
