'use strict';

/**
 * Resolve LINE destination for care events.
 * Default: Case LINE. If Customer READ_NOTIFY primary: reuse M8.6 notify-reader.
 * Never invent LINE via phone/email/name.
 */

const { getCustomerDomainFlags } = require('../customer-domain/flags');
const {
  resolveNotifyLineDestination
} = require('../customer-domain/notify-reader');
const { DESTINATION_TYPES } = require('./events');
const { hashDestinationId } = require('./eligibility');

/**
 * @param {object} job
 * @param {{ flags?: object, customerDomainFlags?: object, deps?: object }} [options]
 */
async function resolveCareDestination(job, options = {}) {
  const customerFlags = options.customerDomainFlags || getCustomerDomainFlags();
  const caseLine = String(job?.line?.userId || '').trim();

  // Only use Customer path when primary notify read is on (not shadow).
  if (customerFlags.enabled && customerFlags.readNotify) {
    const resolved = await resolveNotifyLineDestination(job, {
      flags: customerFlags,
      deps: options.deps
    });
    const lineUserId = String(resolved.lineUserId || '').trim();
    return {
      lineUserId,
      destinationType: resolved.source === 'customer'
        ? DESTINATION_TYPES.CUSTOMER_LINE
        : DESTINATION_TYPES.CASE_LINE,
      destinationIdHash: hashDestinationId(lineUserId),
      customerId: resolved.customerId || String(job?.customer?.id || '').trim() || null,
      reason: lineUserId ? null : 'no_line_user_id'
    };
  }

  return {
    lineUserId: caseLine,
    destinationType: DESTINATION_TYPES.CASE_LINE,
    destinationIdHash: hashDestinationId(caseLine),
    customerId: String(job?.customer?.id || '').trim() || null,
    reason: caseLine ? null : 'no_line_user_id'
  };
}

module.exports = {
  resolveCareDestination
};
