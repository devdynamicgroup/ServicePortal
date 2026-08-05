#!/usr/bin/env node
'use strict';

/**
 * M8.8 — Read-only Customer rollout gate summary.
 *
 * Does NOT enable flags, write Notion, or mutate env.
 *
 * Usage:
 *   node scripts/check-customer-rollout-gates.js
 *   node scripts/check-customer-rollout-gates.js --report-dir=tmp/customer-reconcile
 *
 * Exit:
 *   0 — flags default-safe OR latest reconcile gateResult.passed
 *   2 — latest reconcile present and gateResult.passed === false
 *   0 with warning — no latest reconcile file (informational)
 */

require('../config/env');

const path = require('path');
const {
  getCustomerDomainFlags
} = require('../services/customer-domain');
const {
  flagsSnapshot,
  readLatestSummary,
  DEFAULT_DIR
} = require('../services/migration/customer-reconcile/report');

function parseArgs(argv) {
  let reportDir = DEFAULT_DIR;
  for (const arg of argv) {
    if (arg.startsWith('--report-dir=')) {
      reportDir = path.resolve(arg.slice('--report-dir='.length));
    }
  }
  return { reportDir };
}

function phaseHint(flags) {
  if (flags.readNotify) return 'phase_6_read_notify';
  if (flags.readNotifyShadow) return 'phase_5_read_notify_shadow';
  if (flags.readLine) return 'phase_4_read_line';
  if (flags.readLineShadow) return 'phase_3_read_line_shadow';
  if (flags.dualWrite) return 'phase_2_dual_write';
  if (flags.enabled) return 'phase_1_enabled';
  return 'phase_0_all_off';
}

function main() {
  const { reportDir } = parseArgs(process.argv.slice(2));
  const flags = getCustomerDomainFlags();
  const snap = flagsSnapshot();
  const latest = readLatestSummary(reportDir);

  const anyReadOn = Boolean(
    flags.readLine || flags.readLineShadow || flags.readNotify || flags.readNotifyShadow
  );

  const payload = {
    readOnly: true,
    note: 'This script never sets CUSTOMER_DOMAIN_* flags',
    inferredPhase: phaseHint(flags),
    flags: snap,
    phaseOrder: [
      'ENABLED',
      'DUAL_WRITE',
      'READ_LINE_SHADOW',
      'READ_LINE',
      'READ_NOTIFY_SHADOW',
      'READ_NOTIFY'
    ],
    locks: {
      phase4BeforePhase5: true,
      dualWriteProdSoakHours: 72,
      shadowMinHours: 48,
      lineShadowMinLookups: 200,
      notifyShadowMinResolves: 100,
      primarySoakHours: 72,
      missingLinkMaxRate: 0.02,
      unticketedLineDivergeBlocksPhase3: true
    },
    latestReconcile: latest
      ? {
        runId: latest.runId,
        mode: latest.mode,
        finishedAt: latest.finishedAt,
        counters: latest.counters,
        gateResult: latest.gateResult,
        pathHint: path.join(reportDir, 'latest.summary.json')
      }
      : null,
    warnings: []
  };

  if (!latest) {
    payload.warnings.push('no_latest_reconcile_summary — run: node scripts/run-customer-reconcile.js scan');
  }
  if (anyReadOn && !flags.enabled) {
    payload.warnings.push('read_flags_on_without_enabled');
  }
  if ((flags.readNotify || flags.readNotifyShadow) && !flags.readLine) {
    payload.warnings.push('notify_phase_without_READ_LINE — Phase 4 required before Phase 5/6 unless waiver');
  }

  console.log(JSON.stringify(payload, null, 2));

  if (latest && latest.gateResult && latest.gateResult.passed === false) {
    process.exitCode = 2;
  }
}

main();
