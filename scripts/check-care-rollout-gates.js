#!/usr/bin/env node
'use strict';

/**
 * M9.1 — Read-only Care rollout gate summary.
 *
 * Does NOT enable flags, send LINE, or mutate Care eligibility.
 *
 * Usage:
 *   node scripts/check-care-rollout-gates.js
 *   node scripts/check-care-rollout-gates.js --dir=tmp/care-lifecycle
 *
 * Exit:
 *   0 — normal
 *   2 — SEND on but no latest report (or SEND without ENABLED)
 */

require('../config/env');

const fs = require('fs');
const path = require('path');
const {
  getCareLifecycleFlags,
  DEFAULT_DIR
} = require('../services/care-lifecycle');

function parseArgs(argv) {
  let dir = DEFAULT_DIR;
  for (const arg of argv) {
    if (arg.startsWith('--dir=')) dir = path.resolve(arg.slice('--dir='.length));
  }
  return { dir };
}

function inferredPhase(flags, latest) {
  if (flags.send && flags.enabled) {
    return 'phase_3_send_or_steady';
  }
  if (flags.enabled && !flags.send) {
    if (latest && latest.mode === 'dry-run') return 'phase_2_dry_run';
    return 'phase_1_enabled';
  }
  return 'phase_0_care_off';
}

function readLatest(dir) {
  const latestPath = path.join(dir, 'latest.json');
  if (!fs.existsSync(latestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const { dir } = parseArgs(process.argv.slice(2));
  const flags = getCareLifecycleFlags();
  const latest = readLatest(dir);
  const warnings = [];

  if (flags.send && !flags.enabled) {
    warnings.push('CARE_LIFECYCLE_SEND without ENABLED');
  }
  if (flags.send && !latest) {
    warnings.push('SEND on but no latest care report — run dry-run/send and archive');
  }
  if (!latest) {
    warnings.push('no_latest_care_report — run: node scripts/run-care-lifecycle.js scan --mode=dry-run');
  }

  const payload = {
    readOnly: true,
    note: 'This script never sets CARE_LIFECYCLE_* flags and never sends LINE',
    inferredPhase: inferredPhase(flags, latest),
    flags: {
      CARE_LIFECYCLE_ENABLED: flags.enabled,
      CARE_LIFECYCLE_SEND: flags.send
    },
    rolloutOrder: [
      'CARE OFF',
      'CARE_LIFECYCLE_ENABLED=true',
      'dry-run ≥7 days + ≥3 scans',
      'CARE_LIFECYCLE_SEND=true',
      '--limit=10',
      '--limit=50',
      'uncapped'
    ],
    locks: {
      dryRunMinDays: 7,
      dryRunMinScans: 3,
      dryRunLowVolumeMinDays: 14,
      sendLimitLadder: [10, 50, 'uncapped'],
      neverSkipDryRun: true
    },
    latestReport: latest
      ? {
        runId: latest.runId,
        mode: latest.mode,
        eventType: latest.eventType,
        finishedAt: latest.finishedAt,
        counts: latest.counts,
        pathHint: path.join(dir, 'latest.json')
      }
      : null,
    warnings
  };

  console.log(JSON.stringify(payload, null, 2));

  if ((flags.send && !flags.enabled) || (flags.send && !latest)) {
    process.exitCode = 2;
  }
}

main();
