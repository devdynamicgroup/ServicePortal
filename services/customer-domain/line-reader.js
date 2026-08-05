'use strict';

/**
 * M8.5 — Customer-backed LINE identity read (history / latest).
 *
 * Exact LINE User ID only. No phone / email / name / fuzzy.
 * Case remains fallback and operational aggregate root.
 * Does not touch notification send path (READ_NOTIFY / M8.6).
 */

const { getCustomerDomainFlags } = require('./flags');
const repository = require('./repository');
const {
  findClientsByLineUserId,
  findClientsByCustomerId
} = require('../notion/clients');
const metrics = require('./line-read-metrics');

function defaultCaseHasReport(job) {
  return Boolean(
    String(job?.result?.publicReportToken || '').trim()
    || String(job?.result?.reportUrl || '').trim()
  );
}

function defaultCaseSortTimestamp(job) {
  return Date.parse(
    job?.notification?.resultSentAt
    || job?.workflow?.serviceCompletedAt
    || job?.workflow?.closedAt
    || job?.createdTime
    || 0
  ) || 0;
}

function buildResolved(jobs, caseHasReport, caseSortTimestamp) {
  const list = Array.isArray(jobs) ? jobs : [];
  const withReport = list
    .filter(caseHasReport)
    .sort((a, b) => caseSortTimestamp(b) - caseSortTimestamp(a));
  return {
    linked: list.length > 0,
    jobs: list,
    withReport,
    latest: withReport[0] || null
  };
}

