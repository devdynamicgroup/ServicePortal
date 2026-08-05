'use strict';

const { CARE_EVENT_TYPES, CARE_AUDIT_STATUS, TEMPLATE_VERSIONS } = require('./events');
const { evaluateReinspection6mo } = require('./eligibility');
const { resolveCareDestination } = require('./destination');
const { hasTerminalSend } = require('./audit');
const { getCareReinspectionDays } = require('./flags');

/**
 * Load Customer for consent check when Case linked.
 */
async function loadCustomerConsent(job, deps) {
  const customerId = String(job?.customer?.id || '').trim();
  if (!customerId) return { customerId: null, consentLine: null };
  if (!deps?.findByCustomerId) return { customerId, consentLine: null };
  try {
    const customer = await deps.findByCustomerId(customerId);
    if (!customer) return { customerId, consentLine: null };
    if (customer.consentLine === false || customer.consentLine === true) {
      return { customerId, consentLine: Boolean(customer.consentLine) };
    }
    return { customerId, consentLine: null };
  } catch {
    return { customerId, consentLine: null };
  }
}

/**
 * Evaluate one Case into a care plan (no send).
 *
 * @returns {Promise<object>} plan
 */
async function evaluateCarePlan(job, options = {}) {
  const eventType = options.eventType || CARE_EVENT_TYPES.REINSPECTION_6MO;
  const dir = options.dir;
  const deps = options.deps || {};

  if (eventType !== CARE_EVENT_TYPES.REINSPECTION_6MO) {
    return {
      status: CARE_AUDIT_STATUS.SKIPPED,
      reason: 'unsupported_event',
      eventType,
      job
    };
  }

  const eligibility = evaluateReinspection6mo(job, {
    now: options.now,
    reinspectionDays: options.reinspectionDays != null
      ? options.reinspectionDays
      : getCareReinspectionDays()
  });

  if (!eligibility.eligible) {
    return {
      status: CARE_AUDIT_STATUS.SKIPPED,
      reason: eligibility.reason,
      eventType,
      eligibility,
      destination: null,
      templateVersion: TEMPLATE_VERSIONS.REINSPECTION_6MO
    };
  }

  if (eligibility.idempotencyKey && hasTerminalSend(eligibility.idempotencyKey, dir)) {
    return {
      status: CARE_AUDIT_STATUS.SKIPPED,
      reason: 'already_sent',
      eventType,
      eligibility,
      destination: null,
      templateVersion: TEMPLATE_VERSIONS.REINSPECTION_6MO
    };
  }

  const consent = await loadCustomerConsent(job, deps);
  if (consent.consentLine === false) {
    return {
      status: CARE_AUDIT_STATUS.SKIPPED,
      reason: 'consent_line_false',
      eventType,
      eligibility,
      consent,
      destination: null,
      templateVersion: TEMPLATE_VERSIONS.REINSPECTION_6MO
    };
  }

  const destination = await resolveCareDestination(job, {
    customerDomainFlags: options.customerDomainFlags,
    deps: deps.notifyDeps
  });

  if (!destination.lineUserId) {
    return {
      status: CARE_AUDIT_STATUS.SKIPPED,
      reason: destination.reason || 'no_line_user_id',
      eventType,
      eligibility,
      consent,
      destination,
      templateVersion: TEMPLATE_VERSIONS.REINSPECTION_6MO
    };
  }

  return {
    status: CARE_AUDIT_STATUS.PLANNED,
    reason: null,
    eventType,
    eligibility,
    consent,
    destination,
    templateVersion: TEMPLATE_VERSIONS.REINSPECTION_6MO
  };
}

module.exports = {
  evaluateCarePlan,
  loadCustomerConsent
};
