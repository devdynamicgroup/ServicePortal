const { findClientByReportToken, getClient } = require('../services/notion/clients');
const { resolveReportByToken } = require('../services/score-publication-service');
const {
  renderShareCardPng,
  cardOptionsFromJob,
  resolveFormat
} = require('../services/score-share-card');
const { getOfferStatus } = require('../services/water-check-offer-service');

// Public, read-only endpoints meant to be called directly from the Framer
// marketing site (browser-side fetch). Scoped narrowly on purpose:
// - CORS is limited to an explicit allow-list, never '*'.
// - No write access, no staff-auth-protected data is exposed here.
// - Kept in its own file so it never shares a route prefix with the
//   internal/staff-only endpoints in case-flow-routes.js / clients-routes.js.

const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.water-motion.co',
  'https://water-motion.co'
];

function getAllowedOrigins() {
  const fromEnv = String(process.env.PUBLIC_API_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ALLOWED_ORIGINS;
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowed = getAllowedOrigins();
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendPng(res, buffer, cacheSeconds = 300) {
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Cache-Control': `public, max-age=${cacheSeconds}`,
    'Content-Length': buffer.length
  });
  res.end(buffer);
}

function parseFormat(urlObj) {
  return resolveFormat(urlObj.searchParams.get('format') || 'landscape').key;
}

async function handleScoreCardRoute(req, res, urlPath, urlObj) {
  const demoMatch = urlPath.match(/^\/api\/public\/score-card\/demo$/);
  if (demoMatch && req.method === 'GET') {
    try {
      const score = Number(urlObj.searchParams.get('score') || 65);
      const format = parseFormat(urlObj);
      const photoUrl = urlObj.searchParams.get('photo') || '';
      const { png } = await renderShareCardPng(format, {
        score: Number.isFinite(score) ? score : 65,
        photoUrl,
        findingsCount: Number(urlObj.searchParams.get('findings') || 0)
      });
      sendPng(res, png, 60);
    } catch (error) {
      console.warn('GET /api/public/score-card/demo failed', error.message);
      sendJson(res, 502, { ok: false, error: 'Score card unavailable' });
    }
    return true;
  }

  const tokenMatch = urlPath.match(/^\/api\/public\/score-card\/([^/]+)$/);
  if (tokenMatch && req.method === 'GET') {
    try {
      const token = decodeURIComponent(tokenMatch[1]);
      let job = null;
      try {
        job = await resolveReportByToken(token);
      } catch (error) {
        if (error.statusCode === 409) {
          sendJson(res, 409, { ok: false, error: 'Report token conflict' });
          return true;
        }
        throw error;
      }
      if (!job) {
        const match = await findClientByReportToken(token);
        if (!match?.clientPageId) {
          sendJson(res, 404, { ok: false, error: 'Report not found' });
          return true;
        }
        job = await getClient(match.clientPageId);
      }
      if (!job || !Number.isFinite(Number(job.result?.waterScore))) {
        sendJson(res, 404, { ok: false, error: 'Score not published' });
        return true;
      }
      const format = parseFormat(urlObj);
      const { png } = await renderShareCardPng(format, cardOptionsFromJob(job, {
        photoUrl: urlObj.searchParams.get('photo') || undefined
      }));
      sendPng(res, png, 300);
    } catch (error) {
      console.warn('GET /api/public/score-card/:token failed', error.message);
      sendJson(res, 502, { ok: false, error: 'Score card unavailable' });
    }
    return true;
  }

  return false;
}

async function handlePublicRoute(req, res, urlPath, urlObj) {
  if (!urlPath.startsWith('/api/public/')) return false;

  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (await handleScoreCardRoute(req, res, urlPath, urlObj || new URL(req.url, 'http://localhost'))) {
    return true;
  }

  if (urlPath === '/api/public/water-check-offer' && req.method === 'GET') {
    try {
      const status = await getOfferStatus();
      sendJson(res, 200, { ok: true, ...status });
    } catch (error) {
      console.warn('GET /api/public/water-check-offer failed', error.message);
      // Never leak internal error detail to a public, unauthenticated caller.
      sendJson(res, 502, { ok: false, error: 'Offer status is temporarily unavailable' });
    }
    return true;
  }

  return false;
}

module.exports = { handlePublicRoute };
