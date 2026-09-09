'use strict';

/**
 * Exact Customer matching (no fuzzy, no name merge).
 * Persistence via repository only.
 */

const repository = require('./repository');
const { normalizePhone, normalizeEmail } = require('./validate');
const { isValidCustomerId } = require('./model');

/**
 * A match found via one of these channels is strong enough, on its own, to
 * treat "same Customer record" as safe to act on -- authorize a Case/LINE
 * link. Everything else (phone, email) is a candidate-identity SIGNAL only,
 * never authorization by itself: a phone number can be reassigned, reused,
 * or mistyped, so "phone matches an existing Customer who already has a
 * lineUserId" must never let a Case inherit that Customer's LINE identity.
 * `customerId` counts as strong because it only appears when a Case already
 * carried that link forward from a previous strong resolution -- it is not
 * a fresh inference from the current identity.
 *
 * Single source of truth for this rule (2026-08-27 forensic fix + follow-up
 * audit): resolver.js (live request path), migration/customer-backfill.js,
 * and migration/customer-reconcile/repair.js all import this from here
 * instead of each re-deriving their own notion of "strong enough" --
 * the two offline scripts previously had their own independent
 * phone/email-based matching with no strength check at all, which was the
 * exact same wrong-recipient bug living in a second, unguarded door.
 */
const STRONG_MATCH_CHANNELS = new Set(['line', 'customerId']);

/**
 * @param {string[]} via Channel(s) that produced a match (matchCustomer's
 *   `via`, or a single-channel array wrapping a migration/reconcile 'via' string).
 */
function isStrongMatch(via) {
  return Array.isArray(via) && via.some(channel => STRONG_MATCH_CHANNELS.has(channel));
}

/**
 * @param {{ existingCustomerId?: string, lineUserId?: string, phone?: string, email?: string }} keys
 * @returns {Promise<{ status: 'none'|'one'|'many', customers: object[], via: string[] }>}
 */
async function matchCustomer(keys = {}) {
  const found = [];
  const via = [];

  const pushUnique = (customer, channel) => {
    if (!customer?.customerId) return;
    if (found.some(item => item.customerId === customer.customerId)) return;
    found.push(customer);
    via.push(channel);
  };

  const existingId = String(keys.existingCustomerId || '').trim();
  if (existingId && isValidCustomerId(existingId)) {
    const byId = await repository.findByCustomerId(existingId);
    if (byId) {
      return { status: 'one', customers: [byId], via: ['customerId'] };
    }
  }

  const lineUserId = String(keys.lineUserId || '').trim();
  if (lineUserId) {
    const rows = await repository.findAllByLineUserId(lineUserId, { limit: 5 });
    rows.forEach(row => pushUnique(row, 'line'));
  }

  const phone = normalizePhone(keys.phone);
  if (phone) {
    const rows = await repository.findAllByPhone(phone, { limit: 5 });
    rows.forEach(row => pushUnique(row, 'phone'));
  }

  const email = normalizeEmail(keys.email);
  if (email) {
    const rows = await repository.findAllByEmail(email, { limit: 5 });
    rows.forEach(row => pushUnique(row, 'email'));
  }

  if (found.length === 0) return { status: 'none', customers: [], via };
  if (found.length === 1) return { status: 'one', customers: found, via };
  return { status: 'many', customers: found, via };
}

module.exports = {
  matchCustomer,
  STRONG_MATCH_CHANNELS,
  isStrongMatch
};