function notionIdSet(jobs) {
  return new Set(
    (jobs || [])
      .map(job => String(job?.notionId || job?.id || '').trim())
      .filter(Boolean)
  );
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

/**
 * @param {{ enabled?: boolean, readLine?: boolean, readLineShadow?: boolean }} flags
 * @returns {'case_only'|'shadow'|'primary'}
 */
function resolveLineReadMode(flags = {}) {
  if (flags.enabled && flags.readLine) return 'primary';
  if (flags.enabled && flags.readLineShadow && !flags.readLine) return 'shadow';
  return 'case_only';
}

/**
 * Customer path: exact LINE → Cases by Customer ID.
 * Never guesses on multi-Customer conflict.
 *
 * @returns {Promise<{
 *   status: 'hit'|'miss'|'missing_links'|'conflict'|'error',
 *   jobs: Array,
 *   customerId: string|null,
 *   customerIds: string[],
 *   error: Error|null
 * }>}
 */
async function loadCustomerPathCases(lineUserId, deps) {
  const userId = String(lineUserId || '').trim();
  try {
    const customers = await deps.findAllByLineUserId(userId, { limit: 5 });
    if (!customers.length) {
      return {
        status: 'miss',
        jobs: [],
        customerId: null,
        customerIds: [],
        error: null
      };
    }
    if (customers.length > 1) {
      return {
        status: 'conflict',
        jobs: [],
        customerId: null,
        customerIds: customers.map(c => c.customerId).filter(Boolean),
        error: null
      };
    }
    const customer = customers[0];
    const customerId = String(customer.customerId || '').trim();
    const jobs = await deps.findClientsByCustomerId(customerId, { limit: 100 });
    if (!jobs.length) {
      return {
        status: 'missing_links',
        jobs: [],
        customerId,
        customerIds: [customerId],
        error: null
      };
    }
    return {
      status: 'hit',
      jobs,
      customerId,
      customerIds: [customerId],
      error: null
    };
  } catch (error) {
    return {
      status: 'error',
      jobs: [],
      customerId: null,
      customerIds: [],
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

function recordCustomerPathOutcome(outcome, lineUserId) {
  if (outcome.status === 'hit') {
    metrics.increment('customerHits');
    return;
  }
  if (outcome.status === 'miss') {
    metrics.increment('customerMisses');
    return;
  }
  if (outcome.status === 'missing_links') {
    metrics.increment('missingLinks');
    metrics.logSafeEvent('customer_line_read_missing_links', {
      lineUserId,
      customerId: outcome.customerId
    });
    return;
  }
  if (outcome.status === 'conflict') {
    metrics.increment('conflicts');
    metrics.logSafeEvent('customer_line_read_conflict', {
      lineUserId,
      customerIds: outcome.customerIds,
      reason: 'multiple_customers_same_line'
    });
    return;
  }
  if (outcome.status === 'error') {
    metrics.increment('errors');
    metrics.logSafeEvent('customer_line_read_error', {
      lineUserId,
      reason: outcome.error?.message || 'customer_path_error',
      success: false
    });
  }
}

function compareShadowSets(caseJobs, customerJobs, lineUserId, outcome) {
  if (outcome.status === 'error' || outcome.status === 'conflict') {
    return;
  }
  const caseIds = notionIdSet(caseJobs);
  const customerIds = notionIdSet(customerJobs);
  if (setsEqual(caseIds, customerIds)) return;

  metrics.increment('mismatches');
  let onlyInCase = 0;
  let onlyInCustomer = 0;
  for (const id of caseIds) {
    if (!customerIds.has(id)) onlyInCase += 1;
  }
  for (const id of customerIds) {
    if (!caseIds.has(id)) onlyInCustomer += 1;
  }
  metrics.logSafeEvent('customer_line_read_mismatch', {
    lineUserId,
    customerId: outcome.customerId,
    onlyInCaseCount: onlyInCase,
    onlyInCustomerCount: onlyInCustomer,
    reason: outcome.status === 'missing_links' || outcome.status === 'miss'
      ? outcome.status
      : 'set_diff'
  });
}

/**
 * Resolve Cases for LINE OA view_latest / history.
 *
 * @param {string} lineUserId
 * @param {{
 *   caseHasReport?: Function,
 *   caseSortTimestamp?: Function,
 *   flags?: object,
 *   deps?: object
 * }} [options]
 * @returns {Promise<{ linked: boolean, jobs: Array, withReport: Array, latest: object|null }>}
 */
async function resolveLineCustomerCases(lineUserId, options = {}) {
  const caseHasReport = options.caseHasReport || defaultCaseHasReport;
  const caseSortTimestamp = options.caseSortTimestamp || defaultCaseSortTimestamp;
  const flags = options.flags || getCustomerDomainFlags();
  const deps = {
    findClientsByLineUserId,
    findClientsByCustomerId,
    findAllByLineUserId: (...args) => repository.findAllByLineUserId(...args),
    ...(options.deps || {})
  };

  const mode = resolveLineReadMode(flags);
  metrics.setObservedMode(mode);
  metrics.increment('totalLookups');

  const userId = String(lineUserId || '').trim();

  // ——— case_only: identical to pre-M8.5 (no Customer calls) ———
  if (mode === 'case_only') {
    const jobs = await deps.findClientsByLineUserId(userId, { limit: 100 });
    metrics.increment('casePrimaryHits');
    return buildResolved(jobs, caseHasReport, caseSortTimestamp);
  }

  // ——— shadow: Case authoritative; Customer path compare only ———
  if (mode === 'shadow') {
    const caseJobs = await deps.findClientsByLineUserId(userId, { limit: 100 });
    metrics.increment('casePrimaryHits');
    const outcome = await loadCustomerPathCases(userId, deps);
    recordCustomerPathOutcome(outcome, userId);
    compareShadowSets(caseJobs, outcome.jobs, userId, outcome);
    return buildResolved(caseJobs, caseHasReport, caseSortTimestamp);
  }

  // ——— primary: Customer first; Case LINE fallback ———
  const outcome = await loadCustomerPathCases(userId, deps);
  recordCustomerPathOutcome(outcome, userId);

  if (outcome.status === 'hit') {
    return buildResolved(outcome.jobs, caseHasReport, caseSortTimestamp);
  }

  metrics.increment('caseFallbacks');
  const fallbackJobs = await deps.findClientsByLineUserId(userId, { limit: 100 });
  return buildResolved(fallbackJobs, caseHasReport, caseSortTimestamp);
}

module.exports = {
  resolveLineReadMode,
  resolveLineCustomerCases,
  buildResolved,
  defaultCaseHasReport,
  defaultCaseSortTimestamp
};
