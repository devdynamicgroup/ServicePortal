/**
 * Phase 4 — CAL-G03 product mapping (mechanism only).
 *
 * Locked rule (CALCOM_BLOCKER_RESOLUTION.md, CAL-G03): an unmapped/unknown Cal
 * event type must NEVER default to launch-offer attribution. This module is
 * the single place that decision is made — the Adapter never guesses.
 *
 * eventTypeId 6040165 = the real, confirmed "Free Water Check" event on
 * Cal.com (cal.com/watermotion/60min) — the same event driving every
 * BOOKING_CREATED delivery received in production to date (verified via
 * docs/CALCOM_G01_RUNTIME_CAPTURE.md and the real bookings created since).
 * 'Launch Offer 2026' is the existing campaign name already used everywhere
 * else in this codebase (case-creation-service.js DEFAULT_LAUNCH_CAMPAIGN_OFFER,
 * the WATER_CHECK_CAMPAIGN_OFFER env default, and the Notion Campaign Offer
 * select option) — not a new value invented here.
 *
 * Any event type not listed below still gets the safe default (no launch
 * attribution) — this file never guesses for an unmapped id.
 */

const EVENT_TYPE_CAMPAIGN_MAP = Object.freeze({
  6040165: { launchOffer: true, campaignOffer: 'Launch Offer 2026' }
});

function resolveCampaignAttribution(eventTypeId) {
  const id = Number(eventTypeId);
  const entry = Number.isFinite(id) ? EVENT_TYPE_CAMPAIGN_MAP[id] : undefined;
  if (!entry) {
    return { launchOffer: false, campaignOffer: '' };
  }
  return {
    launchOffer: Boolean(entry.launchOffer),
    campaignOffer: String(entry.campaignOffer || '')
  };
}

module.exports = {
  EVENT_TYPE_CAMPAIGN_MAP,
  resolveCampaignAttribution
};
