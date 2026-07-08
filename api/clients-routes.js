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

  if (urlPath === '/api/debug/clients' && req.method === 'GET') {
    const status = getIntegrationStatus();
    if (!status.configured) {
      sendJson(res, 200, {
        total: 0,
        source: 'none',
        notionConnected: false,
        latestClient: null,
        dates: [],
        statuses: {},
        integration: status
      });
      return true;
    }

    try {
      const jobs = await getAllClients();

      const latestClient = jobs.reduce((latest, job) => {
        if (!latest) return job;
        return (job.createdTime || '') > (latest.createdTime || '') ? job : latest;
      }, null);

      const statuses = jobs.reduce((acc, job) => {
        acc[job.status] = (acc[job.status] || 0) + 1;
        return acc;
      }, {});

      sendJson(res, 200, {
        total: jobs.length,
        source: 'notion',
        notionConnected: true,
        latestClient: latestClient
          ? {
              name: latestClient.name,
              date: latestClient.date || null,
              day: latestClient.day,
              status: latestClient.status,
              rawStatus: latestClient.rawStatus,
              createdTime: latestClient.createdTime || null,
              notionId: latestClient.notionId
            }
          : null,
        dates: jobs.map(job => ({
          name: job.name,
          date: job.date || null,
          day: job.day
        })),
        statuses
      });
      return true;
    } catch (error) {
      console.warn('GET /api/debug/clients failed', error.message);
      sendJson(res, 502, {
        total: 0,
        source: 'notion',
        notionConnected: false,
        error: error.message || 'Failed to reach Notion'
      });
      return true;
    }
  }

  return false;
}

module.exports = { handleClientsRoute };
