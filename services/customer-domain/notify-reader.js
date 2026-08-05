'use strict';

/**
 * M8.6 — Customer-backed LINE destination for notification push.
 *
 * Case remains notification lifecycle owner.
 * Exact customerId lookup only. No phone / email / name / fuzzy.
 * On Case LINE ≠ Customer LINE: Case wins (wrong-recipient protection).
 * Does not touch OA history path (READ_LINE / M8.5).
 */

const { getCustomerDomainFlags } = require('./flags');
const repository = require('./repository');
const metrics = require('./notify-read-metrics');

/**
 * @param {{ enabled?: boolean, readNotify?: boolean, readNotifyShadow?: boolean }} flags
 * @returns {'case_only'|'shadow'|'primary'}
 */
function resolveNotifyReadMode(flags = {}) {
  if (flags.enabled && flags.readNotify) return 'primary';
  if (flags.enabled && flags.readNotifyShadow && !flags.readNotify) return 'shadow';
  return 'case_only';
}

function caseLineFromJob(job) {
  return String(job?.line?.userId || '').trim();
}

function customerIdFromJob(job) {
  return String(job?.customer?.id || '').trim();
}

/**
 * Load Customer LINE for a Case link. Exact customerId only.
 * @returns {Promise<{
 *   status: 'hit'|'miss'|'no_line'|'missing_link'|'error',
 *   customerId: string|null,
 *   customerLine: string,
 *   error: Error|null
 * }>}
 */
async function loadCustomerLine(job, deps) {
  const customerId = customerIdFromJob(job);
  if (!customerId) {
    return {
      status: 'missing_link',
      customerId: null,
      customerLine: '',
      error: null
    };
  }

  try {
    const customer = await deps.findByCustomerId(customerId);
    if (!customer) {
      return {
        status: 'miss',
        customerId,
        customerLine: '',
        error: null
      };
    }
    const customerLine = String(customer.lineUserId || '').trim();
    if (!customerLine) {
      return {
        status: 'no_line',
        customerId,
        customerLine: '',
        error: null
      };
    }
    return {
      status: 'hit',
      customerId,
      customerLine,
      error: null
    };
  } catch (error) {
    return {
      status: 'error',
      customerId,
      customerLine: '',
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

function recordCustomerSide(outcome, caseLine, caseId) {
  if (outcome.status === 'hit') {
    metrics.increment('customerHits');
    if (caseLine && caseLine !== outcome.customerLine) {
      metrics.increment('mismatches');
      metrics.logSafeEvent('customer_notify_read_mismatch', {
        caseId,
        customerId: outcome.customerId,
        caseLine,
        customerLine: outcome.customerLine,
        reason: 'line_diverge'
      });
    }
    return;
  }
  if (outcome.status === 'miss') {
    metrics.increment('customerMisses');
    return;
  }
  if (outcome.status === 'no_line') {
    metrics.increment('customerNoLine');
    return;
  }
  if (outcome.status === 'missing_link') {
    metrics.increment('missingLinks');
    return;
  }
  if (outcome.status === 'error') {
    metrics.increment('errors');
    metrics.logSafeEvent('customer_notify_read_error', {
      caseId,
      customerId: outcome.customerId,
      reason: outcome.error?.message || 'customer_path_error',
      success: false
    });
  }
}

/**
 * Choose primary destination. Case wins on mismatch.
 * @returns {{ lineUserId: string, source: 'customer'|'case', fellBack: boolean }}
 */
function choosePrimaryDestination(caseLine, outcome) {
  if (outcome.status === 'hit') {
    if (!caseLine) {
      return { lineUserId: outcome.customerLine, source: 'customer', fellBack: false };
    }
    if (caseLine === outcome.customerLine) {
      return { lineUserId: outcome.customerLine, source: 'customer', fellBack: false };
    }
    // diverge: Case wins
    return { lineUserId: caseLine, source: 'case', fellBack: true };
  }
  return { lineUserId: caseLine, source: 'case', fellBack: true };
}

/**
 * Resolve LINE User ID for outbound result push.
 *
 * @param {object} job Case job shape (line.userId, customer.id)
 * @param {{ flags?: object, deps?: object }} [options]
 * @returns {Promise<{
 *   lineUserId: string,
 *   source: 'case'|'customer',
 *   mode: string,
 *   customerId: string|null,
 *   caseLine: string,
 *   customerLine: string
 * }>}
 */
async function resolveNotifyLineDestination(job, options = {}) {
  const flags = options.flags || getCustomerDomainFlags();
  const deps = {
    findByCustomerId: (...args) => repository.findByCustomerId(...args),
    ...(options.deps || {})
  };

  const mode = resolveNotifyReadMode(flags);
  metrics.setObservedMode(mode);
  metrics.increment('notifyResolves');

  const caseLine = caseLineFromJob(job);
  const caseId = String(job?.id || job?.notionId || '').trim() || null;

  if (mode === 'case_only') {
    metrics.increment('casePrimaryHits');
    if (!caseLine) metrics.increment('skippedNoLine');
    return {
      lineUserId: caseLine,
      source: 'case',
      mode,
      customerId: customerIdFromJob(job) || null,
      caseLine,
      customerLine: ''
    };
  }

  if (mode === 'shadow') {
    metrics.increment('casePrimaryHits');
    const outcome = await loadCustomerLine(job, deps);
    recordCustomerSide(outcome, caseLine, caseId);
    if (!caseLine) metrics.increment('skippedNoLine');
    return {
      lineUserId: caseLine,
      source: 'case',
      mode,
      customerId: outcome.customerId,
      caseLine,
      customerLine: outcome.customerLine
    };
  }

  // primary
  const outcome = await loadCustomerLine(job, deps);
  recordCustomerSide(outcome, caseLine, caseId);
  const chosen = choosePrimaryDestination(caseLine, outcome);
  if (chosen.fellBack) metrics.increment('caseFallbacks');
  if (!chosen.lineUserId) metrics.increment('skippedNoLine');

  return {
    lineUserId: chosen.lineUserId,
    source: chosen.source,
    mode,
    customerId: outcome.customerId,
    caseLine,
    customerLine: outcome.customerLine
  };
}

/**
 * Build a shallow job copy with resolved destination LINE for push helpers.
 * Does not mutate notification lifecycle fields on the original job.
 */
function applyDestinationToJob(job, lineUserId) {
  const resolved = String(lineUserId || '').trim();
  const current = caseLineFromJob(job);
  if (resolved === current) return job;
  return {
    ...job,
    line: {
      ...(job?.line || {}),
      userId: resolved
    }
  };
}

module.exports = {
  resolveNotifyReadMode,
  resolveNotifyLineDestination,
  applyDestinationToJob,
  caseLineFromJob,
  customerIdFromJob
};
