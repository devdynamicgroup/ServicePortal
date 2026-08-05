#!/usr/bin/env node
'use strict';

/**
 * M9.3 — Read-only Care pattern scanner (advisory).
 *
 * Inputs: tmp/care-lifecycle/latest.json + latest-outcome-report.json
 * Output: warnings only
 *
 * Never: set env, send LINE, rewrite audits, create CDRs, enable SEND.
 *
 * Usage:
 *   node scripts/check-care-patterns.js
 *   node scripts/check-care-patterns.js --dir=tmp/care-lifecycle
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

/**
 * Pure advisory checks — exported for fixture tests.
 */
function analyzeCarePatterns(options = {}) {
  const latest = options.latest || null;
  const outcome = options.outcome || null;
  const prior = options.prior || null;
  const warnings = [];

  if (!latest) {
    warnings.push({
      code: 'missing_latest_run',
      message: 'No latest.json — run care dry-run scan to archive'
    });
  }

  if (!outcome) {
    warnings.push({
      code: 'missing_outcome_report',
      message: 'No latest-outcome-report.json — run: node scripts/run-care-outcome-report.js'
    });
  }

  if (latest) {
    const sent = num(latest.sent ?? latest.counts?.sent);
    const failed = num(latest.failed ?? latest.counts?.failed);
    const skipped = num(latest.skipped ?? latest.counts?.skipped);
    const dryRun = num(latest.dryRun ?? latest.counts?.dryRun ?? latest.dry_run);
    const total = sent + failed + skipped + dryRun
      || num(latest.total)
      || num(latest.eligible)
      || 0;

    const failDenom = sent + failed;
    if (failDenom >= 5 && failed / failDenom >= 0.2) {
      warnings.push({
        code: 'high_failed_share',
        message: `failed share ${(failed / failDenom).toFixed(2)} (failed=${failed}, sent=${sent})`,
        hint: 'Check LINE / template; pause SEND if live (M9.1 rollback)'
      });
    }

    if (total >= 10 && skipped / total >= 0.8) {
      warnings.push({
        code: 'high_skip_share',
        message: `skipped share ${(skipped / total).toFixed(2)} (skipped=${skipped}, total=${total})`,
        hint: 'Review eligibility / LINE coverage / consent samples'
      });
    }

    const volume = dryRun || num(latest.eligible) || total;
    if (prior) {
      const priorVolume = num(prior.dryRun ?? prior.counts?.dryRun ?? prior.eligible ?? prior.total);
      if (priorVolume >= 5 && volume >= priorVolume * 2) {
        warnings.push({
          code: 'volume_jump',
          message: `volume ${volume} is ≥2× prior ${priorVolume}`,
          hint: 'Hold SEND; sample Case anchors before any policy change'
        });
      }
    }
  }

  if (outcome && outcome.delivery) {
    const d = outcome.delivery;
    const sent = num(d.sent);
    const failed = num(d.failed);
    const failDenom = sent + failed;
    if (failDenom >= 5 && failed / failDenom >= 0.2) {
      warnings.push({
        code: 'outcome_high_failed_share',
        message: `outcome delivery failed share ${(failed / failDenom).toFixed(2)}`,
        hint: 'Correlate with Care Audit failed rows'
      });
    }
  }

  return {
    readOnly: true,
    note: 'Advisory only. Does not create CDRs, mutate policy, send LINE, or enable CARE_SEND.',
    warningCount: warnings.length,
    warnings
  };
}

function main() {
  const { dir } = parseArgs(process.argv.slice(2));
  const flags = getCareLifecycleFlags();
  const latest = readJson(path.join(dir, 'latest.json'));
  const outcome = readJson(path.join(dir, 'latest-outcome-report.json'));
  // Optional prior archive if ops dropped one beside latest
  const prior = readJson(path.join(dir, 'prior.json'));

  const analysis = analyzeCarePatterns({ latest, outcome, prior });

  const payload = {
    ...analysis,
    dir,
    flags: {
      CARE_LIFECYCLE_ENABLED: flags.enabled,
      CARE_LIFECYCLE_SEND: flags.send,
      CARE_OUTCOME_TRACKING: flags.outcomeTracking,
      CARE_OUTCOME_REPORT: flags.outcomeReport
    },
    inputs: {
      latest: Boolean(latest),
      outcomeReport: Boolean(outcome),
      prior: Boolean(prior)
    },
    governance: {
      cdrDoc: 'docs/M9.3_CARE_DECISION_RECORDS.md',
      reviewRunbook: 'docs/M9.3_POLICY_REVIEW_RUNBOOK.md',
      effectiveness: 'docs/M9.3_EFFECTIVENESS_GOVERNANCE.md'
    }
  };

  console.log(JSON.stringify(payload, null, 2));
  // Always exit 0 — advisory; ops decide. Exit 0 even with warnings.
  process.exitCode = 0;
}

if (require.main === module) {
  main();
}

module.exports = {
  analyzeCarePatterns
};
