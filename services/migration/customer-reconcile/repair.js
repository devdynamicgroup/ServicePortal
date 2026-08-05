'use strict';

/**
 * M8.7 — allow-listed identity repairs.
 * Default dryRun=true. Never auto-fixes line_diverge.
 * Exact match only for link_missing (LINE → phone → email).
 */

const { updateClient } = require('../../notion/clients');
const { linkCaseToCustomer } = require('../../customer-domain/linker');
const { applyIdentityPatch } = require('../../customer-domain/creator');
const { normalizePhone, normalizeEmail } = require('../../customer-domain/validate');
const { CUSTOMER_STATUS } = require('../../customer-domain/aliases');
const { extractCaseIdentity, isInactiveCustomer } = require('./scanner');

const ALLOWED_ACTIONS = Object.freeze([
  'link_missing',
  'fill_case_line_from_customer',
  'fill_customer_line_from_case'
]);

function isActiveCustomer(customer) {
  return Boolean(customer?.customerId) && !isInactiveCustomer(customer);
}

/**
 * Exact unique Customer match: LINE, then phone, then email.
 * @returns {{ status: 'one'|'none'|'many', customer: object|null, via: string|null }}
 */
function findUniqueCustomerForCase(identity, customers) {
  const active = (customers || []).filter(isActiveCustomer);

  const byLine = identity.lineUserId
    ? active.filter(c => String(c.lineUserId || '').trim() === identity.lineUserId)
    : [];
  if (byLine.length === 1) return { status: 'one', customer: byLine[0], via: 'line' };
  if (byLine.length > 1) return { status: 'many', customer: null, via: 'line' };

  if (identity.phone) {
    const byPhone = active.filter(c => normalizePhone(c.phone) === identity.phone);
    if (byPhone.length === 1) return { status: 'one', customer: byPhone[0], via: 'phone' };
    if (byPhone.length > 1) return { status: 'many', customer: null, via: 'phone' };
  }

  if (identity.email) {
    const byEmail = active.filter(c => normalizeEmail(c.email) === identity.email);
    if (byEmail.length === 1) return { status: 'one', customer: byEmail[0], via: 'email' };
    if (byEmail.length > 1) return { status: 'many', customer: null, via: 'email' };
  }

  return { status: 'none', customer: null, via: null };
}

function lineOwnerCount(lineUserId, customers, exceptCustomerId) {
  const line = String(lineUserId || '').trim();
  if (!line) return 0;
  return (customers || []).filter(c => {
    if (!isActiveCustomer(c)) return false;
    if (exceptCustomerId && c.customerId === exceptCustomerId) return false;
    return String(c.lineUserId || '').trim() === line;
  }).length;
}

/**
 * Build repair proposals from scan findings + raw jobs/customers.
 */
