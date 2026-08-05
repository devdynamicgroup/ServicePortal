'use strict';

/**
 * M8.7 — Customer identity reconcile orchestration (offline).
 * Does not enable flags or change runtime read/notify paths.
 */

const { getAllClients } = require('../../notion/clients');
const {
  repository,
  getCustomerDomainFlags,
  lineReadMetrics,
  notifyReadMetrics
} = require('../../customer-domain');
const { scanIdentityDrift } = require('./scanner');
const { runRepairs, ALLOWED_ACTIONS } = require('./repair');
const {
  DEFAULT_DIR,
  createRunId,
  flagsSnapshot,
  evaluateGates,
  writeReconcileReport,
  readLatestSummary
} = require('./report');

async function loadDatasets(options = {}) {
  if (options.jobs && options.customers) {
    return { jobs: options.jobs, customers: options.customers };
  }
  const jobs = options.jobs || await getAllClients();
  const customers = options.customers || await repository.listAllCustomers({
    limit: options.customerLimit || 10000
  });
  const limit = Number.isFinite(Number(options.limit)) ? Math.floor(Number(options.limit)) : null;
  return {
    jobs: limit ? jobs.slice(0, limit) : jobs,
    customers
  };
}

function countCasesWithLine(jobs) {
  return jobs.filter(j => String(j?.line?.userId || '').trim()).length;
}

async function runReconcileScan(options = {}) {
  const startedAt = new Date().toISOString();
  const runId = options.runId || createRunId();
  const { jobs, customers } = await loadDatasets(options);
  const scanned = scanIdentityDrift({ jobs, customers });
  const gateResult = evaluateGates({
    counters: scanned.counters,
    casesWithLine: countCasesWithLine(jobs)
  }, options.gates);

  const report = {
    runId,
    mode: 'scan',
    startedAt,
    finishedAt: new Date().toISOString(),
    flagsSnapshot: flagsSnapshot(),
    counts: {
      casesScanned: scanned.casesScanned,
      customersScanned: scanned.customersScanned,
      casesWithLine: countCasesWithLine(jobs)
    },
    counters: scanned.counters,
    findings: scanned.findings,
    gateResult,
    repairsProposed: 0,
    repairsApplied: 0,
    repairErrors: 0
  };

  const written = writeReconcileReport(report, { dir: options.dir || DEFAULT_DIR });
  return { ...report, paths: written };
}

async function runReconcileRepair(action, options = {}) {
  const dryRun = options.dryRun !== false;
  if (!ALLOWED_ACTIONS.includes(action)) {
    const error = new Error(`Unsupported repair action: ${action}. Allowed: ${ALLOWED_ACTIONS.join(', ')}`);
    error.code = 'unsupported_repair_action';
    throw error;
  }

  const startedAt = new Date().toISOString();
  const runId = options.runId || createRunId();
  const { jobs, customers } = await loadDatasets(options);

  let findings = options.findings;
  let counters = options.counters;
  if (!findings) {
    const scanned = scanIdentityDrift({ jobs, customers });
    findings = scanned.findings;
    counters = scanned.counters;
  }

  const repairResult = await runRepairs(action, {
    dryRun,
    findings,
    jobs,
    customers,
    deps: options.deps
  });

  const gateResult = evaluateGates({
    counters: counters || {},
    casesWithLine: countCasesWithLine(jobs)
  }, options.gates);

  const report = {
    runId,
    mode: dryRun ? 'repair-dry-run' : 'repair-write',
    action,
    startedAt,
    finishedAt: new Date().toISOString(),
    flagsSnapshot: flagsSnapshot(),
    counts: {
      casesScanned: jobs.length,
      customersScanned: customers.length,
      casesWithLine: countCasesWithLine(jobs)
    },
    counters: counters || {},
    findings,
    proposals: repairResult.proposals,
    gateResult,
    repairsProposed: repairResult.repairsProposed,
    repairsApplied: repairResult.repairsApplied,
    repairErrors: repairResult.repairErrors,
    skipped: repairResult.skipped
  };

  const written = writeReconcileReport(report, { dir: options.dir || DEFAULT_DIR });
  return { ...report, paths: written, repairResult };
}

function getReconcileStatus(options = {}) {
  const flags = getCustomerDomainFlags();
  return {
    flags: flagsSnapshot(),
    flagsRaw: {
      enabled: flags.enabled,
      dualWrite: flags.dualWrite,
      readLine: flags.readLine,
      readLineShadow: flags.readLineShadow,
      readNotify: flags.readNotify,
      readNotifyShadow: flags.readNotifyShadow,
      mergeEnabled: flags.mergeEnabled
    },
    lineReadMetrics: lineReadMetrics.getSnapshot(flags),
    notifyReadMetrics: notifyReadMetrics.getSnapshot(flags),
    latestReconcile: readLatestSummary(options.dir || DEFAULT_DIR),
    note: 'line/notify metrics are process-local and reset on restart'
  };
}

module.exports = {
  runReconcileScan,
  runReconcileRepair,
  getReconcileStatus,
  countCasesWithLine,
  ALLOWED_ACTIONS,
  DEFAULT_DIR
};
