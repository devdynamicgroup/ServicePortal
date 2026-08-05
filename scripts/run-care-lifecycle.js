#!/usr/bin/env node
'use strict';

/**
 * M9.0 Care Lifecycle CLI
 *
 * Usage:
 *   node scripts/run-care-lifecycle.js scan --event=reinspection_6mo --mode=dry-run
 *   node scripts/run-care-lifecycle.js send --event=reinspection_6mo --mode=write
 *
 * SEND/write requires CARE_LIFECYCLE_ENABLED=true and CARE_LIFECYCLE_SEND=true.
 * Defaults are OFF. Does not modify Case notification state.
 */

require('../config/env');

const {
  runCareLifecycle,
  CARE_EVENT_TYPES,
  getCareLifecycleFlags
} = require('../services/care-lifecycle');

function parseArgs(argv) {
  const out = {
    command: argv[0] || 'scan',
    mode: 'dry-run',
    event: 'reinspection_6mo',
    limit: null,
    dir: null,
    allowDisabledDryRun: false
  };
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('--mode=')) out.mode = arg.slice('--mode='.length);
    else if (arg.startsWith('--event=')) out.event = arg.slice('--event='.length);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--dir=')) out.dir = arg.slice('--dir='.length);
    else if (arg === '--allow-disabled-dry-run') out.allowDisabledDryRun = true;
  }
  return out;
}

function resolveEventType(name) {
  if (name === 'reinspection_6mo' || name === CARE_EVENT_TYPES.REINSPECTION_6MO) {
    return CARE_EVENT_TYPES.REINSPECTION_6MO;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const eventType = resolveEventType(args.event);
  if (!eventType) {
    console.error(`Unsupported --event=${args.event}. Supported: reinspection_6mo`);
    process.exit(1);
  }

  const flags = getCareLifecycleFlags();
  const isSend = args.command === 'send' || args.mode === 'write';

  if (isSend && (!flags.enabled || !flags.send)) {
    console.error(JSON.stringify({
      ok: false,
      error: 'care_send_flags_off',
      message: 'Set CARE_LIFECYCLE_ENABLED=true and CARE_LIFECYCLE_SEND=true for send/write',
      flags
    }, null, 2));
    process.exit(1);
  }

  if (!isSend && !flags.enabled && !args.allowDisabledDryRun) {
    console.error(JSON.stringify({
      ok: false,
      error: 'care_enabled_off',
      message: 'Set CARE_LIFECYCLE_ENABLED=true for scan, or pass --allow-disabled-dry-run for local fixtures',
      flags
    }, null, 2));
    process.exit(1);
  }

  const result = await runCareLifecycle({
    mode: isSend ? 'write' : 'dry-run',
    eventType,
    limit: args.limit,
    dir: args.dir || undefined,
    allowDisabledDryRun: args.allowDisabledDryRun,
    requireEnabled: !args.allowDisabledDryRun
  });

  console.log(JSON.stringify({
    runId: result.runId,
    mode: result.mode,
    eventType: result.eventType,
    counts: result.counts,
    flags: result.flags,
    paths: result.paths
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
