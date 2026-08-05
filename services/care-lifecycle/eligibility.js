'use strict';

/**
 * Eligibility for care.reinspection_6mo — Case history only.
 */

const crypto = require('crypto');
const { CARE_EVENT_TYPES } = require('./events');
const { getCareReinspectionDays } = require('./flags');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pickAnchor(job) {
  const resultSentAt = String(job?.notification?.resultSentAt || '').trim();
  if (resultSentAt && Number.isFinite(Date.parse(resultSentAt))) {
    return { field: 'resultSentAt', iso: new Date(resultSentAt).toISOString() };
  }
  const completedAt = String(job?.workflow?.serviceCompletedAt || '').trim();
  if (completedAt && Number.isFinite(Date.parse(completedAt))) {
    return { field: 'serviceCompletedAt', iso: new Date(completedAt).toISOString() };
  }
  return null;
}

function addMonthsUtc(iso, months) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const out = new Date(Date.UTC(y, m, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  return out;
}

function periodBucketFromAnchor(anchorIso) {
  const due = addMonthsUtc(anchorIso, 6);
  const y = due.getUTCFullYear();
  const m = String(due.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function buildIdempotencyKey(caseNotionId, periodBucket) {
  const id = String(caseNotionId || '').trim();
  return `care:reinspection_6mo:${id}:${periodBucket}`;
}

function hashDestinationId(lineUserId) {
  const raw = String(lineUserId || '').trim();
  if (!raw) return '';
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * @param {object} job Case job
 * @param {{ now?: Date, reinspectionDays?: number }} [options]
 */
function evaluateReinspection6mo(job, options = {}) {
  const now = options.now || new Date();
  const days = options.reinspectionDays != null
    ? options.reinspectionDays
    : getCareReinspectionDays();

  const caseNotionId = String(job?.notionId || '').trim();
  const caseId = String(job?.id || caseNotionId || '').trim();
  const customerId = String(job?.customer?.id || '').trim() || null;

  if (!caseNotionId) {
    return {
      eligible: false,
      eventType: CARE_EVENT_TYPES.REINSPECTION_6MO,
      reason: 'missing_case_id',
      caseNotionId: null,
      caseId: null,
      customerId,
      anchor: null,
      periodBucket: null,
      idempotencyKey: null,
      ageDays: null
    };
  }

  const anchor = pickAnchor(job);
  if (!anchor) {
    return {
      eligible: false,
      eventType: CARE_EVENT_TYPES.REINSPECTION_6MO,
      reason: 'missing_anchor',
      caseNotionId,
      caseId,
      customerId,
      anchor: null,
      periodBucket: null,
      idempotencyKey: null,
      ageDays: null
    };
  }

  const ageDays = (now.getTime() - Date.parse(anchor.iso)) / MS_PER_DAY;
  const periodBucket = periodBucketFromAnchor(anchor.iso);
  const idempotencyKey = buildIdempotencyKey(caseNotionId, periodBucket);

  if (ageDays < days) {
    return {
      eligible: false,
      eventType: CARE_EVENT_TYPES.REINSPECTION_6MO,
      reason: 'too_recent',
      caseNotionId,
      caseId,
      customerId,
      anchor,
      periodBucket,
      idempotencyKey,
      ageDays: Number(ageDays.toFixed(2))
    };
  }

  return {
    eligible: true,
    eventType: CARE_EVENT_TYPES.REINSPECTION_6MO,
    reason: null,
    caseNotionId,
    caseId,
    customerId,
    anchor,
    periodBucket,
    idempotencyKey,
    ageDays: Number(ageDays.toFixed(2)),
    scheduledAt: addMonthsUtc(anchor.iso, 6).toISOString()
  };
}

module.exports = {
  pickAnchor,
  periodBucketFromAnchor,
  buildIdempotencyKey,
  hashDestinationId,
  evaluateReinspection6mo,
  addMonthsUtc
};