function proposeRepairs(action, context = {}) {
  if (!ALLOWED_ACTIONS.includes(action)) {
    const error = new Error(`Unsupported repair action: ${action}`);
    error.code = 'unsupported_repair_action';
    throw error;
  }

  const findings = Array.isArray(context.findings) ? context.findings : [];
  const jobs = Array.isArray(context.jobs) ? context.jobs : [];
  const customers = Array.isArray(context.customers) ? context.customers : [];
  const jobsByNotionId = new Map(jobs.map(j => [String(j.notionId || '').trim(), j]));
  const customersById = new Map(
    customers.filter(c => c?.customerId).map(c => [c.customerId, c])
  );

  const proposals = [];

  if (action === 'link_missing') {
    for (const finding of findings.filter(f => f.type === 'missing_customer_link')) {
      const job = jobsByNotionId.get(finding.caseNotionId);
      if (!job) continue;
      const identity = extractCaseIdentity(job);
      const match = findUniqueCustomerForCase(identity, customers);
      if (match.status !== 'one') {
        proposals.push({
          action,
          status: 'skipped',
          reason: match.status === 'many' ? 'ambiguous_match' : 'no_unique_match',
          via: match.via,
          caseNotionId: finding.caseNotionId,
          customerId: null
        });
        continue;
      }
      proposals.push({
        action,
        status: 'proposed',
        via: match.via,
        caseNotionId: finding.caseNotionId,
        customerId: match.customer.customerId,
        customerPageId: match.customer.notionPageId
      });
    }
  }

  if (action === 'fill_case_line_from_customer') {
    for (const finding of findings.filter(f => f.type === 'line_customer_only')) {
      const customer = customersById.get(finding.customerId);
      const customerLine = String(customer?.lineUserId || finding.customerLine || '').trim();
      if (!customerLine) {
        proposals.push({
          action,
          status: 'skipped',
          reason: 'customer_line_empty',
          caseNotionId: finding.caseNotionId,
          customerId: finding.customerId
        });
        continue;
      }
      proposals.push({
        action,
        status: 'proposed',
        caseNotionId: finding.caseNotionId,
        customerId: finding.customerId,
        lineUserId: customerLine
      });
    }
  }

  if (action === 'fill_customer_line_from_case') {
    for (const finding of findings.filter(f => f.type === 'line_case_only')) {
      const caseLine = String(finding.caseLine || '').trim();
      if (!caseLine) continue;
      const owners = lineOwnerCount(caseLine, customers, finding.customerId);
      if (owners > 0) {
        proposals.push({
          action,
          status: 'skipped',
          reason: 'line_owned_by_other_customer',
          caseNotionId: finding.caseNotionId,
          customerId: finding.customerId,
          lineUserId: caseLine
        });
        continue;
      }
      proposals.push({
        action,
        status: 'proposed',
        caseNotionId: finding.caseNotionId,
        customerId: finding.customerId,
        lineUserId: caseLine
      });
    }
  }

  return proposals;
}

/**
 * Execute allow-listed repairs.
 * @param {string} action
 * @param {{ dryRun?: boolean, findings, jobs, customers, deps? }} options
 */
async function runRepairs(action, options = {}) {
  const dryRun = options.dryRun !== false; // default true
  const proposals = proposeRepairs(action, options);
  const deps = {
    linkCaseToCustomer,
    updateClient,
    applyIdentityPatch,
    ...(options.deps || {})
  };

  const results = [];
  let applied = 0;
  let errors = 0;
  let proposed = 0;

  for (const proposal of proposals) {
    if (proposal.status !== 'proposed') {
      results.push(proposal);
      continue;
    }
    proposed += 1;

    if (dryRun) {
      results.push({ ...proposal, dryRun: true });
      continue;
    }

    try {
      if (action === 'link_missing') {
        await deps.linkCaseToCustomer(proposal.caseNotionId, {
          customerId: proposal.customerId,
          notionPageId: proposal.customerPageId
        });
      } else if (action === 'fill_case_line_from_customer') {
        await deps.updateClient(proposal.caseNotionId, {
          lineUserId: proposal.lineUserId
        });
      } else if (action === 'fill_customer_line_from_case') {
        await deps.applyIdentityPatch(proposal.customerId, {
          lineUserId: proposal.lineUserId,
          lineLinked: true,
          lineLinkedAt: new Date().toISOString()
        });
      }
      applied += 1;
      results.push({ ...proposal, status: 'applied', dryRun: false });
    } catch (error) {
      errors += 1;
      results.push({
        ...proposal,
        status: 'error',
        dryRun: false,
        error: error.message || String(error)
      });
    }
  }

  return {
    action,
    dryRun,
    proposals: results,
    repairsProposed: proposed,
    repairsApplied: applied,
    repairErrors: errors,
    skipped: results.filter(r => r.status === 'skipped').length
  };
}

module.exports = {
  ALLOWED_ACTIONS,
  findUniqueCustomerForCase,
  proposeRepairs,
  runRepairs
};
