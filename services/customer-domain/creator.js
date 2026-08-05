'use strict';

/**
 * Customer creator + identity patch (whitelist only).
 */

const repository = require('./repository');
const { createCustomerId, createEmptyCustomer } = require('./model');
const { CUSTOMER_STATUS } = require('./aliases');
const { normalizePhone, normalizeEmail } = require('./validate');

/** Explicit identity patch whitelist (M8.3). */
const IDENTITY_PATCH_WHITELIST = Object.freeze([
  'name',
  'phone',
  'email',
  'address',
  'lineUserId',
  'lineDisplayName',
  'lineLinked',
  'lineLinkedAt'
]);

/**
 * Map whitelist input → Customer model fields.
 * Non-empty only (except explicit booleans).
 */
function buildIdentityPatch(input = {}) {
  const patch = {};
  const src = input && typeof input === 'object' ? input : {};

  for (const key of IDENTITY_PATCH_WHITELIST) {
    if (src[key] === undefined || src[key] === null) continue;

    if (key === 'name') {
      const value = String(src.name || '').trim();
      if (value) patch.displayName = value;
      continue;
    }
    if (key === 'address') {
      const value = String(src.address || '').trim();
      if (value) patch.primaryAddress = value;
      continue;
    }
    if (key === 'phone') {
      const value = normalizePhone(src.phone) || String(src.phone || '').trim();
      if (value) patch.phone = value;
      continue;
    }
    if (key === 'email') {
      const value = normalizeEmail(src.email);
      if (value) patch.email = value;
      continue;
    }
    if (key === 'lineUserId') {
      const value = String(src.lineUserId || '').trim();
      if (value) patch.lineUserId = value;
      continue;
    }
    if (key === 'lineDisplayName') {
      const value = String(src.lineDisplayName || '').trim();
      if (value) patch.lineDisplayName = value;
      continue;
    }
    if (key === 'lineLinked') {
      patch.lineLinked = Boolean(src.lineLinked);
      continue;
    }
    if (key === 'lineLinkedAt') {
      const value = String(src.lineLinkedAt || '').trim();
      if (value) patch.lineLinkedAt = value;
    }
  }

  return patch;
}

function hasStrongIdentity(patch) {
  return Boolean(patch.lineUserId || patch.phone || patch.email);
}

/**
 * Create a Customer from whitelist identity input.
 */
async function createCustomerFromIdentity(input = {}, options = {}) {
  const patch = buildIdentityPatch(input);
  const customerId = options.customerId || createCustomerId();
  const status = hasStrongIdentity(patch) ? CUSTOMER_STATUS.ACTIVE : CUSTOMER_STATUS.UNVERIFIED;

  const payload = createEmptyCustomer({
    ...patch,
    customerId,
    status,
    sourceFingerprint: options.sourceFingerprint || ''
  });

  return repository.create(payload);
}

/**
 * Apply whitelist identity patch to existing Customer.
 * Does not overwrite lineUserId when blockLineOverwrite is set.
 */
async function applyIdentityPatch(customerId, input = {}, options = {}) {
  const patch = buildIdentityPatch(input);
  if (options.blockLineOverwrite) {
    delete patch.lineUserId;
    // Keep display/linked timestamps if provided; LINE uid stays.
  }
  if (!Object.keys(patch).length) {
    return repository.findByCustomerId(customerId);
  }
  return repository.updateByCustomerId(customerId, patch);
}

module.exports = {
  IDENTITY_PATCH_WHITELIST,
  buildIdentityPatch,
  hasStrongIdentity,
  createCustomerFromIdentity,
  applyIdentityPatch
};
