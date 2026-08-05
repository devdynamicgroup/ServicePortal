#!/usr/bin/env node
'use strict';

/**
 * M9.2 Care outcome report (read-only).
 *
 * Usage:
 *   node scripts/run-care-outcome-report.js
 *   node scripts/run-care-outcome-report.js --dir=tmp/care-lifecycle
 *   node scripts/run-care-outcome-report.js --with-cases
 *
 * Does not enable CARE_LIFECYCLE_SEND or send LINE.
 */

require('../config/env');

const {
  buildCareOutcomeReport,
  writeOutcomeReport,
  getCareLifecycleFlags,
  DEFAULT_DIR
} = require('../services/care-lifecycle');

function parseArgs(argv) {
  const out = { dir: DEFAULT_DIR, withCases: false };
  for (const arg of argv) {
    if (arg.startsWith('--dir=')) out.dir = arg.slice('--dir='.length);
    else if (arg === '--with-cases') out.withCases = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const flags = getCareLifecycleFlags();

  let jobs = [];
  if (args.withCases) {
    const { getAllClients } = require('../services/notion/clients');
    jobs = await getAllClients();
  }

  const report = buildCareOutcomeReport({
    dir: args.dir,
    jobs
  });

  const paths = writeOutcomeReport(report, { dir: args.dir });

  console.log(JSON.stringify({
    ...report,
    paths,
    flags: {
      CARE_LIFECYCLE_ENABLED: flags.enabled,
      CARE_LIFECYCLE_SEND: flags.send,
      CARE_OUTCOME_TRACKING: flags.outcomeTracking,
      CARE_OUTCOME_REPORT: flags.outcomeReport
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
