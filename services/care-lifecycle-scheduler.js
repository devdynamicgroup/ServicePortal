'use strict';

/**
 * In-process Care Lifecycle scheduler (optional).
 *
 * Safety defaults — all OFF:
 *   CARE_LIFECYCLE_SCHEDULER_ENABLED=false
 *   CARE_LIFECYCLE_ENABLED=false
 *   CARE_LIFECYCLE_SEND=false
 *
 * Behavior when SCHEDULER + ENABLED are true:
 *   - SEND=false → periodic dry-run scan only (no LINE)
 *   - SEND=true  → periodic write/send (still gated by runCareLifecycle)
 *
 * Does not touch Booking, OCR, Case notificationStatus, or Customer Domain flags.
 */

const {
  getCareLifecycleFlags,
  parseBool,
  runCareLifecycle
} = require('./care-lifecycle');

let timer = null;
let running = false;
let lastRun = null;
let lastError = null;

function isSchedulerEnabled(env = process.env) {
  return parseBool(env.CARE_LIFECYCLE_SCHEDULER_ENABLED, false);
}

function getIntervalMs(env = process.env) {
  const hours = Number(env.CARE_LIFECYCLE_SCAN_INTERVAL_HOURS || 24);
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return Math.max(1, safeHours) * 60 * 60 * 1000;
}

function getScanLimit(env = process.env) {
  const raw = env.CARE_LIFECYCLE_SCAN_LIMIT;
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function getCareSchedulerStatus(env = process.env) {
  const flags = getCareLifecycleFlags();
  const schedulerEnabled = isSchedulerEnabled(env);
  const mode = flags.send ? 'write' : 'dry-run';
  return {
    schedulerEnabled,
    lifecycleEnabled: flags.enabled,
    send: flags.send,
    active: Boolean(timer),
    wouldRun: schedulerEnabled && flags.enabled,
    modeWhenActive: mode,
    intervalHours: Math.round(getIntervalMs(env) / (60 * 60 * 1000)),
    scanLimit: getScanLimit(env),
    runOnStart: parseBool(env.CARE_LIFECYCLE_SCHEDULER_RUN_ON_START, false),
    running,
    lastRun,
    lastError
  };
}

async function runCareLifecycleScheduled(reason = 'schedule', options = {}) {
  if (running) {
    console.log(`[care-lifecycle] scan skipped (${reason}): already running`);
    return null;
  }

  const flags = options.flags || getCareLifecycleFlags();
  if (!flags.enabled) {
    console.log(`[care-lifecycle] scan skipped (${reason}): CARE_LIFECYCLE_ENABLED=false`);
    return null;
  }

  const mode = flags.send ? 'write' : 'dry-run';
  running = true;
  lastError = null;
  try {
    const result = await runCareLifecycle({
      mode,
      limit: options.limit != null ? options.limit : getScanLimit(),
      triggerSource: 'scheduler',
      requireEnabled: true,
      flags,
      ...(options.runOptions || {})
    });
    lastRun = {
      reason,
      mode: result.mode,
      runId: result.runId,
      finishedAt: result.finishedAt,
      counts: result.counts
    };
    console.log(
      `[care-lifecycle] scan ${reason} mode=${result.mode}: ` +
        `scanned=${result.counts.casesScanned} dryRun=${result.counts.dryRun} ` +
        `skipped=${result.counts.skipped} sent=${result.counts.sent} failed=${result.counts.failed}`
    );
    return result;
  } catch (error) {
    lastError = {
      reason,
      message: error && error.message ? error.message : String(error),
      code: error && error.code ? error.code : null,
      at: new Date().toISOString()
    };
    console.warn(`[care-lifecycle] scan ${reason} failed: ${lastError.message}`);
    return null;
  } finally {
    running = false;
  }
}

function startCareLifecycleScheduler() {
  if (timer) return getCareSchedulerStatus();

  if (!isSchedulerEnabled()) {
    console.log('[care-lifecycle] automatic scheduler disabled (CARE_LIFECYCLE_SCHEDULER_ENABLED=false)');
    return getCareSchedulerStatus();
  }

  const flags = getCareLifecycleFlags();
  if (!flags.enabled) {
    console.log(
      '[care-lifecycle] scheduler flag on but CARE_LIFECYCLE_ENABLED=false — not starting interval'
    );
    return getCareSchedulerStatus();
  }

  const intervalMs = getIntervalMs();
  const intervalHours = Math.round(intervalMs / (60 * 60 * 1000));
  const mode = flags.send ? 'write' : 'dry-run';
  console.log(
    `[care-lifecycle] automatic scan enabled every ${intervalHours} hour(s) mode=${mode} ` +
      `(SEND=${flags.send ? 'true' : 'false'})`
  );

  if (parseBool(process.env.CARE_LIFECYCLE_SCHEDULER_RUN_ON_START, false)) {
    setTimeout(() => runCareLifecycleScheduled('startup'), 15000).unref?.();
  }

  timer = setInterval(() => runCareLifecycleScheduled('schedule'), intervalMs);
  timer.unref?.();
  return getCareSchedulerStatus();
}

function stopCareLifecycleScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  startCareLifecycleScheduler,
  stopCareLifecycleScheduler,
  runCareLifecycleScheduled,
  getCareSchedulerStatus,
  isSchedulerEnabled,
  getIntervalMs,
  getScanLimit
};
