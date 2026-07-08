const {
  syncReviewsToNotion,
  getGoogleReviewIntegrationStatus
} = require('../services/google-reviews');

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function handleGoogleReviewRoute(req, res, urlPath) {
  if (urlPath === '/api/google-reviews/status' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      integration: getGoogleReviewIntegrationStatus()
    });
    return true;
  }

  if (urlPath === '/api/google-reviews/sync' && req.method === 'POST') {
    try {
      const result = await syncReviewsToNotion();
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      console.warn('POST /api/google-reviews/sync failed', error.message);
      sendJson(res, error.statusCode || 502, {
        ok: false,
        error: error.message || 'Failed to sync Google reviews'
      });
    }
    return true;
  }

  return false;
}

module.exports = { handleGoogleReviewRoute };
