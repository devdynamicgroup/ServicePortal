#!/usr/bin/env node
'use strict';

/**
 * M8.7 Customer identity reconcile CLI (offline).
 *
 * Usage:
 *   node scripts/run-customer-reconcile.js scan
 *   node scripts/run-customer-reconcile.js scan --limit=50
 *   node scripts/run-customer-reconcile.js repair --action=link_missing
 *   node scripts/run-customer-reconcile.js repair --action=link_missing --mode=write
 *   node scripts/run-customer-reconcile.js repair --action=fill_case_line_from_customer --mode=dry-run
 *   node scripts/run-customer-reconcile.js status
 *
 * Default repair mode is dry-run. Does not enable feature flags.
 */

require('../config/env');

const {
  runReconcileScan,
  runReconcileRepair,
  getReconcileStatus,
  ALLOWED_ACTIONS
} = require('../services/migration/customer-reconcile');

function parseArgs(argv) {
  const out = {
    command: argv[0] || 'status',
    mode: 'dry-run',
    action: null,
    limit: null,
    reportDir: null
  };
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--mode=')) out.mode = arg.slice('--mode='.length);
    else if (arg.startsWith('--action=')) out.action = arg.slice('--action='.length);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--report-dir=')) out.reportDir = arg.slice('--report-dir='.length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.reportDir || undefined;

  if (args.command === 'status') {
    console.log(JSON.stringify(getReconcileStatus({ dir }), null, 2));
    return;
  }

  if (args.command === 'scan') {
    const result = await runReconcileScan({
      limit: args.limit,
      dir
    });
    console.log(JSON.stringify({
      runId: result.runId,
      mode: result.mode,
      counts: result.counts,
      counters: result.counters,
      gateResult: result.gateResult,
      paths: result.paths,
      flagsSnapshot: result.flagsSnapshot
    }, null, 2));
    if (!result.gateResult.passed) process.exitCode = 2;
    return;
  }

  if (args.command === 'repair') {
    if (!args.action || !ALLOWED_ACTIONS.includes(args.action)) {
      console.error(`--action= required. Allowed: ${ALLOWED_ACTIONS.join(', ')}`);
      process.exit(1);
    }
    const dryRun = args.mode !== 'write';
    const result = await runReconcileRepair(args.action, {
      dryRun,
      limit: args.limit,
      dir
    });
    console.log(JSON.stringify({
      runId: result.runId,
      mode: result.mode,
      action: result.action,
      repairsProposed: result.repairsProposed,
      repairsApplied: result.repairsApplied,
      repairErrors: result.repairErrors,
      skipped: result.skipped,
      gateResult: result.gateResult,
      paths: result.paths,
      flagsSnapshot: result.flagsSnapshot
    }, null, 2));
    if (result.repairErrors) process.exitCode = 1;
    return;
  }

  console.error('Usage: node scripts/run-customer-reconcile.js <scan|repair|status> [options]');
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
