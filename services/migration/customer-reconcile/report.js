'use strict';

/**
 * M8.7 — reconciliation report writer + gate evaluation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getCustomerDomainFlags } = require('../../customer-domain/flags');

const DEFAULT_DIR = path.join(process.cwd(), 'tmp', 'customer-reconcile');

const DEFAULT_GATES = Object.freeze({
  orphanCustomerLinkMax: 0,
  lineDivergeMax: 0,
  missingCustomerLinkAmongLineLinkedMaxRate: 0.02
});

function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `rc-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

function flagsSnapshot() {
  const flags = getCustomerDomainFlags();
  return {
    CUSTOMER_DOMAIN_ENABLED: flags.enabled,
    CUSTOMER_DOMAIN_DUAL_WRITE: flags.dualWrite,
    CUSTOMER_DOMAIN_READ_LINE: flags.readLine,
    CUSTOMER_DOMAIN_READ_LINE_SHADOW: flags.readLineShadow,
    CUSTOMER_DOMAIN_READ_NOTIFY: flags.readNotify,
    CUSTOMER_DOMAIN_READ_NOTIFY_SHADOW: flags.readNotifyShadow,
    CUSTOMER_DOMAIN_MERGE_ENABLED: flags.mergeEnabled
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function redact(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function toPublicFinding(finding) {
  const out = { type: finding.type };
  if (finding.caseNotionId) out.caseNotionId = finding.caseNotionId;
  if (finding.customerId) out.customerId = finding.customerId;
  if (finding.caseLine) out.caseLineRedacted = redact(finding.caseLine);
  if (finding.customerLine) out.customerLineRedacted = redact(finding.customerLine);
  if (finding.lineUserId) out.lineUserIdRedacted = redact(finding.lineUserId);
  if (finding.reason) out.reason = finding.reason;
  return out;
}

/**
 * @param {{ counters: object, casesWithLine: number }} input
 * @param {object} [gateConfig]
 */
function evaluateGates(input = {}, gateConfig = DEFAULT_GATES) {
  const counters = input.counters || {};
  const casesWithLine = Number(input.casesWithLine) || 0;
  const missing = Number(counters.missingCustomerLink) || 0;
  const missingRate = casesWithLine > 0 ? missing / casesWithLine : 0;

  const failures = [];
  if ((counters.orphanCustomerLink || 0) > gateConfig.orphanCustomerLinkMax) {
    failures.push('orphanCustomerLinkMax');
  }
  if ((counters.lineDiverge || 0) > gateConfig.lineDivergeMax) {
    failures.push('lineDivergeMax');
  }
  if (missingRate > gateConfig.missingCustomerLinkAmongLineLinkedMaxRate) {
    failures.push('missingCustomerLinkAmongLineLinkedMaxRate');
  }

  return {
    gates: { ...gateConfig },
    metrics: {
      orphanCustomerLink: counters.orphanCustomerLink || 0,
      lineDiverge: counters.lineDiverge || 0,
      missingCustomerLink: missing,
      casesWithLine,
      missingCustomerLinkAmongLineLinkedRate: Number(missingRate.toFixed(4))
    },
    passed: failures.length === 0,
    failures
  };
}

function writeReconcileReport(report, options = {}) {
  const dir = options.dir || DEFAULT_DIR;
  ensureDir(dir);
  const runId = report.runId || createRunId();
  const fullPath = path.join(dir, `reconcile-${runId}.json`);
  const summaryPath = path.join(dir, `reconcile-${runId}.summary.json`);
  const latestPath = path.join(dir, 'latest.summary.json');

  const full = { ...report, runId };
  const summary = {
    runId,
    mode: report.mode,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    flagsSnapshot: report.flagsSnapshot,
    counts: report.counts,
    counters: report.counters,
    gateResult: report.gateResult,
    repairsProposed: report.repairsProposed || 0,
    repairsApplied: report.repairsApplied || 0,
    repairErrors: report.repairErrors || 0,
    findingSamples: (report.findings || []).slice(0, 25).map(toPublicFinding)
  };

  fs.writeFileSync(fullPath, JSON.stringify(full, null, 2), 'utf8');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2), 'utf8');

  return { runId, fullPath, summaryPath, latestPath, summary };
}

function readLatestSummary(dir = DEFAULT_DIR) {
  const latestPath = path.join(dir, 'latest.summary.json');
  if (!fs.existsSync(latestPath)) return null;
  return JSON.parse(fs.readFileSync(latestPath, 'utf8'));
}

module.exports = {
  DEFAULT_DIR,
  DEFAULT_GATES,
  createRunId,
  flagsSnapshot,
  evaluateGates,
  writeReconcileReport,
  readLatestSummary,
  toPublicFinding,
  redact
};
