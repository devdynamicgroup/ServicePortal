'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DEFAULT_DIR } = require('./detector');

function auditsDir(dir = DEFAULT_DIR) {
  const p = path.join(dir, 'audits');
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function createAuditId() {
  return `aud_${crypto.randomBytes(8).toString('hex')}`;
}

function auditPath(auditId, dir = DEFAULT_DIR) {
  return path.join(auditsDir(dir), `${auditId}.json`);
}

function writeAudit(audit, dir = DEFAULT_DIR) {
  const file = auditPath(audit.auditId, dir);
  // Immutable: refuse overwrite of completed/rolled_back with different content except append-only status updates via updateAuditResult
  fs.writeFileSync(file, JSON.stringify(audit, null, 2), 'utf8');
  return file;
}

function readAudit(auditId, dir = DEFAULT_DIR) {
  const file = auditPath(auditId, dir);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createMergeAuditSkeleton({
  operatorId,
  reason,
  survivor,
  losers,
  identityDecisions = null
}) {
  return {
    auditId: createAuditId(),
    timestamp: new Date().toISOString(),
    operator: operatorId,
    reason: reason || '',
    survivor: {
      customerId: survivor.customerId,
      notionPageId: survivor.notionPageId,
      snapshot: { ...survivor }
    },
    losers: losers.map(l => ({
      customerId: l.customerId,
      notionPageId: l.notionPageId,
      snapshot: { ...l }
    })),
    beforeSnapshot: {
      survivor: { ...survivor },
      losers: losers.map(l => ({ ...l }))
    },
    identityDecisions: identityDecisions || null,
    affectedCases: [],
    result: 'pending',
    history: [{ at: new Date().toISOString(), result: 'pending' }]
  };
}

function updateAuditResult(auditId, patch = {}, dir = DEFAULT_DIR) {
  const audit = readAudit(auditId, dir);
  if (!audit) return null;
  if (patch.affectedCases) audit.affectedCases = patch.affectedCases;
  if (patch.result) {
    audit.result = patch.result;
    audit.history = audit.history || [];
    audit.history.push({ at: new Date().toISOString(), result: patch.result, note: patch.note || null });
  }
  if (patch.error) audit.error = patch.error;
  writeAudit(audit, dir);
  return audit;
}

module.exports = {
  createAuditId,
  createMergeAuditSkeleton,
  writeAudit,
  readAudit,
  updateAuditResult,
  auditPath,
  auditsDir
};
