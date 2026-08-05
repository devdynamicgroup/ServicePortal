'use strict';

/**
 * M8.5 — in-process metrics for Customer LINE read path.
 * PII-safe: never log full lineUserId in shared event payloads.
 */

function createEmptyCounters() {
  return {
    totalLookups: 0,
    customerHits: 0,
    customerMisses: 0,
    caseFallbacks: 0,
    casePrimaryHits: 0,
    mismatches: 0,
    missingLinks: 0,
    conflicts: 0,
    errors: 0
  };
}

const state = {
  mode: 'case_only',
  counters: createEmptyCounters()
};

function redactLineUserId(lineUserId) {
  const s = String(lineUserId || '').trim();
  if (!s) return '';
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function getSnapshot(flags = null) {
  const flagsSnapshot = flags
    ? {
      CUSTOMER_DOMAIN_ENABLED: Boolean(flags.enabled),
      CUSTOMER_DOMAIN_READ_LINE: Boolean(flags.readLine),
      CUSTOMER_DOMAIN_READ_LINE_SHADOW: Boolean(flags.readLineShadow),
      CUSTOMER_DOMAIN_READ_NOTIFY: Boolean(flags.readNotify)
    }
    : undefined;

  return {
    mode: state.mode,
    ...state.counters,
    ...(flagsSnapshot ? { flagsSnapshot } : {})
  };
}

function resetMetrics() {
  state.mode = 'case_only';
  state.counters = createEmptyCounters();
}

function setObservedMode(mode) {
  state.mode = mode || 'case_only';
}

function increment(key, by = 1) {
  if (!Object.prototype.hasOwnProperty.call(state.counters, key)) return;
  state.counters[key] += by;
}

/**
 * Structured, PII-safe diagnostic log for mismatch / conflict / error samples.
 */
function logSafeEvent(event, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    mode: state.mode,
    lineUserId: details.lineUserId ? redactLineUserId(details.lineUserId) : undefined,
    customerId: details.customerId || undefined,
    customerIds: details.customerIds || undefined,
    onlyInCaseCount: details.onlyInCaseCount,
    onlyInCustomerCount: details.onlyInCustomerCount,
    reason: details.reason || undefined,
    success: details.success !== false
  };
  console.info('[customer_line_read]', JSON.stringify(payload));
}

module.exports = {
  createEmptyCounters,
  redactLineUserId,
  getSnapshot,
  resetMetrics,
  setObservedMode,
  increment,
  logSafeEvent
};
