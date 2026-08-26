'use strict';

/**
 * Shared LINE result lookup — exact Case LINE User ID only.
 * Case remains SSOT. Does not use Customer Domain primary read.
 */

const { findClientsByLineUserId } = require('./notion/clients');
const { buildReportUrl } = require('./url-builder');

const RESULT_TYPES = Object.freeze({
  FREE_WATER_CHECK: 'free_water_check',
  PAID_ASSESSMENT: 'paid_assessment'
});

const WAITING_RESULT_MESSAGE = [
  'กำลังดำเนินการตรวจสอบและจัดทำผลตรวจครับ',
  'เมื่อผลตรวจเสร็จแล้ว ระบบจะส่งแจ้งเตือนให้ทาง LINE อัตโนมัติ'
].join('\n');

function caseHasAvailableReport(job) {
  return Boolean(
    String(job?.result?.publicReportToken || '').trim()
    || String(job?.result?.reportUrl || '').trim()
  );
}

function caseSortTimestamp(job) {
  return Date.parse(
    job?.notification?.resultSentAt
    || job?.workflow?.serviceCompletedAt
    || job?.workflow?.closedAt
    || job?.createdTime
    || 0
  ) || 0;
}

/**
 * Essential-package customers get the free-style LINE message; Full
 * Assessment customers get the paid-style message. Driven by job.pkg, the
 * same signal api/case-flow-routes.js's isFreeInspectionJob() uses for the
 * report page (2026-08-26, direct request -- previously this checked
 * campaignOffer only, which meant a Full Assessment customer who booked
 * through a campaign link would incorrectly get the free-style message,
 * and an Essential customer who booked outside a campaign link would
 * incorrectly get the paid-style message).
 */
function resolveResultType(job) {
  const pkg = String(job?.pkg || 'essential').trim();
  return pkg === 'full' ? RESULT_TYPES.PAID_ASSESSMENT : RESULT_TYPES.FREE_WATER_CHECK;
}

function resolveResultUrl(job) {
  const reportToken = String(job?.result?.publicReportToken || '').trim();
  if (reportToken) {
    try {
      return buildReportUrl(reportToken);
    } catch {
      return String(job?.result?.reportUrl || '').trim();
    }
  }
  return String(job?.result?.reportUrl || '').trim();
}

function emptyResult() {
  return {
    case: null,
    resultAvailable: false,
    resultType: null,
    resultUrl: ''
  };
}

function presentCaseResult(job) {
  if (!job || !caseHasAvailableReport(job)) {
    return emptyResult();
  }
  return {
    case: job,
    resultAvailable: true,
    resultType: resolveResultType(job),
    resultUrl: resolveResultUrl(job)
  };
}

/**
 * Latest Case with an openable report for this exact LINE User ID.
 *
 * @param {string} lineUserId
 * @param {{ deps?: { findClientsByLineUserId?: Function }, jobs?: object[] }} [options]
 */
async function getLatestAvailableResultByLineUserId(lineUserId, options = {}) {
  const userId = String(lineUserId || '').trim();
  if (!userId) return emptyResult();

  const findFn = options.deps?.findClientsByLineUserId || findClientsByLineUserId;
  const jobs = Array.isArray(options.jobs)
    ? options.jobs
    : await findFn(userId, { limit: 100 });

  const list = Array.isArray(jobs) ? jobs : [];
  // Exact identity: only Cases whose line.userId matches (fixtures + defense in depth).
  const matched = list.filter(
    job => String(job?.line?.userId || '').trim() === userId
  );
  const withReport = matched
    .filter(caseHasAvailableReport)
    .sort((a, b) => caseSortTimestamp(b) - caseSortTimestamp(a));

  if (!withReport.length) {
    return {
      ...emptyResult(),
      // Linked-but-waiting callers can inspect jobs via side channel if needed;
      // return linked hint through resultAvailable false only.
      case: matched[0] || null,
      resultAvailable: false,
      resultType: matched[0] ? resolveResultType(matched[0]) : null,
      resultUrl: ''
    };
  }

  return presentCaseResult(withReport[0]);
}

/**
 * Same presentation shape for a known Case (automatic push path).
 */
function getAvailableResultForCase(job) {
  return presentCaseResult(job);
}

/**
 * Whether any Case is linked to this LINE user (exact userId), even without report.
 */
async function hasLinkedCasesByLineUserId(lineUserId, options = {}) {
  const userId = String(lineUserId || '').trim();
  if (!userId) return false;
  const findFn = options.deps?.findClientsByLineUserId || findClientsByLineUserId;
  const jobs = Array.isArray(options.jobs)
    ? options.jobs
    : await findFn(userId, { limit: 100 });
  const list = Array.isArray(jobs) ? jobs : [];
  return list.some(job => String(job?.line?.userId || '').trim() === userId);
}

module.exports = {
  RESULT_TYPES,
  WAITING_RESULT_MESSAGE,
  caseHasAvailableReport,
  caseSortTimestamp,
  resolveResultType,
  resolveResultUrl,
  getLatestAvailableResultByLineUserId,
  getAvailableResultForCase,
  hasLinkedCasesByLineUserId,
  presentCaseResult
};
