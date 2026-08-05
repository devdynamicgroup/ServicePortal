'use strict';

const crypto = require('crypto');
const { CUSTOMER_STATUS } = require('./aliases');

const CUSTOMER_ID_PREFIX = 'cust_';
const CUSTOMER_ID_PATTERN = /^cust_[a-z0-9]{8,32}$/i;

/**
 * Business identifier for Customer (immutable).
 * Persistence may also store Notion page id — never use page id as business id.
 */
function createCustomerId() {
  return `${CUSTOMER_ID_PREFIX}${crypto.randomBytes(8).toString('hex')}`;
}

function isValidCustomerId(value) {
  return CUSTOMER_ID_PATTERN.test(String(value || '').trim());
}

/**
 * @typedef {object} Customer
 * @property {string} customerId          Business id (cust_…)
 * @property {string|null} notionPageId   Persistence id only
 * @property {string} displayName
 * @property {string} phone
 * @property {string} email
 * @property {string} primaryAddress
 * @property {string} lineId
 * @property {string} lineDisplayName
 * @property {string} lineUserId
 * @property {boolean} lineLinked
 * @property {string|null} lineLinkedAt
 * @property {string} status
 * @property {number|null} lifetimeScore
 * @property {boolean} consentMarketing
 * @property {boolean} consentLine
 * @property {string|null} consentMarketingAt
 * @property {string|null} consentLineAt
 * @property {string} preferredLocale
 * @property {string|null} mergedIntoCustomerId
 * @property {string} sourceFingerprint
 * @property {string|null} createdTime
 * @property {string|null} lastEditedTime
 */

function createEmptyCustomer(overrides = {}) {
  return {
    customerId: overrides.customerId || createCustomerId(),
    notionPageId: overrides.notionPageId || null,
    displayName: String(overrides.displayName || '').trim(),
    phone: String(overrides.phone || '').trim(),
    email: String(overrides.email || '').trim(),
    primaryAddress: String(overrides.primaryAddress || '').trim(),
    lineId: String(overrides.lineId || '').trim(),
    lineDisplayName: String(overrides.lineDisplayName || '').trim(),
    lineUserId: String(overrides.lineUserId || '').trim(),
    lineLinked: Boolean(overrides.lineLinked),
    lineLinkedAt: overrides.lineLinkedAt || null,
    status: overrides.status || CUSTOMER_STATUS.ACTIVE,
    lifetimeScore: overrides.lifetimeScore == null || overrides.lifetimeScore === ''
      ? null
      : Number(overrides.lifetimeScore),
    consentMarketing: Boolean(overrides.consentMarketing),
    consentLine: Boolean(overrides.consentLine),
    consentMarketingAt: overrides.consentMarketingAt || null,
    consentLineAt: overrides.consentLineAt || null,
    preferredLocale: String(overrides.preferredLocale || '').trim(),
    mergedIntoCustomerId: overrides.mergedIntoCustomerId || null,
    sourceFingerprint: String(overrides.sourceFingerprint || '').trim(),
    createdTime: overrides.createdTime || null,
    lastEditedTime: overrides.lastEditedTime || null
  };
}

module.exports = {
  CUSTOMER_ID_PREFIX,
  CUSTOMER_ID_PATTERN,
  createCustomerId,
  isValidCustomerId,
  createEmptyCustomer
};
