'use strict';

/**
 * M8.2 Customer Backfill — offline migration only.
 * Does not enable feature flags or change production request paths.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { getAllClients, updateClient, getCaseFlowDatasetStatus } = require('../notion/clients');
const { getDataSourceSchema } = require('../notion/client');
const { findPropertyKey } = require('../notion/props');
const { FIELD_ALIASES } = require('../notion/mapper');
const {
  getCustomerDomainFlags,
  isCustomersDbConfigured,
  repository,
  normalizePhone,
  normalizeEmail,
  createCustomerId,
  CUSTOMER_STATUS,
  ensureCustomersSchema,
  getCustomerSchemaStatus
} = require('../customer-domain');

const FINGERPRINT_PREFIX = 'backfill:v1';
const DEFAULT_REPORT_DIR = path.join(process.cwd(), 'tmp', 'customer-backfill');

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `bf-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function flagsSnapshot() {
  const flags = getCustomerDomainFlags();
  return {
    CUSTOMER_DOMAIN_ENABLED: flags.enabled,
    CUSTOMER_DOMAIN_DUAL_WRITE: flags.dualWrite,
    CUSTOMER_DOMAIN_READ_LINE: flags.readLine,
    CUSTOMER_DOMAIN_READ_NOTIFY: flags.readNotify
  };
}

function assertFlagsOff() {
  const snap = flagsSnapshot();
  const on = Object.entries(snap).filter(([, v]) => v === true).map(([k]) => k);
  if (on.length) {
    const error = new Error(`Customer Domain flags must be OFF during M8.2 backfill: ${on.join(', ')}`);
    error.code = 'customer_domain_flags_on';
    throw error;
  }
  return snap;
}

function extractIdentity(job) {
  const fields = job?.draft?.fields || {};
  const fname = String(fields['ci-fname'] || '').trim();
  const lname = String(fields['ci-lname'] || '').trim();
  const displayName = [fname, lname].filter(Boolean).join(' ').trim()
    || String(job?.name || '').trim();
  const rawPhone = String(fields['ci-phone'] || '').trim();
  const rawEmail = String(fields['ci-email'] || '').trim();
  const rawAddr = String(fields['ci-addr'] || '').trim();
  const address = rawAddr && rawAddr !== 'Address to confirm' ? rawAddr : '';

  const phone = normalizePhone(rawPhone);
  const email = normalizeEmail(rawEmail);
  const lineUserId = String(job?.line?.userId || '').trim();
  const lineDisplayName = String(job?.line?.displayName || '').trim();
  const lineId = String(fields['ci-line'] || '').trim();
  const linkedCustomerId = String(job?.customer?.id || '').trim();
  const linkedCustomerPageId = String(job?.customer?.pageId || '').trim();

  const hasStrong = Boolean(lineUserId || phone || email);
  const hasName = Boolean(displayName);

  return {
    caseNotionId: job?.notionId || null,
    displayName,
    phone,
    email,
    primaryAddress: address,
    lineUserId,
    lineDisplayName,
    lineId,
    lineLinked: Boolean(job?.line?.linked),
    lineLinkedAt: job?.line?.linkedAt || null,
    linkedCustomerId,
    linkedCustomerPageId,
    hasStrong,
    hasName,
    eligible: hasStrong || hasName
  };
}

function buildFingerprint(identity) {
  if (identity.lineUserId) return `${FINGERPRINT_PREFIX}|key:line:${identity.lineUserId}`;
  if (identity.phone) return `${FINGERPRINT_PREFIX}|key:phone:${identity.phone}`;
  if (identity.email) return `${FINGERPRINT_PREFIX}|key:email:${identity.email}`;
  return `${FINGERPRINT_PREFIX}|case:${identity.caseNotionId}`;
}

function emptyReport(meta) {
  return {
    ...meta,
    casesScanned: 0,
    casesEligible: 0,
    casesSkippedNoIdentity: 0,
    casesAlreadyLinked: 0,
    casesLinked: 0,
    customersCreated: 0,
    customersMatched: 0,
    customersUnverifiedCreated: 0,
    duplicateCandidates: 0,
    conflicts: 0,
    ambiguousMatches: 0,
    errors: 0,
    skipped: [],
    wouldCreate: [],
    created: [],
    wouldMatch: [],
    matched: [],
    duplicateCandidatesList: [],
    conflictsList: [],
    ambiguousMatchesList: [],
    errorsList: [],
    schema: null,
    checkpointPath: null,
    reportPath: null
  };
}

async function verifySchemaReadiness({ ensureCaseLinkProps = false } = {}) {
  const caseSchema = await getDataSourceSchema();
  const caseLink = {
    customerId: Boolean(findPropertyKey(caseSchema.properties, FIELD_ALIASES.customerId)),
    customerPageId: Boolean(findPropertyKey(caseSchema.properties, FIELD_ALIASES.customerPageId))
  };

  let customers = {
    configured: isCustomersDbConfigured(),
    ok: false,
    missingRequired: ['NOTION_CUSTOMERS_DATABASE_ID']
  };

  if (isCustomersDbConfigured()) {
    if (ensureCaseLinkProps) {
      // no-op here; case props ensured via sync script / ensureCaseCustomerLinkProps
    }
    const { properties } = await repository.getSchema();
    const status = getCustomerSchemaStatus(properties);
    customers = {
      configured: true,
      ok: status.ok,
      missingRequired: status.missingRequired
    };
  }

  return {
    ok: customers.configured && customers.ok && caseLink.customerId && caseLink.customerPageId,
    caseLink,
    customers,
    caseFlow: await getCaseFlowDatasetStatus().catch(() => null)
  };
}

async function ensureCaseCustomerLinkProps() {
  const { dataSourceId, properties } = await getDataSourceSchema();
  const defs = [
    { key: 'customerId', name: 'Customer ID', schema: { rich_text: {} } },
    { key: 'customerPageId', name: 'Customer Page ID', schema: { rich_text: {} } }
  ];
  const missing = defs.filter(def => !findPropertyKey(properties, FIELD_ALIASES[def.key] || [def.name]));
  if (!missing.length) {
    return { created: [], dataSourceId };
  }
  const notion = require('../notion/client').getNotionClient();
  await notion.dataSources.update({
    data_source_id: dataSourceId,
    properties: missing.reduce((acc, def) => {
      acc[def.name] = def.schema;
      return acc;
    }, {})
  });
  return { created: missing.map(d => d.name), dataSourceId };
}

function indexCustomers(customers) {
  const byId = new Map();
  const byLine = new Map();
  const byPhone = new Map();
  const byEmail = new Map();

  const add = (map, key, customer) => {
    if (!key) return;
    const list = map.get(key) || [];
    if (!list.find(c => c.customerId === customer.customerId)) list.push(customer);
    map.set(key, list);
  };

  for (const customer of customers) {
    if (!customer?.customerId) continue;
    byId.set(customer.customerId, customer);
    add(byLine, String(customer.lineUserId || '').trim(), customer);
    add(byPhone, normalizePhone(customer.phone), customer);
    add(byEmail, normalizeEmail(customer.email), customer);
  }

  return { byId, byLine, byPhone, byEmail };
}

function collectCandidates(identity, index) {
  const found = [];
  const pushAll = (list, via) => {
    for (const customer of list || []) {
      if (!found.find(item => item.customer.customerId === customer.customerId)) {
        found.push({ customer, via });
      }
    }
  };

  if (identity.lineUserId) pushAll(index.byLine.get(identity.lineUserId), 'line');
  if (identity.phone) pushAll(index.byPhone.get(identity.phone), 'phone');
  if (identity.email) pushAll(index.byEmail.get(identity.email), 'email');
  return found;
}

function detectLineConflict(identity, customer) {
  const existingLine = String(customer.lineUserId || '').trim();
  if (identity.lineUserId && existingLine && identity.lineUserId !== existingLine) {
    return {
      type: 'conflict_line_identity',
      caseNotionId: identity.caseNotionId,
      customerId: customer.customerId,
      caseLineUserId: identity.lineUserId,
      customerLineUserId: existingLine
    };
  }
  return null;
}

function detectFieldConflicts(identity, customer) {
  const out = [];
  const cPhone = normalizePhone(customer.phone);
  const cEmail = normalizeEmail(customer.email);
  if (identity.phone && cPhone && identity.phone === cPhone && identity.email && cEmail && identity.email !== cEmail) {
    out.push({
      type: 'conflict_email_divergent',
      caseNotionId: identity.caseNotionId,
      customerId: customer.customerId,
      phone: identity.phone,
      caseEmail: identity.email,
      customerEmail: cEmail
    });
  }
  if (identity.email && cEmail && identity.email === cEmail && identity.phone && cPhone && identity.phone !== cPhone) {
    out.push({
      type: 'conflict_phone_divergent',
      caseNotionId: identity.caseNotionId,
      customerId: customer.customerId,
      email: identity.email,
      casePhone: identity.phone,
      customerPhone: cPhone
    });
  }
  return out;
}

function planForCase(identity, index, report) {
  if (!identity.eligible) {
    report.casesSkippedNoIdentity += 1;
    report.skipped.push({
      caseNotionId: identity.caseNotionId,
      reason: 'no_identity'
    });
    return { action: 'skip' };
  }

  report.casesEligible += 1;

  if (identity.linkedCustomerId) {
    report.casesAlreadyLinked += 1;
    const existing = index.byId.get(identity.linkedCustomerId);
    if (!existing) {
      report.errors += 1;
      report.errorsList.push({
        caseNotionId: identity.caseNotionId,
        message: `Case linked to missing customerId ${identity.linkedCustomerId}`
      });
      return { action: 'error' };
    }
    return {
      action: 'already_linked',
      customerId: existing.customerId,
      notionPageId: existing.notionPageId
    };
  }

  // Name-only: never join; always provisional 1:1
  if (!identity.hasStrong) {
    return {
      action: 'create',
      unverified: true,
      projection: {
        displayName: identity.displayName,
        status: CUSTOMER_STATUS.UNVERIFIED,
        sourceFingerprint: buildFingerprint(identity),
        primaryAddress: identity.primaryAddress,
        lineId: identity.lineId,
        lineDisplayName: identity.lineDisplayName
      }
    };
  }

  const candidates = collectCandidates(identity, index);
  if (candidates.length > 1) {
    const unique = [...new Set(candidates.map(c => c.customer.customerId))];
    if (unique.length > 1) {
      report.ambiguousMatches += 1;
      report.ambiguousMatchesList.push({
        caseNotionId: identity.caseNotionId,
        customerIds: unique,
        vias: candidates.map(c => c.via)
      });
      // Also count duplicateCandidates when same key maps to multiple
      report.duplicateCandidates += 1;
      report.duplicateCandidatesList.push({
        caseNotionId: identity.caseNotionId,
        customerIds: unique
      });
      return { action: 'ambiguous' };
    }
  }

  if (candidates.length === 1 || (candidates.length > 1 && new Set(candidates.map(c => c.customer.customerId)).size === 1)) {
    const customer = candidates[0].customer;
    const lineConflict = detectLineConflict(identity, customer);
    if (lineConflict) {
      report.conflicts += 1;
      report.conflictsList.push(lineConflict);
      return { action: 'blocked_line_conflict', conflict: lineConflict };
    }
    const fieldConflicts = detectFieldConflicts(identity, customer);
    for (const conflict of fieldConflicts) {
      report.conflicts += 1;
      report.conflictsList.push(conflict);
    }
    return {
      action: 'match',
      customerId: customer.customerId,
      notionPageId: customer.notionPageId,
      conflicts: fieldConflicts
    };
  }

  // Check in-memory duplicate keys across existing index (same key → multiple customers)
  const dupChecks = [
    { key: 'line', value: identity.lineUserId, map: index.byLine },
    { key: 'phone', value: identity.phone, map: index.byPhone },
    { key: 'email', value: identity.email, map: index.byEmail }
  ];
  for (const check of dupChecks) {
    if (!check.value) continue;
    const list = check.map.get(check.value) || [];
    if (list.length > 1) {
      report.duplicateCandidates += 1;
      report.duplicateCandidatesList.push({
        caseNotionId: identity.caseNotionId,
        key: check.key,
        value: check.value,
        customerIds: list.map(c => c.customerId)
      });
      return { action: 'duplicate_blocked' };
    }
  }

  return {
    action: 'create',
    unverified: false,
    projection: {
      displayName: identity.displayName,
      phone: identity.phone,
      email: identity.email,
      primaryAddress: identity.primaryAddress,
      lineUserId: identity.lineUserId,
      lineDisplayName: identity.lineDisplayName,
      lineId: identity.lineId,
      lineLinked: identity.lineLinked,
      lineLinkedAt: identity.lineLinkedAt,
      status: CUSTOMER_STATUS.ACTIVE,
      sourceFingerprint: buildFingerprint(identity)
    }
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function loadCheckpoint(checkpointPath) {
  if (!checkpointPath || !fs.existsSync(checkpointPath)) {
    return { processedCaseIds: [], createdCustomerIds: [], linkedCaseIds: [] };
  }
  return JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
}

/**
 * @param {{ mode: 'dry-run'|'write', reportDir?: string, batchSize?: number, resumeFrom?: string, ensureSchema?: boolean, limit?: number }} options
 */
