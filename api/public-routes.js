const { getAllClients } = require('../services/notion/clients');

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

// Short in-memory cache so every Framer page load doesn't hit the Notion API
// directly (Notion has real rate limits — see architecture notes). Good
// enough for a single-instance deployment; revisit if this ever runs as
// more than one process.
const OFFER_CACHE_TTL_MS = 60 * 1000;
let offerCache = { value: null, expiresAt: 0 };

function getTotalSlots() {
  const parsed = Number(process.env.WATER_CHECK_OFFER_TOTAL_SLOTS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 100;
}

async function getWaterCheckOfferStatus() {
  const now = Date.now();
  if (offerCache.value && offerCache.expiresAt > now) {
    return offerCache.value;
  }

  // NOTE: counts every non-archived Case in Notion as "using" this offer.
  // Data is mock/launch-only today, so this is intentionally simple.
  // Once real campaigns/paid services coexist, filter this list by
  // whichever field marks a Case as belonging to the Free Water Check
  // launch offer instead of counting every Case.
  const jobs = await getAllClients();
  const totalSlots = getTotalSlots();
  const used = Math.min(jobs.length, totalSlots);
  const remaining = Math.max(0, totalSlots - used);

  const value = { totalSlots, used, remaining };
  offerCache = { value, expiresAt: now + OFFER_CACHE_TTL_MS };
  return value;
}

async function handlePublicRoute(req, res, urlPath) {
  if (!urlPath.startsWith('/api/public/')) return false;

  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (urlPath === '/api/public/water-check-offer' && req.method === 'GET') {
    try {
      const status = await getWaterCheckOfferStatus();
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
