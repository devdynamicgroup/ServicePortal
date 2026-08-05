/**
 * Phase 4 — CAL-G03 product mapping (mechanism only).
 *
 * Locked rule (CALCOM_BLOCKER_RESOLUTION.md, CAL-G03): an unmapped/unknown Cal
 * event type must NEVER default to launch-offer attribution. This module is
 * the single place that decision is made — the Adapter never guesses.
 *
 * EVENT_TYPE_CAMPAIGN_MAP is intentionally empty. It is populated by Product,
 * not invented here. Until Product supplies real Cal event type ids, every
 * booking is created without launch attribution (safe default) — Offer
 * counting (M3, unmodified) is simply not affected by Cal bookings yet.
 */

const EVENT_TYPE_CAMPAIGN_MAP = Object.freeze({
  // Example shape, not a real value:
  // 6040165: { launchOffer: true, campaignOffer: 'Launch Offer 2026' }
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