async function runCustomerBackfill(options = {}) {
  const mode = options.mode === 'write' ? 'write' : 'dry-run';
  const runId = options.runId || createRunId();
  const reportDir = options.reportDir || DEFAULT_REPORT_DIR;
  const batchSize = Math.max(1, Number(options.batchSize) || 25);
  const startedAt = new Date().toISOString();
  const flags = assertFlagsOff();

  const report = emptyReport({
    runId,
    mode,
    startedAt,
    finishedAt: null,
    operator: options.operator || process.env.USER || process.env.USERNAME || null,
    gitSha: process.env.RENDER_GIT_COMMIT || null,
    flagsSnapshot: flags
  });

  const checkpointPath = path.join(reportDir, `${runId}.checkpoint.json`);
  report.checkpointPath = checkpointPath;

  if (options.ensureSchema) {
    if (isCustomersDbConfigured()) await ensureCustomersSchema();
    await ensureCaseCustomerLinkProps();
  }

  const schema = await verifySchemaReadiness();
  report.schema = schema;

  if (mode === 'write' && !schema.ok) {
    const error = new Error('Schema not ready for write mode (Customers DB + Case Customer ID/Page ID required)');
    error.code = 'schema_not_ready';
    error.details = schema;
    throw error;
  }

  if (!isCustomersDbConfigured() && mode === 'write') {
    throw new Error('NOTION_CUSTOMERS_DATABASE_ID is required for write mode');
  }

  const checkpoint = loadCheckpoint(options.resumeFrom || (mode === 'write' ? checkpointPath : null));
  const processedSet = new Set(checkpoint.processedCaseIds || []);

  const jobs = await getAllClients();
  const limited = options.limit ? jobs.slice(0, Number(options.limit)) : jobs;
  report.casesScanned = limited.length;

  let existingCustomers = [];
  if (isCustomersDbConfigured()) {
    existingCustomers = await repository.listAllCustomers({ limit: 10000 });
  }
  const index = indexCustomers(existingCustomers);

  let batchCount = 0;

  for (const job of limited) {
    const identity = extractIdentity(job);
    if (processedSet.has(identity.caseNotionId) && mode === 'write') {
      continue;
    }

    try {
      const plan = planForCase(identity, index, report);

      if (plan.action === 'skip' || plan.action === 'error' || plan.action === 'ambiguous'
        || plan.action === 'blocked_line_conflict' || plan.action === 'duplicate_blocked'
        || plan.action === 'already_linked') {
        if (mode === 'write') {
          processedSet.add(identity.caseNotionId);
        }
        continue;
      }

      if (plan.action === 'match') {
        report.customersMatched += 1;
        const entry = {
          caseNotionId: identity.caseNotionId,
          customerId: plan.customerId,
          notionPageId: plan.notionPageId
        };
        if (mode === 'dry-run') {
          report.wouldMatch.push(entry);
          report.casesLinked += 1;
        } else {
          await updateClient(identity.caseNotionId, {
            customerId: plan.customerId,
            customerPageId: plan.notionPageId
          });
          report.matched.push(entry);
          report.casesLinked += 1;
          processedSet.add(identity.caseNotionId);
          checkpoint.linkedCaseIds.push(identity.caseNotionId);
        }
      }

      if (plan.action === 'create') {
        const projection = {
          ...plan.projection,
          customerId: createCustomerId()
        };
        if (mode === 'dry-run') {
          report.customersCreated += 1;
          if (plan.unverified) report.customersUnverifiedCreated += 1;
          report.wouldCreate.push({
            caseNotionId: identity.caseNotionId,
            ...projection
          });
          report.casesLinked += 1;
        } else {
          const created = await repository.create(projection);
          // Keep in-memory index for later cases in same run
          index.byId.set(created.customerId, created);
          if (created.lineUserId) {
            const list = index.byLine.get(created.lineUserId) || [];
            list.push(created);
            index.byLine.set(created.lineUserId, list);
          }
          if (created.phone) {
            const list = index.byPhone.get(normalizePhone(created.phone)) || [];
            list.push(created);
            index.byPhone.set(normalizePhone(created.phone), list);
          }
          if (created.email) {
            const list = index.byEmail.get(normalizeEmail(created.email)) || [];
            list.push(created);
            index.byEmail.set(normalizeEmail(created.email), list);
          }

          await updateClient(identity.caseNotionId, {
            customerId: created.customerId,
            customerPageId: created.notionPageId
          });

          report.customersCreated += 1;
          if (plan.unverified) report.customersUnverifiedCreated += 1;
          report.created.push({
            caseNotionId: identity.caseNotionId,
            customerId: created.customerId,
            notionPageId: created.notionPageId,
            sourceFingerprint: created.sourceFingerprint
          });
          report.casesLinked += 1;
          processedSet.add(identity.caseNotionId);
          checkpoint.createdCustomerIds.push(created.customerId);
          checkpoint.linkedCaseIds.push(identity.caseNotionId);
        }
      }

      if (mode === 'write') {
        batchCount += 1;
        if (batchCount % batchSize === 0) {
          checkpoint.processedCaseIds = [...processedSet];
          checkpoint.updatedAt = new Date().toISOString();
          writeJson(checkpointPath, checkpoint);
        }
      }
    } catch (error) {
      report.errors += 1;
      report.errorsList.push({
        caseNotionId: job?.notionId || null,
        message: error && error.message ? error.message : String(error)
      });
      if (mode === 'write') {
        checkpoint.processedCaseIds = [...processedSet];
        checkpoint.updatedAt = new Date().toISOString();
        writeJson(checkpointPath, checkpoint);
      }
    }
  }

  if (mode === 'write') {
    checkpoint.processedCaseIds = [...processedSet];
    checkpoint.updatedAt = new Date().toISOString();
    writeJson(checkpointPath, checkpoint);
  }

  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(reportDir, `${runId}.${mode}.json`);
  report.reportPath = reportPath;
  writeJson(reportPath, report);
  return report;
}

