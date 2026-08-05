'use strict';

/**
 * M8.7 — offline Case ↔ Customer identity drift scanner.
 * Exact match only. No name / fuzzy / guessing.
 */

const { normalizePhone, normalizeEmail } = require('../../customer-domain/validate');
const { CUSTOMER_STATUS } = require('../../customer-domain/aliases');

const FINDING_TYPES = Object.freeze([
  'missing_customer_link',
  'orphan_customer_link',
  'line_diverge',
  'line_case_only',
  'line_customer_only',
  'soft_phone_conflict',
  'soft_email_conflict',
  'unlinked_duplicate_line'
]);

function isInactiveCustomer(customer) {
  const status = String(customer?.status || '').toLowerCase();
  return status === CUSTOMER_STATUS.MERGED || status === CUSTOMER_STATUS.ANONYMIZED;
}

function extractCaseIdentity(job) {
  const fields = job?.draft?.fields || {};
  const lineUserId = String(job?.line?.userId || '').trim();
  const phone = normalizePhone(fields['ci-phone'] || '');
  const email = normalizeEmail(fields['ci-email'] || '');
  const customerId = String(job?.customer?.id || '').trim();
  const customerPageId = String(job?.customer?.pageId || '').trim();
  const hasStrong = Boolean(lineUserId || phone || email);

  return {
    caseNotionId: String(job?.notionId || job?.id || '').trim() || null,
    caseId: String(job?.id || '').trim() || null,
    lineUserId,
    phone,
    email,
    customerId,
    customerPageId,
    hasStrong
  };
}

function emptyCounters() {
  return {
    missingCustomerLink: 0,
    orphanCustomerLink: 0,
    lineDiverge: 0,
    lineCaseOnly: 0,
    lineCustomerOnly: 0,
    softPhoneConflict: 0,
    softEmailConflict: 0,
    unlinkedDuplicateLine: 0
  };
}

function bump(counters, key) {
  if (Object.prototype.hasOwnProperty.call(counters, key)) counters[key] += 1;
}

/**
 * @param {{ jobs?: object[], customers?: object[] }} input
 * @returns {{ findings: object[], counters: object, casesScanned: number, customersScanned: number, customersById: Map }}
 */
function scanIdentityDrift(input = {}) {
  const jobs = Array.isArray(input.jobs) ? input.jobs : [];
  const customers = Array.isArray(input.customers) ? input.customers : [];
  const findings = [];
  const counters = emptyCounters();

  const customersById = new Map();
  for (const customer of customers) {
    const id = String(customer?.customerId || '').trim();
    if (id) customersById.set(id, customer);
  }

  const casesByLine = new Map();

  for (const job of jobs) {
    const identity = extractCaseIdentity(job);
    if (!identity.caseNotionId) continue;

    if (identity.lineUserId) {
      const list = casesByLine.get(identity.lineUserId) || [];
      list.push(identity);
      casesByLine.set(identity.lineUserId, list);
    }

    // missing_customer_link: strong identity but no Customer ID
    if (identity.hasStrong && !identity.customerId) {
      findings.push({
        type: 'missing_customer_link',
        caseNotionId: identity.caseNotionId,
        caseId: identity.caseId,
        customerId: null,
        caseLine: identity.lineUserId || null,
        casePhone: identity.phone || null,
        caseEmail: identity.email || null
      });
      bump(counters, 'missingCustomerLink');
      continue; // no linked pair checks
    }

    if (!identity.customerId) continue;

    const customer = customersById.get(identity.customerId);
    if (!customer || isInactiveCustomer(customer)) {
      findings.push({
        type: 'orphan_customer_link',
        caseNotionId: identity.caseNotionId,
        caseId: identity.caseId,
        customerId: identity.customerId,
        reason: !customer ? 'customer_missing' : `customer_status_${String(customer.status || '').toLowerCase()}`
      });
      bump(counters, 'orphanCustomerLink');
      continue;
    }

    const customerLine = String(customer.lineUserId || '').trim();
    const customerPhone = normalizePhone(customer.phone || '');
    const customerEmail = normalizeEmail(customer.email || '');

    if (identity.lineUserId && customerLine && identity.lineUserId !== customerLine) {
      findings.push({
        type: 'line_diverge',
        caseNotionId: identity.caseNotionId,
        caseId: identity.caseId,
        customerId: identity.customerId,
        caseLine: identity.lineUserId,
        customerLine
      });
      bump(counters, 'lineDiverge');
    } else if (identity.lineUserId && !customerLine) {
      findings.push({
        type: 'line_case_only',
        caseNotionId: identity.caseNotionId,
        caseId: identity.caseId,
        customerId: identity.customerId,
        caseLine: identity.lineUserId
      });
      bump(counters, 'lineCaseOnly');
    } else if (!identity.lineUserId && customerLine) {
      findings.push({
        type: 'line_customer_only',
        caseNotionId: identity.caseNotionId,
        caseId: identity.caseId,
        customerId: identity.customerId,
        customerLine
      });
      bump(counters, 'lineCustomerOnly');
    }

    if (identity.phone && customerPhone && identity.phone !== customerPhone) {
      findings.push({
        type: 'soft_phone_conflict',
        caseNotionId: identity.caseNotionId,
        caseId: identity.caseId,
        customerId: identity.customerId,
        casePhone: identity.phone,
        customerPhone
      });
      bump(counters, 'softPhoneConflict');
    }

    if (identity.email && customerEmail && identity.email !== customerEmail) {
      findings.push({
        type: 'soft_email_conflict',
        caseNotionId: identity.caseNotionId,
        caseId: identity.caseId,
        customerId: identity.customerId,
        caseEmail: identity.email,
        customerEmail
      });
      bump(counters, 'softEmailConflict');
    }
  }

  // unlinked_duplicate_line: ≥2 Cases share LINE without a shared Customer ID
  for (const [lineUserId, list] of casesByLine.entries()) {
    if (list.length < 2) continue;
    const linkedIds = [...new Set(list.map(i => i.customerId).filter(Boolean))];
    const anyUnlinked = list.some(i => !i.customerId);
    const multipleDistinctLinks = linkedIds.length > 1;
    if (!anyUnlinked && linkedIds.length === 1) continue; // all same Customer — OK
    if (anyUnlinked || multipleDistinctLinks) {
      findings.push({
        type: 'unlinked_duplicate_line',
        lineUserId,
        caseNotionIds: list.map(i => i.caseNotionId),
        customerIds: linkedIds
      });
      bump(counters, 'unlinkedDuplicateLine');
    }
  }

  return {
    findings,
    counters,
    casesScanned: jobs.filter(j => j?.notionId || j?.id).length,
    customersScanned: customers.length,
    customersById
  };
}

module.exports = {
  FINDING_TYPES,
  extractCaseIdentity,
  isInactiveCustomer,
  scanIdentityDrift,
  emptyCounters
};
