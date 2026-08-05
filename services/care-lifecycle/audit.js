'use strict';

/**
 * Care audit — file store always; optional Notion when configured.
 * Never writes Case notification fields.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CARE_AUDIT_STATUS } = require('./events');
const { isCareAuditsDbConfigured, getCareAuditsDatabaseId } = require('./flags');

const DEFAULT_DIR = path.join(process.cwd(), 'tmp', 'care-lifecycle');

function createAuditId() {
  return `care_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function indexPath(dir) {
  return path.join(dir, 'idempotency-index.json');
}

function loadIndex(dir = DEFAULT_DIR) {
  ensureDir(dir);
  const p = indexPath(dir);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveIndex(index, dir = DEFAULT_DIR) {
  ensureDir(dir);
  fs.writeFileSync(indexPath(dir), JSON.stringify(index, null, 2), 'utf8');
}

function hasTerminalSend(idempotencyKey, dir = DEFAULT_DIR) {
  const key = String(idempotencyKey || '').trim();
  if (!key) return false;
  const row = loadIndex(dir)[key];
  if (!row) return false;
  return row.status === CARE_AUDIT_STATUS.SENT || row.status === CARE_AUDIT_STATUS.SENDING;
}

function createCareAuditEvent(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: partial.id || createAuditId(),
    caseId: partial.caseId || null,
    customerId: partial.customerId || null,
    eventType: partial.eventType || null,
    scheduledAt: partial.scheduledAt || null,
    triggerSource: partial.triggerSource || 'cli',
    destinationType: partial.destinationType || null,
    destinationIdHash: partial.destinationIdHash || '',
    status: partial.status || CARE_AUDIT_STATUS.PLANNED,
    idempotencyKey: partial.idempotencyKey || null,
    templateVersion: partial.templateVersion || null,
    createdAt: partial.createdAt || now,
    sentAt: partial.sentAt || null,
    failureReason: partial.failureReason || null,
    caseNotionId: partial.caseNotionId || null,
    reason: partial.reason || null,
    // M9.2 additive outcome fields (optional)
    deliveryStatus: partial.deliveryStatus != null ? partial.deliveryStatus : null,
    responseStatus: partial.responseStatus != null ? partial.responseStatus : null,
    rebookWithin30d: Boolean(partial.rebookWithin30d),
    utmSource: partial.utmSource || null,
    utmCampaign: partial.utmCampaign || null,
    careAuditIdFromUtm: partial.careAuditIdFromUtm || null,
    linkedCaseIdAfter: partial.linkedCaseIdAfter || null,
    outcomeAt: partial.outcomeAt || null,
    outcomeSource: partial.outcomeSource || null,
    observationWindowEndsAt: partial.observationWindowEndsAt || null,
    measuredAt: partial.measuredAt || null
  };
}

/**
 * Persist audit to file index + optional Notion (best-effort).
 */
async function recordCareAudit(event, options = {}) {
  const dir = options.dir || DEFAULT_DIR;
  const audit = createCareAuditEvent(event);
  ensureDir(dir);

  const index = loadIndex(dir);
  if (audit.idempotencyKey) {
    index[audit.idempotencyKey] = {
      id: audit.id,
      status: audit.status,
      updatedAt: new Date().toISOString(),
      caseNotionId: audit.caseNotionId || audit.caseId
    };
    saveIndex(index, dir);
  }

  const eventsPath = path.join(dir, 'events.jsonl');
  fs.appendFileSync(eventsPath, `${JSON.stringify(audit)}\n`, 'utf8');

  let notion = { attempted: false, ok: false, skipped: true };
  if (options.writeNotion !== false && isCareAuditsDbConfigured() && typeof options.notionCreate === 'function') {
    notion = { attempted: true, ok: false, skipped: false };
    try {
      await options.notionCreate(audit);
      notion.ok = true;
    } catch (error) {
      notion.error = error.message || String(error);
    }
  }

  return { audit, notion };
}

function writeRunReport(report, options = {}) {
  const dir = options.dir || DEFAULT_DIR;
  ensureDir(dir);
  const runId = report.runId || `care-${Date.now()}`;
  const fullPath = path.join(dir, `${runId}.json`);
  fs.writeFileSync(fullPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');
  return { runId, fullPath };
}

module.exports = {
  DEFAULT_DIR,
  createAuditId,
  createCareAuditEvent,
  loadIndex,
  hasTerminalSend,
  recordCareAudit,
  writeRunReport,
  getCareAuditsDatabaseId
};
