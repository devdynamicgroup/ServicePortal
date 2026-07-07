const { getAllClients, getIntegrationStatus } = require('../services/notion/clients');

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

async function handleClientsRoute(req, res, urlPath) {
  if (urlPath === '/api/clients' && req.method === 'GET') {
    const status = getIntegrationStatus();
    if (!status.configured) {
      sendJson(res, 503, {
        ok: false,
        error: 'Notion is not configured',
        status
      });
      return true;
    }

    try {
      const jobs = await getAllClients();
      sendJson(res, 200, {
        ok: true,
        source: 'notion',
        count: jobs.length,
        jobs
      });
      return true;
    } catch (error) {
      console.warn('GET /api/clients failed', error.message);
      sendJson(res, 502, {
        ok: false,
        error: error.message || 'Failed to load clients from Notion'
      });
      return true;
    }
  }

  return false;
}

module.exports = { handleClientsRoute };
