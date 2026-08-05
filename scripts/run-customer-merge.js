#!/usr/bin/env node
'use strict';

/**
 * M8.4 Customer merge ops CLI
 *
 *   node scripts/run-customer-merge.js detect
 *   node scripts/run-customer-merge.js enqueue [--report=<detect.json>]
 *   node scripts/run-customer-merge.js merge --survivor=cust_x --losers=cust_a,cust_b --operator=ops --reason="..."
 *   node scripts/run-customer-merge.js rollback --audit=aud_xxx
 *   node scripts/run-customer-merge.js tickets [--status=open]
 */

require('../config/env');

const fs = require('fs');
const {
  detectDuplicateCustomers,
  enqueueFromDetectionReport,
  listTickets,
  executeManualMerge,
  rollbackManualMerge,
  readAudit
} = require('../services/customer-domain/merge');

function parseArgs(argv) {
  const out = { cmd: argv[0] || '', report: null, survivor: null, losers: null, operator: null, reason: null, audit: null, status: null, lineDecision: null };
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--report=')) out.report = arg.slice('--report='.length);
    else if (arg.startsWith('--survivor=')) out.survivor = arg.slice('--survivor='.length);
    else if (arg.startsWith('--losers=')) out.losers = arg.slice('--losers='.length);
    else if (arg.startsWith('--operator=')) out.operator = arg.slice('--operator='.length);
    else if (arg.startsWith('--reason=')) out.reason = arg.slice('--reason='.length);
    else if (arg.startsWith('--audit=')) out.audit = arg.slice('--audit='.length);
    else if (arg.startsWith('--status=')) out.status = arg.slice('--status='.length);
    else if (arg.startsWith('--line=')) out.lineDecision = arg.slice('--line='.length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.cmd === 'detect') {
    const report = await detectDuplicateCustomers();
    console.log(JSON.stringify({
      runId: report.runId,
      reportPath: report.reportPath,
      scannedCustomers: report.scannedCustomers,
      counters: report.counters,
      clusterCount: report.clusters.length
    }, null, 2));
    return;
  }

  if (args.cmd === 'enqueue') {
    let report;
    if (args.report) {
      report = JSON.parse(fs.readFileSync(args.report, 'utf8'));
    } else {
      report = await detectDuplicateCustomers();
    }
    const result = enqueueFromDetectionReport(report);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.cmd === 'tickets') {
    const tickets = listTickets(args.status ? { status: args.status } : {});
    console.log(JSON.stringify({ count: tickets.length, tickets }, null, 2));
    return;
  }

  if (args.cmd === 'merge') {
    const losers = String(args.losers || '').split(',').map(s => s.trim()).filter(Boolean);
    const payload = {
      survivorCustomerId: args.survivor,
      loserCustomerIds: losers,
      operatorId: args.operator,
      reason: args.reason
    };
    if (args.lineDecision) {
      payload.identityDecisions = { lineUserId: args.lineDecision };
    }
    const result = await executeManualMerge(payload);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.cmd === 'rollback') {
    if (!args.audit) {
      console.error('--audit=<auditId> required');
      process.exit(1);
    }
    const result = await rollbackManualMerge(args.audit);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.cmd === 'audit') {
    if (!args.audit) {
      console.error('--audit=<auditId> required');
      process.exit(1);
    }
    console.log(JSON.stringify(readAudit(args.audit), null, 2));
    return;
  }

  console.error(`Unknown or missing command. Use: detect | enqueue | tickets | merge | rollback | audit`);
  process.exit(1);
}

main().catch(error => {
  console.error(error.errors ? JSON.stringify({ message: error.message, errors: error.errors }, null, 2) : (error.message || error));
  process.exit(1);
});
