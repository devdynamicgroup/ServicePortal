#!/usr/bin/env node
'use strict';

/**
 * M9.5 — Read-only Care steady-state governance status.
 *
 * Never mutates flags, env, audits, or LINE. Never enables SEND.
 *
 * Usage:
 *   node scripts/check-care-steady-state.js
 *   node scripts/check-care-steady-state.js --dir=tmp/care-lifecycle
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
 * Pure steady-state governance summary — exported for fixture tests.
 */
function analyzeSteadyState(options = {}) {
  const flags = options.flags || {
    enabled: false,
    send: false,
    outcomeTracking: false,
    outcomeReport: false
  };
  const latest = options.latest || null;
  const outcome = options.outcome || null;
  const reminders = [];
  const warnings = [];

  reminders.push('Weekly classify: healthy | investigate | propose_change');
  reminders.push('CDR required for timing/copy/throttle/eligibility; Reviewer approve before apply');
  reminders.push('Same-lever CDR spacing prefer ≥7 days unless incident');
  reminders.push('M9.5 never enables CARE_LIFECYCLE_SEND');

  if (!latest) {
    warnings.push('missing_latest_run');
  }
  if (!outcome) {
    warnings.push('missing_outcome_report — optional; run-care-outcome-report.js');
  }

  const sent = countFromLatest(latest, 'sent');
  const failed = countFromLatest(latest, 'failed');
  const failDenom = sent + failed;
  let failPauseHint = false;
  if (failDenom >= 5 && failed / failDenom >= 0.2) {
    failPauseHint = true;
    warnings.push('fail_pause_hint — pause SEND; see M9.5 incident ops');
  }

  if (flags.send && !flags.enabled) {
    warnings.push('SEND without ENABLED — misconfiguration');
  }

  let mode = 'pre_launch_or_off';
  if (flags.send && flags.enabled) mode = 'steady_or_ladder_send';
  else if (flags.enabled) mode = 'enabled_observe';

  const outcomeFlagNote = flags.send
    ? 'After uncapped: humans may enable CARE_OUTCOME_REPORT (optional TRACKING) — never auto'
    : 'Keep CARE_OUTCOME_* OFF until human post-launch decision';

  return {
    readOnly: true,
    note: 'Governance status only. Does not set flags, send LINE, create CDRs, or apply policy.',
    package: 'M9.5',
    mode,
    locks: {
      cdrWeeklyClassify: true,
      cdrMonthlyFollowUp: true,
      sameLeverMinDays: 7,
      neverAutoEnableSend: true,
      neverAutoEnableOutcomeFlags: true,
      handbookNotRuntimeControls: true
    },
    flags: {
      CARE_LIFECYCLE_ENABLED: Boolean(flags.enabled),
      CARE_LIFECYCLE_SEND: Boolean(flags.send),
      CARE_OUTCOME_TRACKING: Boolean(flags.outcomeTracking),
      CARE_OUTCOME_REPORT: Boolean(flags.outcomeReport)
    },
    outcomeFlagNote,
    failPauseHint,
    latest: latest
      ? { mode: latest.mode || null, sent, failed, skipped: countFromLatest(latest, 'skipped') }
      : null,
    warningCount: warnings.length,
    warnings,
    reminders,
    docs: {
      handbook: 'docs/M9.5_CARE_STEADY_STATE_HANDBOOK.md',
      metrics: 'docs/M9.5_CARE_METRICS_OWNERSHIP.md',
      cdrOps: 'docs/M9.5_CARE_CDR_OPERATIONS.md',
      incidents: 'docs/M9.5_CARE_INCIDENT_OPERATIONS.md'
    }
  };
}

function main() {
  const { dir } = parseArgs(process.argv.slice(2));
  const flags = getCareLifecycleFlags();
  const latest = readJson(path.join(dir, 'latest.json'));
  const outcome = readJson(path.join(dir, 'latest-outcome-report.json'));

  const payload = {
    ...analyzeSteadyState({ flags, latest, outcome }),
    dir
  };

  console.log(JSON.stringify(payload, null, 2));
  process.exitCode = flags.send && !flags.enabled ? 2 : 0;
}

if (require.main === module) {
  main();
}

module.exports = {
  analyzeSteadyState
};
