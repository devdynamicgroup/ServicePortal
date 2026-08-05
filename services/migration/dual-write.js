'use strict';

/**
 * M8.3 dual-write adapter (migration layer).
 * Case success is never blocked by Customer sync failure.
 */

const { getCustomerDomainFlags, isCustomersDbConfigured } = require('../customer-domain');
const { resolveAndLinkCustomer } = require('../customer-domain/resolver');
const { logEvent } = require('../observability');

function emptyResult(overrides = {}) {
  return {
    status: 'failed',
    customerId: null,
    caseId: null,
    conflicts: [],
    error: null,
    ...overrides
  };
}

function isDualWriteActive() {
  const flags = getCustomerDomainFlags();
  return Boolean(flags.enabled && flags.dualWrite && isCustomersDbConfigured());
}

/**
 * Build whitelist identity input from a Case job (+ optional overrides).
 */
function identityFromJob(job = {}, overrides = {}) {
  const fields = job?.draft?.fields || {};
  const fname = String(fields['ci-fname'] || '').trim();
  const lname = String(fields['ci-lname'] || '').trim();
  const name = [fname, lname].filter(Boolean).join(' ').trim()
    || String(overrides.name || job?.name || '').trim();

  const rawAddr = String(fields['ci-addr'] || '').trim();
  const address = rawAddr && rawAddr !== 'Address to confirm'
    ? rawAddr
    : String(overrides.address || '').trim();

  return {
    name: overrides.name !== undefined ? overrides.name : name,
    phone: overrides.phone !== undefined ? overrides.phone : (fields['ci-phone'] || ''),
    email: overrides.email !== undefined ? overrides.email : (fields['ci-email'] || ''),
    address: overrides.address !== undefined ? overrides.address : address,
    lineUserId: overrides.lineUserId !== undefined
      ? overrides.lineUserId
      : (job?.line?.userId || ''),
    lineDisplayName: overrides.lineDisplayName !== undefined
      ? overrides.lineDisplayName
      : (job?.line?.displayName || ''),
    lineLinked: overrides.lineLinked !== undefined
      ? overrides.lineLinked
      : Boolean(job?.line?.linked),
    lineLinkedAt: overrides.lineLinkedAt !== undefined
      ? overrides.lineLinkedAt
      : (job?.line?.linkedAt || null)
  };
}

/**
 * After Case operational write succeeds, attempt Customer sync.
 * Never throws to caller for sync failures.
 *
 * @returns {Promise<{ status, customerId, caseId, conflicts, error }>}
 */
async function dualWriteAfterCaseSuccess({
  job,
  source = 'unknown',
  identityOverrides = {},
  correlationId = null
} = {}) {
  const caseId = job?.notionId || null;

  if (!isDualWriteActive()) {
    return emptyResult({
      status: 'failed',
      caseId,
      error: 'dual_write_inactive'
    });
  }

  if (!caseId) {
    return emptyResult({ error: 'missing_case' });
  }

  try {
    const identity = identityFromJob(job, identityOverrides);
    const existingCustomerId = String(job?.customer?.id || '').trim() || null;

    const result = await resolveAndLinkCustomer({
      caseNotionId: caseId,
      existingCustomerId,
      identity,
      sourceFingerprint: `dual-write:v1|${source}|case:${caseId}`
    });

    const payload = {
      status: result.status,
      customerId: result.customerId,
      caseId: result.caseId || caseId,
      conflicts: result.conflicts || [],
      error: result.error || null
    };

    logEvent(
      payload.status === 'failed' || payload.status === 'ambiguous' ? 'warn' : 'info',
      'customer_dual_write',
      {
        correlationId,
        source,
        ...payload,
        conflictCount: payload.conflicts.length
      }
    );

    return payload;
  } catch (error) {
    const payload = emptyResult({
      caseId,
      error: error && error.message ? error.message : String(error)
    });
    logEvent('error', 'customer_dual_write_failed', {
      correlationId,
      source,
      ...payload
    });
    return payload;
  }
}

module.exports = {
  isDualWriteActive,
  identityFromJob,
  dualWriteAfterCaseSuccess
};
