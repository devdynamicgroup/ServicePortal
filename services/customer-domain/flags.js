'use strict';

/**
 * Customer Domain feature flags.
 * M8.1: all default OFF — must not alter production runtime behavior.
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

function getCustomerDomainFlags() {
  return Object.freeze({
    /** Master switch for Customer Domain runtime use */
    enabled: parseBool(process.env.CUSTOMER_DOMAIN_ENABLED, false),
    /** M8.3+: booking + LINE link dual-write */
    dualWrite: parseBool(process.env.CUSTOMER_DOMAIN_DUAL_WRITE, false),
    /** M8.5+: LINE history/latest prefer Customer path */
    readLine: parseBool(process.env.CUSTOMER_DOMAIN_READ_LINE, false),
    /** M8.5: dual-read compare; Case still authoritative (requires ENABLED, ignored if READ_LINE) */
    readLineShadow: parseBool(process.env.CUSTOMER_DOMAIN_READ_LINE_SHADOW, false),
    /** M8.6+: notification LINE id prefer Customer */
    readNotify: parseBool(process.env.CUSTOMER_DOMAIN_READ_NOTIFY, false),
    /** M8.6: dual-read compare; Case still authoritative for push (ignored if READ_NOTIFY) */
    readNotifyShadow: parseBool(process.env.CUSTOMER_DOMAIN_READ_NOTIFY_SHADOW, false),
    /** M8.4+: manual merge execute / rollback */
    mergeEnabled: parseBool(process.env.CUSTOMER_DOMAIN_MERGE_ENABLED, false)
  });
}

/** True when any rollout flag is on (should imply enabled for future milestones). */
function isAnyCustomerDomainFlagOn(flags = getCustomerDomainFlags()) {
  return Boolean(
    flags.enabled
    || flags.dualWrite
    || flags.readLine
    || flags.readLineShadow
    || flags.readNotify
    || flags.readNotifyShadow
    || flags.mergeEnabled
  );
}

module.exports = {
  parseBool,
  getCustomerDomainFlags,
  isAnyCustomerDomainFlagOn
};
