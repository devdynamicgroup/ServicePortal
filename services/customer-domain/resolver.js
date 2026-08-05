'use strict';

/**
 * Customer resolver — orchestration only.
 * Does not query Notion directly, does not modify Case, no migration reporting.
 */

const { matchCustomer } = require('./matcher');
const {
  createCustomerFromIdentity,
  applyIdentityPatch,
  buildIdentityPatch
} = require('./creator');
const { linkCaseToCustomer } = require('./linker');
const { normalizePhone, normalizeEmail } = require('./validate');

function collectSoftConflicts(identity, customer) {
  const conflicts = [];
  const phone = normalizePhone(identity.phone);
  const email = normalizeEmail(identity.email);
  const cPhone = normalizePhone(customer.phone);
  const cEmail = normalizeEmail(customer.email);

  if (phone && cPhone && phone === cPhone && email && cEmail && email !== cEmail) {
    conflicts.push({
      type: 'conflict_email_divergent',
      phone,
      caseEmail: email,
      customerEmail: cEmail
    });
  }
  if (email && cEmail && email === cEmail && phone && cPhone && phone !== cPhone) {
    conflicts.push({
      type: 'conflict_phone_divergent',
      email,
      casePhone: phone,
      customerPhone: cPhone
    });
  }
  return conflicts;
}

function detectLineOverwriteConflict(identity, customer) {
  const incoming = String(identity.lineUserId || '').trim();
  const existing = String(customer.lineUserId || '').trim();
  if (incoming && existing && incoming !== existing) {
    return {
      type: 'conflict_line_identity',
      caseLineUserId: incoming,
      customerLineUserId: existing
    };
  }
  return null;
}

/**
 * Resolve Customer for a Case and link.
 *
 * @param {{
 *   caseNotionId: string,
 *   identity: object,
 *   existingCustomerId?: string,
 *   sourceFingerprint?: string
 * }} input
 */
async function resolveAndLinkCustomer(input = {}) {
  const caseNotionId = String(input.caseNotionId || '').trim();
  const identity = input.identity && typeof input.identity === 'object' ? input.identity : {};
  const conflicts = [];

  if (!caseNotionId) {
    return {
      status: 'failed',
      customerId: null,
      caseId: null,
      conflicts: [],
      error: 'missing_case_id',
      customer: null
    };
  }

  const match = await matchCustomer({
    existingCustomerId: input.existingCustomerId || identity.existingCustomerId,
    lineUserId: identity.lineUserId,
    phone: identity.phone,
    email: identity.email
  });

  if (match.status === 'many') {
    return {
      status: 'ambiguous',
      customerId: null,
      caseId: caseNotionId,
      conflicts: [{
        type: 'ambiguous_match',
        customerIds: match.customers.map(c => c.customerId),
        via: match.via
      }],
      error: null,
      customer: null
    };
  }

  let customer = null;
  let status = 'matched';

  if (match.status === 'one') {
    customer = match.customers[0];
    const lineConflict = detectLineOverwriteConflict(identity, customer);
    if (lineConflict) conflicts.push(lineConflict);
    conflicts.push(...collectSoftConflicts(identity, customer));

    customer = await applyIdentityPatch(customer.customerId, identity, {
      blockLineOverwrite: Boolean(lineConflict)
    }) || customer;

    status = lineConflict ? 'conflict' : 'matched';
  } else {
    const patch = buildIdentityPatch(identity);
    const hasAny = Boolean(
      patch.displayName || patch.phone || patch.email || patch.lineUserId || patch.primaryAddress
    );
    if (!hasAny) {
      return {
        status: 'failed',
        customerId: null,
        caseId: caseNotionId,
        conflicts: [],
        error: 'no_identity_to_create',
        customer: null
      };
    }

    customer = await createCustomerFromIdentity(identity, {
      sourceFingerprint: input.sourceFingerprint || ''
    });
    status = 'created';
  }

  const link = await linkCaseToCustomer(caseNotionId, customer);
  // If already linked successfully and no create, prefer "linked" when Case already had same id
  if (input.existingCustomerId && input.existingCustomerId === customer.customerId && status === 'matched') {
    status = 'linked';
  }

  return {
    status,
    customerId: customer.customerId,
    caseId: link.caseId,
    conflicts,
    error: null,
    customer
  };
}

module.exports = {
  resolveAndLinkCustomer,
  collectSoftConflicts,
  detectLineOverwriteConflict
};
