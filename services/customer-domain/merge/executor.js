'use strict';

const repository = require('../repository');
const { CUSTOMER_STATUS } = require('../aliases');
const { getAllClients, updateClient } = require('../../notion/clients');
const { validateMergePayload } = require('./validator');
const {
  createMergeAuditSkeleton,
  writeAudit,
  readAudit,
  updateAuditResult
} = require('./audit');
const { updateTicketStatus, listTickets } = require('./queue');
const { DEFAULT_DIR } = require('./detector');

async function findCasesForCustomerId(customerId) {
  const jobs = await getAllClients();
  const id = String(customerId || '').trim();
  return jobs.filter(job => String(job?.customer?.id || '').trim() === id);
}

/**
 * Manual merge execution. Requires CUSTOMER_DOMAIN_MERGE_ENABLED=true.
 */
async function executeManualMerge(payload = {}, options = {}) {
  const dir = options.dir || DEFAULT_DIR;
  const validation = await validateMergePayload(payload);
  if (!validation.ok) {
    const error = new Error(`Merge validation failed: ${validation.errors.join('; ')}`);
    error.code = 'merge_validation_failed';
    error.errors = validation.errors;
    throw error;
  }

  const { survivor, losers, payload: normalized } = validation;
  const audit = createMergeAuditSkeleton({
    operatorId: normalized.operatorId,
    reason: normalized.reason,
    survivor,
    losers,
    identityDecisions: normalized.identityDecisions
  });
  writeAudit(audit, dir);

  const affectedCases = [];

  try {
    // 1) Mark losers merged (never delete, never change customerId)
    for (const loser of losers) {
      await repository.updateByCustomerId(loser.customerId, {
        status: CUSTOMER_STATUS.MERGED,
        mergedIntoCustomerId: survivor.customerId
      });
    }

    // 2) Relink Cases — Customer ID / Page ID only
    for (const loser of losers) {
      const cases = await findCasesForCustomerId(loser.customerId);
      for (const job of cases) {
        const previous = {
          customerId: String(job.customer?.id || ''),
          customerPageId: String(job.customer?.pageId || '')
        };
        await updateClient(job.notionId, {
          customerId: survivor.customerId,
          customerPageId: survivor.notionPageId
        });
        affectedCases.push({
          caseNotionId: job.notionId,
          fromCustomerId: loser.customerId,
          toCustomerId: survivor.customerId,
          previous,
          next: {
            customerId: survivor.customerId,
            customerPageId: survivor.notionPageId
          }
        });
      }
    }

    // Optional: apply explicit LINE decision on survivor only
    const decidedLine = String(normalized.identityDecisions?.lineUserId || '').trim();
    if (decidedLine && decidedLine !== String(survivor.lineUserId || '').trim()) {
      await repository.updateByCustomerId(survivor.customerId, { lineUserId: decidedLine });
    }

    const completed = updateAuditResult(audit.auditId, {
      affectedCases,
      result: 'completed'
    }, dir);

    // Close matching open tickets
    const openTickets = listTickets({ status: 'open' }, dir);
    for (const ticket of openTickets) {
      const set = new Set(ticket.customerIds || []);
      if (set.has(survivor.customerId) && losers.some(l => set.has(l.customerId))) {
        updateTicketStatus(ticket.ticketId, 'merged', dir);
      }
    }

    return {
      ok: true,
      auditId: audit.auditId,
      survivorCustomerId: survivor.customerId,
      loserCustomerIds: losers.map(l => l.customerId),
      affectedCaseCount: affectedCases.length,
      audit: completed
    };
  } catch (error) {
    updateAuditResult(audit.auditId, {
      affectedCases,
      result: 'failed',
      error: error && error.message ? error.message : String(error),
      note: 'stopped_on_failure'
    }, dir);
    const wrapped = new Error(`Merge failed after audit ${audit.auditId}: ${error.message}`);
    wrapped.code = 'merge_failed';
    wrapped.auditId = audit.auditId;
    wrapped.cause = error;
    throw wrapped;
  }
}

/**
 * Rollback a completed merge using audit snapshot.
 */
async function rollbackManualMerge(auditId, options = {}) {
  const dir = options.dir || DEFAULT_DIR;
  const { getCustomerDomainFlags } = require('../flags');
  const flags = getCustomerDomainFlags();
  if (!flags.mergeEnabled) {
    const error = new Error('CUSTOMER_DOMAIN_MERGE_ENABLED must be true for rollback');
    error.code = 'merge_flag_off';
    throw error;
  }

  const audit = readAudit(auditId, dir);
  if (!audit) {
    const error = new Error(`Audit not found: ${auditId}`);
    error.code = 'audit_not_found';
    throw error;
  }
  if (audit.result !== 'completed') {
    const error = new Error(`Audit result must be completed to rollback (was ${audit.result})`);
    error.code = 'audit_not_completed';
    throw error;
  }

  // Restore Case links from previous snapshots (clear if previous empty)
  const { getNotionClient } = require('../../notion/client');
  const { getDataSourceSchema } = require('../../notion/client');
  const { findPropertyKey } = require('../../notion/props');
  const { FIELD_ALIASES } = require('../../notion/mapper');
  const notion = getNotionClient();
  const { properties: caseSchema } = await getDataSourceSchema();

  for (const item of audit.affectedCases || []) {
    const prevId = String(item.previous?.customerId || '').trim();
    const prevPage = String(item.previous?.customerPageId || '').trim();
    if (prevId && prevPage) {
      await updateClient(item.caseNotionId, {
        customerId: prevId,
        customerPageId: prevPage
      });
    } else {
      const props = {};
      const idKey = findPropertyKey(caseSchema, FIELD_ALIASES.customerId);
      const pageKey = findPropertyKey(caseSchema, FIELD_ALIASES.customerPageId);
      if (idKey) props[idKey] = { rich_text: [] };
      if (pageKey) props[pageKey] = { rich_text: [] };
      if (Object.keys(props).length) {
        await notion.pages.update({ page_id: item.caseNotionId, properties: props });
      }
    }
  }

  // Restore losers
  for (const loser of audit.losers || []) {
    const snap = loser.snapshot || {};
    await repository.updateByCustomerId(loser.customerId, {
      status: snap.status || CUSTOMER_STATUS.ACTIVE,
      mergedIntoCustomerId: ''
    });
    // Clear mergedInto by writing empty — repository may skip empty strings.
    // Force clear via update with explicit empty rich_text if needed.
    const fresh = await repository.findByCustomerId(loser.customerId);
    if (fresh?.mergedIntoCustomerId) {
      const { getNotionClient } = require('../../notion/client');
      const { findPropertyKey } = require('../../notion/props');
      const { CUSTOMER_FIELD_ALIASES } = require('../aliases');
      const { getSchema } = repository;
      const notion = getNotionClient();
      const { properties } = await getSchema();
      const key = findPropertyKey(properties, CUSTOMER_FIELD_ALIASES.mergedIntoCustomerId);
      if (key && fresh.notionPageId) {
        await notion.pages.update({
          page_id: fresh.notionPageId,
          properties: { [key]: { rich_text: [] } }
        });
      }
    }
  }

  const updated = updateAuditResult(auditId, {
    result: 'rolled_back',
    note: 'manual_rollback'
  }, dir);

  return {
    ok: true,
    auditId,
    audit: updated,
    restoredLosers: (audit.losers || []).map(l => l.customerId),
    restoredCases: (audit.affectedCases || []).map(c => c.caseNotionId)
  };
}

module.exports = {
  executeManualMerge,
  rollbackManualMerge,
  findCasesForCustomerId
};
