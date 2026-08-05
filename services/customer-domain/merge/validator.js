'use strict';

const repository = require('../repository');
const { getCustomerDomainFlags } = require('../flags');
const { isCustomersDbConfigured } = require('../config');
const { CUSTOMER_STATUS } = require('../aliases');
const { isValidCustomerId } = require('../model');

/**
 * Validate manual merge approval payload.
 * @returns {{ ok: boolean, errors: string[], survivor?: object, losers?: object[] }}
 */
async function validateMergePayload(payload = {}, options = {}) {
  const errors = [];
  const flags = getCustomerDomainFlags();

  if (!options.skipFlagCheck) {
    if (!flags.mergeEnabled) {
      errors.push('CUSTOMER_DOMAIN_MERGE_ENABLED must be true');
    }
    if (!flags.enabled) {
      errors.push('CUSTOMER_DOMAIN_ENABLED must be true when merging');
    }
    if (!isCustomersDbConfigured()) {
      errors.push('NOTION_CUSTOMERS_DATABASE_ID is required');
    }
  }

  const survivorCustomerId = String(payload.survivorCustomerId || '').trim();
  const loserCustomerIds = Array.isArray(payload.loserCustomerIds)
    ? payload.loserCustomerIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
  const operatorId = String(payload.operatorId || '').trim();
  const reason = String(payload.reason || '').trim();

  if (!isValidCustomerId(survivorCustomerId)) errors.push('invalid survivorCustomerId');
  if (!loserCustomerIds.length) errors.push('loserCustomerIds required');
  if (loserCustomerIds.includes(survivorCustomerId)) errors.push('survivor must not be in loserCustomerIds');
  if (new Set(loserCustomerIds).size !== loserCustomerIds.length) errors.push('duplicate loserCustomerIds');
  if (!operatorId) errors.push('operatorId required');
  if (!reason) errors.push('reason required');

  for (const id of loserCustomerIds) {
    if (!isValidCustomerId(id)) errors.push(`invalid loserCustomerId: ${id}`);
  }

  if (errors.length) return { ok: false, errors };

  const survivor = await repository.findByCustomerId(survivorCustomerId);
  if (!survivor) errors.push('survivor not found');

  const losers = [];
  for (const id of loserCustomerIds) {
    const loser = await repository.findByCustomerId(id);
    if (!loser) {
      errors.push(`loser not found: ${id}`);
      continue;
    }
    if (String(loser.status || '').toLowerCase() === CUSTOMER_STATUS.MERGED) {
      errors.push(`loser already merged: ${id}`);
      continue;
    }
    losers.push(loser);
  }

  if (survivor && String(survivor.status || '').toLowerCase() === CUSTOMER_STATUS.MERGED) {
    errors.push('survivor is already merged');
  }

  // Conflicting LINE without explicit decision
  if (survivor && losers.length && !errors.length) {
    const survivorLine = String(survivor.lineUserId || '').trim();
    for (const loser of losers) {
      const loserLine = String(loser.lineUserId || '').trim();
      if (survivorLine && loserLine && survivorLine !== loserLine) {
        const decided = String(payload.identityDecisions?.lineUserId || '').trim();
        if (!decided || (decided !== survivorLine && decided !== loserLine)) {
          errors.push(`conflicting LINE identities require identityDecisions.lineUserId (${survivorLine} vs ${loserLine})`);
        }
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    survivor,
    losers,
    payload: {
      survivorCustomerId,
      loserCustomerIds,
      operatorId,
      reason,
      identityDecisions: payload.identityDecisions || null
    }
  };
}

module.exports = {
  validateMergePayload
};
