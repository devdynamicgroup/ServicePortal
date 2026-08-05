#!/usr/bin/env node
'use strict';

/**
 * M8.2 Customer Backfill CLI (offline only).
 *
 * Usage:
 *   node scripts/run-customer-backfill.js --mode=dry-run
 *   node scripts/run-customer-backfill.js --mode=dry-run --ensure-schema
 *   node scripts/run-customer-backfill.js --mode=write --ensure-schema
 *   node scripts/run-customer-backfill.js --mode=write --resume=tmp/customer-backfill/<runId>.checkpoint.json
 *   node scripts/run-customer-backfill.js --rollback --report=tmp/customer-backfill/<runId>.write.json
 *
 * Feature flags must remain OFF. Does not change production request paths.
 */

require('../config/env');

const {
  runCustomerBackfill,
  rollbackCustomerBackfill,
  verifySchemaReadiness
} = require('../services/migration/customer-backfill');

function parseArgs(argv) {
  const out = {
    mode: 'dry-run',
    ensureSchema: false,
    limit: null,
    resumeFrom: null,
    reportDir: null,
    batchSize: 25,
    rollback: false,
    report: null,
    archiveCustomers: false,
    schemaOnly: false
  };

  for (const arg of argv) {
    if (arg === '--ensure-schema') out.ensureSchema = true;
    else if (arg === '--rollback') out.rollback = true;
    else if (arg === '--archive-customers') out.archiveCustomers = true;
    else if (arg === '--schema-only') out.schemaOnly = true;
    else if (arg.startsWith('--mode=')) out.mode = arg.slice('--mode='.length);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--resume=')) out.resumeFrom = arg.slice('--resume='.length);
    else if (arg.startsWith('--report-dir=')) out.reportDir = arg.slice('--report-dir='.length);
    else if (arg.startsWith('--batch-size=')) out.batchSize = Number(arg.slice('--batch-size='.length));
    else if (arg.startsWith('--report=')) out.report = arg.slice('--report='.length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.schemaOnly) {
    if (args.ensureSchema) {
      const { ensureCaseCustomerLinkProps } = require('../services/migration/customer-backfill');
      const { ensureCustomersSchema, isCustomersDbConfigured } = require('../services/customer-domain');
      if (isCustomersDbConfigured()) {
        console.log(JSON.stringify(await ensureCustomersSchema(), null, 2));
      }
      console.log(JSON.stringify(await ensureCaseCustomerLinkProps(), null, 2));
    }
    console.log(JSON.stringify(await verifySchemaReadiness(), null, 2));
    return;
  }

  if (args.rollback) {
    if (!args.report) {
      console.error('--report=<path-to-write-report.json> is required for rollback');
      process.exit(1);
    }
    const result = await rollbackCustomerBackfill({
      reportPath: args.report,
      clearCaseLinks: true,
      archiveCustomers: args.archiveCustomers
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const report = await runCustomerBackfill({
    mode: args.mode,
    ensureSchema: args.ensureSchema,
    limit: args.limit,
    resumeFrom: args.resumeFrom,
    reportDir: args.reportDir || undefined,
    batchSize: args.batchSize
  });

  const summary = {
    runId: report.runId,
    mode: report.mode,
    reportPath: report.reportPath,
    schemaOk: report.schema?.ok,
    casesScanned: report.casesScanned,
    casesEligible: report.casesEligible,
    casesSkippedNoIdentity: report.casesSkippedNoIdentity,
    casesAlreadyLinked: report.casesAlreadyLinked,
    casesLinked: report.casesLinked,
    customersCreated: report.customersCreated,
    customersMatched: report.customersMatched,
    customersUnverifiedCreated: report.customersUnverifiedCreated,
    duplicateCandidates: report.duplicateCandidates,
    conflicts: report.conflicts,
    ambiguousMatches: report.ambiguousMatches,
    errors: report.errors,
    flagsSnapshot: report.flagsSnapshot
  };

  console.log(JSON.stringify(summary, null, 2));
  if (report.errors > 0 && args.mode === 'write') process.exitCode = 2;
}

main().catch(error => {
  console.error(error && error.details ? JSON.stringify({ message: error.message, details: error.details }, null, 2) : (error.body || error.message || error));
  process.exit(1);
});
