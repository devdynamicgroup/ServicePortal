/**
 * Tavus AI Sales Person route — thin proxy.
 *
 * Validate → look up customer context (optional) → tavus-client → return.
 * No conversation/avatar logic here. Requires login (assertAppAuth), same
 * as the other internal proxy routes (see api/ocr-proxy-routes.js).
 */

const { assertAppAuth } = require('../services/app-auth');
const { isTavusConfigured, startConversation } = require('../services/tavus-client');
const { getClient } = require('../services/notion/clients');

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
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleTavusRoute(req, res, urlPath) {
  if (urlPath === '/api/tavus/status' && req.method === 'GET') {
    if (!assertAppAuth(req, res)) return true;
    sendJson(res, 200, { ok: true, configured: isTavusConfigured() });
    return true;
  }

  if (urlPath !== '/api/tavus/start-conversation') return false;

  if (req.method !== 'POST') {
    sendJson(res, 405, {
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Use POST /api/tavus/start-conversation'
    });
    return true;
  }

  if (!assertAppAuth(req, res)) return true;

  if (!isTavusConfigured()) {
    sendJson(res, 503, {
      success: false,
      error: 'TAVUS_NOT_CONFIGURED',
      message: 'Tavus is not yet configured (account pending activation).'
    });
    return true;
  }

  let payload = {};
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Body must be a JSON object');
    }
  } catch {
    sendJson(res, 400, {
      success: false,
      error: 'INVALID_REQUEST',
      message: 'Request body must be JSON: { caseId? }'
    });
    return true;
  }

  const caseId = payload.caseId != null ? String(payload.caseId).trim() : '';

  // caseId is optional — the avatar can still greet a visitor generically
  // with no personalized context if none was supplied.
  let context = {};
  if (caseId) {
    try {
      const job = await getClient(caseId);
      context = {
        customerName: job?.customer?.fullName || job?.fullName || null,
        waterScore: job?.result?.waterScore ?? null
      };
    } catch (error) {
      // A bad/unknown caseId should not block starting a conversation —
      // fall back to no context rather than failing the whole request.
      console.warn('[tavus-routes] case lookup failed', {
        caseId,
        message: error?.message || String(error)
      });
    }
  }

  const result = await startConversation(context);
  const { statusCode, ...body } = result;
  sendJson(res, result.success ? 200 : (statusCode || 502), body);
  return true;
}

module.exports = { handleTavusRoute };
