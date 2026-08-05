'use strict';

/**
 * M9.0 Care Lifecycle flags — all default OFF.
 * Independent of CUSTOMER_DOMAIN_*.
 */

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function getCareLifecycleFlags() {
  return Object.freeze({
    enabled: parseBool(process.env.CARE_LIFECYCLE_ENABLED, false),
    send: parseBool(process.env.CARE_LIFECYCLE_SEND, false),
    /** M9.2: write outcome fields back into audit store */
    outcomeTracking: parseBool(process.env.CARE_OUTCOME_TRACKING, false),
    /** M9.2: optional gate for report generation in prod cron (CLI may still read files) */
    outcomeReport: parseBool(process.env.CARE_OUTCOME_REPORT, false)
  });
}

function getCareReinspectionDays() {
  const n = Number(process.env.CARE_REINSPECTION_DAYS);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 182;
}

function getCareAuditsDatabaseId() {
  return String(process.env.NOTION_CARE_AUDITS_DATABASE_ID || '').trim();
}

function isCareAuditsDbConfigured() {
  return Boolean(getCareAuditsDatabaseId() && process.env.NOTION_API_KEY);
}

module.exports = {
  parseBool,
  getCareLifecycleFlags,
  getCareReinspectionDays,
  getCareAuditsDatabaseId,
  isCareAuditsDbConfigured
};
