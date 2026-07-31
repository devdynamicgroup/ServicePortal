const { getAllClients, findClientByReportToken, getClient } = require('../services/notion/clients');
const { getDataSourceSchema } = require('../services/notion/client');
const { findPropertyKey } = require('../services/notion/props');
const { FIELD_ALIASES } = require('../services/notion/mapper');
const {
  renderShareCardPng,
  cardOptionsFromJob,
  resolveFormat
} = require('../services/score-share-card');

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

function getCampaignOfferName() {
  const fromEnv = String(process.env.WATER_CHECK_CAMPAIGN_OFFER || '').trim();
  return fromEnv || 'Launch Offer 2026';
}

async function schemaHasCampaignOfferProperty() {
  try {
    const { properties } = await getDataSourceSchema();
    return Boolean(findPropertyKey(properties, FIELD_ALIASES.campaignOffer));
  } catch (error) {
    console.warn('[water-check-offer] could not read Notion schema', error.message);
    return false;
  }
}

function countCampaignOfferUsage(jobs, offerName) {
  const target = String(offerName || '').trim();
  if (!target) return 0;
  return jobs.filter(job => String(job.campaignOffer || '').trim() === target).length;
}

async function getWaterCheckOfferStatus() {
  const now = Date.now();
  if (offerCache.value && offerCache.expiresAt > now) {
    return offerCache.value;
  }

  const jobs = await getAllClients();
  const totalSlots = getTotalSlots();
  const offerName = getCampaignOfferName();
  const hasCampaignProperty = await schemaHasCampaignOfferProperty();
  // Before the "Campaign Offer" select property exists in Notion, no case can
  // possibly be tagged as having used the offer yet — treat usage as 0, not
  // "every case ever created" (jobs.length), which wrongly counted unrelated
  // historical jobs against the launch-offer slot count.
  const rawUsed = hasCampaignProperty
    ? countCampaignOfferUsage(jobs, offerName)
    : 0;
  const used = Math.min(rawUsed, totalSlots);
  const remaining = Math.max(0, totalSlots - used);

  const value = { totalSlots, used, remaining };
  offerCache = { value, expiresAt: now + OFFER_CACHE_TTL_MS };
  return value;
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
      const match = await findClientByReportToken(token);
      if (!match?.clientPageId) {
        sendJson(res, 404, { ok: false, error: 'Report not found' });
        return true;
      }
      const job = await getClient(match.clientPageId);
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
