'use strict';

/**
 * M8.6 — in-process metrics for Customer notification destination read.
 * PII-safe: never log full lineUserId in shared event payloads.
 */

function createEmptyCounters() {
  return {
    notifyResolves: 0,
    customerHits: 0,
    customerMisses: 0,
    customerNoLine: 0,
    caseFallbacks: 0,
    casePrimaryHits: 0,
    mismatches: 0,
    missingLinks: 0,
    errors: 0,
    skippedNoLine: 0
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
      CUSTOMER_DOMAIN_READ_NOTIFY: Boolean(flags.readNotify),
      CUSTOMER_DOMAIN_READ_NOTIFY_SHADOW: Boolean(flags.readNotifyShadow)
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

function logSafeEvent(event, details = {}) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    mode: state.mode,
    caseId: details.caseId || undefined,
    customerId: details.customerId || undefined,
    caseLine: details.caseLine ? redactLineUserId(details.caseLine) : undefined,
    customerLine: details.customerLine ? redactLineUserId(details.customerLine) : undefined,
    source: details.source || undefined,
    reason: details.reason || undefined,
    success: details.success !== false
  };
  console.info('[customer_notify_read]', JSON.stringify(payload));
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
