'use strict';

/**
 * M9.2 Care outcome model + measurement helpers.
 * Exact customerId / LINE join only. Never writes Case notification state.
 */

const RESPONSE_STATUS = Object.freeze({
  UNKNOWN: 'unknown',
  NO_RESPONSE: 'no_response',
  UTM_CLICK: 'utm_click',
  REBOOKED: 'rebooked',
  OPTED_OUT: 'opted_out'
});

const OUTCOME_SOURCE = Object.freeze({
  DERIVED_REBOOK: 'derived_rebook',
  BOOKING_UTM: 'booking_utm',
  MANUAL: 'manual',
  NONE: null
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RESPONSE_WINDOW_DAYS = 7;
const DEFAULT_REBOOK_WINDOW_DAYS = 30;

function emptyOutcomeFields() {
  return {
    deliveryStatus: null,
    responseStatus: RESPONSE_STATUS.UNKNOWN,
    rebookWithin30d: false,
    utmSource: null,
    utmCampaign: null,
    careAuditIdFromUtm: null,
    linkedCaseIdAfter: null,
    outcomeAt: null,
    outcomeSource: null,
    observationWindowEndsAt: null,
    measuredAt: null
  };
}

function mapDeliveryStatus(auditStatus) {
  const status = String(auditStatus || '').trim();
  if (!status) return null;
  return status;
}

function addDaysIso(iso, days) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  return new Date(Date.parse(iso) + days * MS_PER_DAY).toISOString();
}

function parseUtmFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return { utmSource: null, utmCampaign: null, careAuditIdFromUtm: null };
  }
  try {
    const u = new URL(raw, 'https://placeholder.local');
    return {
      utmSource: u.searchParams.get('utm_source') || null,
      utmCampaign: u.searchParams.get('utm_campaign') || null,
      careAuditIdFromUtm: u.searchParams.get('care_audit_id') || null
    };
  } catch {
    return { utmSource: null, utmCampaign: null, careAuditIdFromUtm: null };
  }
}

