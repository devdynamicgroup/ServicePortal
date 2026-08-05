#!/usr/bin/env node
'use strict';

/**
 * M9.4 — Read-only Care production readiness summary.
 *
 * Prints gate-oriented status for humans. Never mutates flags, env, audits, or LINE.
 *
 * Usage:
 *   node scripts/check-care-production-readiness.js
 *   node scripts/check-care-production-readiness.js --dir=tmp/care-lifecycle
 *
 * Exit:
 *   0 — always for advisory (humans decide GO/NO-GO)
 *   2 — only if SEND=true without ENABLED (misconfiguration)
 */

require('../config/env');

const fs = require('fs');
const path = require('path');
const {
  getCareLifecycleFlags,
  DEFAULT_DIR
} = require('../services/care-lifecycle');

const FAIL_PAUSE_RATE = 0.2;
const FAIL_PAUSE_MIN_N = 5;

function parseArgs(argv) {
  let dir = DEFAULT_DIR;
  for (const arg of argv) {
    if (arg.startsWith('--dir=')) dir = path.resolve(arg.slice('--dir='.length));
  }
  return { dir };
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function countFromLatest(latest, key) {
  if (!latest) return 0;
  if (latest.counts && latest.counts[key] != null) return num(latest.counts[key]);
  return num(latest[key]);
}

/**
 * Pure readiness analysis — exported for fixture tests.
 */
function analyzeProductionReadiness(options = {}) {
  const flags = options.flags || {
    enabled: false,
    send: false,
    outcomeTracking: false,
    outcomeReport: false
  };
  const latest = options.latest || null;
  const outcome = options.outcome || null;
  const warnings = [];
  const blockers = [];

  if (flags.send && !flags.enabled) {
    blockers.push('CARE_LIFECYCLE_SEND without CARE_LIFECYCLE_ENABLED');
  }
  if (!latest) {
    warnings.push('missing_latest_run — archive dry-run/send under tmp/care-lifecycle/latest.json');
  }
  if (!outcome) {
    warnings.push('missing_outcome_report — optional at launch; run: node scripts/run-care-outcome-report.js');
  }

  const sent = countFromLatest(latest, 'sent');
  const failed = countFromLatest(latest, 'failed');
  const failDenom = sent + failed;
  let failPauseTriggered = false;
  if (failDenom >= FAIL_PAUSE_MIN_N && failed / failDenom >= FAIL_PAUSE_RATE) {
    failPauseTriggered = true;
    warnings.push(
      `fail_pause_threshold — failed share ${(failed / failDenom).toFixed(2)} (n=${failDenom}); pause SEND / do not expand`
    );
  }

  if (flags.send && !latest) {
    blockers.push('SEND on but no latest care report');
  }

  let suggestedPhase = 'phase_0_care_off';
  if (flags.send && flags.enabled) suggestedPhase = 'phase_3_send_or_steady';
  else if (flags.enabled && !flags.send) {
    suggestedPhase = latest && latest.mode === 'dry-run' ? 'phase_2_dry_run' : 'phase_1_enabled';
  }

  return {
    readOnly: true,
    note: 'Advisory only. Never sets CARE flags, never sends LINE, never applies policy.',
    package: 'M9.4',
    suggestedPhase,
    locks: {
      observeAfterLimit10Hours: 24,
      observeAfterLimit50Hours: 48,
      observeAfterLimit50PreferHours: 72,
      failPauseRate: FAIL_PAUSE_RATE,
      failPauseMinN: FAIL_PAUSE_MIN_N,
      sendLimitLadder: [10, 50, 'uncapped'],
      outcomeFlagsAtLaunch: 'keep_off',
      checkpointA: ['Operator', 'Reviewer', 'On-call'],
      checkpointBC: ['Operator', 'Reviewer'],
      neverAutoSetSend: true
    },
    flags: {
      CARE_LIFECYCLE_ENABLED: Boolean(flags.enabled),
      CARE_LIFECYCLE_SEND: Boolean(flags.send),
      CARE_OUTCOME_TRACKING: Boolean(flags.outcomeTracking),
      CARE_OUTCOME_REPORT: Boolean(flags.outcomeReport)
    },
    latest: latest
      ? {
        runId: latest.runId || null,
        mode: latest.mode || null,
        sent,
        failed,
        skipped: countFromLatest(latest, 'skipped'),
        dryRun: countFromLatest(latest, 'dryRun') || countFromLatest(latest, 'dry_run')
      }
      : null,
    failPauseTriggered,
    warningCount: warnings.length,
    warnings,
    blockerCount: blockers.length,
    blockers,
    docs: {
      runbook: 'docs/M9.4_CARE_PRODUCTION_RUNBOOK.md',
      checklist: 'docs/M9.4_CARE_GO_NO_GO_CHECKLIST.md',
      firstSend: 'docs/M9.4_CARE_FIRST_SEND_PLAN.md',
      rollback: 'docs/M9.4_CARE_ROLLBACK_CARD.md'
    },
    humanNext: flags.send
      ? 'Follow first-send ladder / checkpoints B–C; rollback card if fail-pause'
      : 'Do not enable SEND until Checkpoint A signed on M9.4 go/no-go checklist'
  };
}

function main() {
  const { dir } = parseArgs(process.argv.slice(2));
  const flags = getCareLifecycleFlags();
  const latest = readJson(path.join(dir, 'latest.json'));
  const outcome = readJson(path.join(dir, 'latest-outcome-report.json'));

  const payload = {
    ...analyzeProductionReadiness({ flags, latest, outcome }),
    dir
  };

  console.log(JSON.stringify(payload, null, 2));

  if (flags.send && !flags.enabled) {
    process.exitCode = 2;
  } else {
    process.exitCode = 0;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  analyzeProductionReadiness,
  FAIL_PAUSE_RATE,
  FAIL_PAUSE_MIN_N
};