/**
 * Rollback helper: clear Case link fields and optionally archive backfill Customers.
 * Never touches Offer / Workflow / tokens / notifications.
 */
async function rollbackCustomerBackfill({ reportPath, clearCaseLinks = true, archiveCustomers = false } = {}) {
  assertFlagsOff();
  if (!reportPath || !fs.existsSync(reportPath)) {
    throw new Error('reportPath is required and must exist');
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const results = {
    clearedCases: [],
    archivedCustomers: [],
    errors: []
  };

  const created = report.created || [];
  if (clearCaseLinks) {
    for (const row of created) {
      try {
        // Clear only link fields via Notion rich_text empty
        const { getNotionClient } = require('../notion/client');
        const { properties: schema } = await getDataSourceSchema();
        const notion = getNotionClient();
        const props = {};
        const idKey = findPropertyKey(schema, FIELD_ALIASES.customerId);
        const pageKey = findPropertyKey(schema, FIELD_ALIASES.customerPageId);
        if (idKey) props[idKey] = { rich_text: [] };
        if (pageKey) props[pageKey] = { rich_text: [] };
        if (Object.keys(props).length && row.caseNotionId) {
          await notion.pages.update({ page_id: row.caseNotionId, properties: props });
          results.clearedCases.push(row.caseNotionId);
        }
      } catch (error) {
        results.errors.push({ caseNotionId: row.caseNotionId, message: error.message });
      }
    }
  }

  if (archiveCustomers) {
    const notion = require('../notion/client').getNotionClient();
    for (const row of created) {
      try {
        if (!row.notionPageId) continue;
        if (!String(row.sourceFingerprint || '').startsWith(FINGERPRINT_PREFIX)) continue;
        await notion.pages.update({ page_id: row.notionPageId, archived: true });
        results.archivedCustomers.push(row.customerId);
      } catch (error) {
        results.errors.push({ customerId: row.customerId, message: error.message });
      }
    }
  }

  return results;
}

module.exports = {
  FINGERPRINT_PREFIX,
  createRunId,
  flagsSnapshot,
  assertFlagsOff,
  extractIdentity,
  verifySchemaReadiness,
  ensureCaseCustomerLinkProps,
  runCustomerBackfill,
  rollbackCustomerBackfill
};