function caseTimestamp(job) {
  const raw = job?.createdTime || job?.workflow?.serviceStartedAt || '';
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Find first rebook Case for a sent care audit.
 *
 * @param {object} audit CareAuditEvent
 * @param {object[]} jobs All cases
 * @param {{ sourceLineUserId?: string, rebookWindowDays?: number }} [options]
 */
function findRebookCase(audit, jobs, options = {}) {
  if (String(audit?.status || '') !== 'sent') return null;
  const sentAt = String(audit?.sentAt || '').trim();
  const sentMs = Date.parse(sentAt);
  if (!Number.isFinite(sentMs)) return null;

  const windowDays = options.rebookWindowDays != null
    ? options.rebookWindowDays
    : DEFAULT_REBOOK_WINDOW_DAYS;
  const endMs = sentMs + windowDays * MS_PER_DAY;
  const sourceNotionId = String(audit?.caseNotionId || audit?.caseId || '').trim();
  const customerId = String(audit?.customerId || '').trim();
  const sourceLine = String(options.sourceLineUserId || '').trim();

  const candidates = [];
  for (const job of jobs || []) {
    const notionId = String(job?.notionId || '').trim();
    if (!notionId || notionId === sourceNotionId) continue;
    const createdMs = caseTimestamp(job);
    if (createdMs == null || createdMs <= sentMs || createdMs > endMs) continue;

    const jobCustomerId = String(job?.customer?.id || '').trim();
    const jobLine = String(job?.line?.userId || '').trim();
    const customerMatch = Boolean(customerId && jobCustomerId && customerId === jobCustomerId);
    const lineMatch = Boolean(sourceLine && jobLine && sourceLine === jobLine);
    if (!customerMatch && !lineMatch) continue;

    candidates.push({ job, createdMs });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.createdMs - b.createdMs);
  return candidates[0].job;
}

/**
 * Build outcome measurement for one audit.
 *
 * @param {object} audit
 * @param {{
 *   jobs?: object[],
 *   sourceLineUserId?: string,
 *   now?: Date,
 *   responseWindowDays?: number,
 *   rebookWindowDays?: number,
 *   bookingUrl?: string
 * }} [options]
 */
function measureCareOutcome(audit, options = {}) {
  const now = options.now || new Date();
  const responseWindowDays = options.responseWindowDays != null
    ? options.responseWindowDays
    : DEFAULT_RESPONSE_WINDOW_DAYS;
  const rebookWindowDays = options.rebookWindowDays != null
    ? options.rebookWindowDays
    : DEFAULT_REBOOK_WINDOW_DAYS;

  const deliveryStatus = mapDeliveryStatus(audit?.status);
  const anchorIso = audit?.sentAt || audit?.createdAt || null;
  const observationWindowEndsAt = addDaysIso(anchorIso, responseWindowDays);
  const utm = parseUtmFromUrl(options.bookingUrl);

  const outcome = {
    careAuditId: audit?.id || null,
    ...emptyOutcomeFields(),
    deliveryStatus,
    utmSource: utm.utmSource,
    utmCampaign: utm.utmCampaign,
    careAuditIdFromUtm: utm.careAuditIdFromUtm,
    observationWindowEndsAt,
    measuredAt: now.toISOString()
  };

  if (utm.careAuditIdFromUtm && audit?.id && utm.careAuditIdFromUtm === audit.id) {
    outcome.responseStatus = RESPONSE_STATUS.UTM_CLICK;
    outcome.outcomeSource = OUTCOME_SOURCE.BOOKING_UTM;
    outcome.outcomeAt = now.toISOString();
  }

  const rebook = findRebookCase(audit, options.jobs || [], {
    sourceLineUserId: options.sourceLineUserId,
    rebookWindowDays
  });

  if (rebook) {
    outcome.rebookWithin30d = true;
    outcome.linkedCaseIdAfter = rebook.notionId || rebook.id || null;
    outcome.responseStatus = RESPONSE_STATUS.REBOOKED;
    outcome.outcomeSource = OUTCOME_SOURCE.DERIVED_REBOOK;
    outcome.outcomeAt = rebook.createdTime || now.toISOString();
  } else if (outcome.responseStatus === RESPONSE_STATUS.UNKNOWN) {
    const windowEnd = observationWindowEndsAt ? Date.parse(observationWindowEndsAt) : null;
    if (deliveryStatus === 'sent' && windowEnd && now.getTime() > windowEnd) {
      outcome.responseStatus = RESPONSE_STATUS.NO_RESPONSE;
      outcome.outcomeSource = OUTCOME_SOURCE.NONE;
    } else if (deliveryStatus === 'sent') {
      outcome.responseStatus = RESPONSE_STATUS.UNKNOWN;
    } else {
      outcome.responseStatus = RESPONSE_STATUS.UNKNOWN;
    }
  }

  return outcome;
}

/**
 * Merge outcome fields onto an audit object (additive; does not strip core fields).
 */
function applyOutcomeToAudit(audit, outcome) {
  return {
    ...audit,
    deliveryStatus: outcome.deliveryStatus,
    responseStatus: outcome.responseStatus,
    rebookWithin30d: outcome.rebookWithin30d,
    utmSource: outcome.utmSource,
    utmCampaign: outcome.utmCampaign,
    careAuditIdFromUtm: outcome.careAuditIdFromUtm,
    linkedCaseIdAfter: outcome.linkedCaseIdAfter,
    outcomeAt: outcome.outcomeAt,
    outcomeSource: outcome.outcomeSource,
    observationWindowEndsAt: outcome.observationWindowEndsAt,
    measuredAt: outcome.measuredAt
  };
}

module.exports = {
  RESPONSE_STATUS,
  OUTCOME_SOURCE,
  DEFAULT_RESPONSE_WINDOW_DAYS,
  DEFAULT_REBOOK_WINDOW_DAYS,
  emptyOutcomeFields,
  mapDeliveryStatus,
  parseUtmFromUrl,
  findRebookCase,
  measureCareOutcome,
  applyOutcomeToAudit,
  addDaysIso
};
