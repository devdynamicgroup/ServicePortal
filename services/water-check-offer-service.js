const { getAllClients } = require('./notion/clients');
const { getDataSourceSchema } = require('./notion/client');
const { findPropertyKey } = require('./notion/props');
const { FIELD_ALIASES } = require('./notion/mapper');

// Single source of truth for Water Check Launch Offer capacity. Nothing
// outside this file may compute totalSlots/used/remaining or decide whether
// a job counts as an active offer booking — see docs/CUSTOMER_COMMUNICATION_ARCHITECTURE.md
// audit notes (M3) for why that duplication was a problem.

const DEFAULT_TOTAL_SLOTS = 100;
const DEFAULT_CAMPAIGN_OFFER = 'Launch Offer 2026';

// Short in-memory cache so every Framer page load doesn't hit the Notion API
// directly (Notion has real rate limits — see architecture notes). Good
// enough for a single-instance deployment; revisit if this ever runs as
// more than one process.
const OFFER_CACHE_TTL_MS = 60 * 1000;
let offerCache = { value: null, expiresAt: 0 };

function getTotalSlots() {
  const parsed = Number(process.env.WATER_CHECK_OFFER_TOTAL_SLOTS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_TOTAL_SLOTS;
}

function getCampaignOfferName() {
  const fromEnv = String(process.env.WATER_CHECK_CAMPAIGN_OFFER || '').trim();
  return fromEnv || DEFAULT_CAMPAIGN_OFFER;
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

// Whether a job is tagged for the given offer at all, regardless of status.
// campaignOffer is kept on cancelled jobs too (historical reporting depends
// on it) — this check alone is NOT enough to decide slot usage.
function isOfferBooking(job, offerName = getCampaignOfferName()) {
  const target = String(offerName || '').trim();
  if (!target) return false;
  return String(job?.campaignOffer || '').trim() === target;
}

// The one definition of "cancelled" for offer-usage purposes. Mirrors the
// idempotency check cancelAppointment() already used internally.
function isCancelledJob(job) {
  return job?.status === 'cancelled'
    || ['cancelled', 'canceled'].includes(String(job?.workflow?.status || '').toLowerCase());
}

// A job counts against offer capacity only while it is tagged for the offer
// AND still active. Cancelling a booking frees its slot even though the
// campaignOffer property itself is left in place for reporting.
function isActiveOfferBooking(job, offerName = getCampaignOfferName()) {
  return isOfferBooking(job, offerName) && !isCancelledJob(job);
}

function countUsedOffers(jobs, offerName) {
  return (jobs || []).filter(job => isActiveOfferBooking(job, offerName)).length;
}

function invalidateOfferCache() {
  offerCache = { value: null, expiresAt: 0 };
}

async function getOfferStatus() {
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
  const rawUsed = hasCampaignProperty ? countUsedOffers(jobs, offerName) : 0;
  const used = Math.min(rawUsed, totalSlots);
  const remaining = Math.max(0, totalSlots - used);

  const value = { totalSlots, used, remaining };
  offerCache = { value, expiresAt: now + OFFER_CACHE_TTL_MS };
  return value;
}

module.exports = {
  getOfferStatus,
  countUsedOffers,
  isOfferBooking,
  isActiveOfferBooking,
  isCancelledJob,
  invalidateOfferCache,
  getCampaignOfferName,
  getTotalSlots
};
