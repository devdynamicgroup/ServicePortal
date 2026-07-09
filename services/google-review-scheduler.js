const {
  syncReviewsToNotion,
  getGoogleReviewIntegrationStatus
} = require('./google-reviews');
const { isBusinessProfileConfigured } = require('./google-business');

let timer = null;
let running = false;

function boolEnv(name, fallback = true) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function getIntervalMs() {
  const minutes = Number(process.env.GOOGLE_REVIEW_SYNC_INTERVAL_MINUTES || 15);
  return Math.max(1, minutes) * 60 * 1000;
}

function isReadyToSync() {
  const status = getGoogleReviewIntegrationStatus();
  return status.notionConfigured && status.businessProfileConfigured;
}

async function runGoogleReviewSync(reason = 'schedule') {
  if (running) {
    console.log(`[google-reviews] sync skipped (${reason}): already running`);
    return null;
  }

  if (!isReadyToSync()) {
    console.log('[google-reviews] sync waiting for configuration', {
      notionConfigured: getGoogleReviewIntegrationStatus().notionConfigured,
      businessProfileConfigured: isBusinessProfileConfigured()
    });
    return null;
  }

  running = true;
  try {
    const result = await syncReviewsToNotion();
    console.log(`[google-reviews] sync ${reason}: inserted=${result.created}, skipped=${result.skipped}, total=${result.total}`);
    return result;
  } catch (error) {
    console.warn(`[google-reviews] sync ${reason} failed: ${error.message}`);
    return null;
  } finally {
    running = false;
  }
}

function startGoogleReviewScheduler() {
  if (timer) return;
  if (!boolEnv('GOOGLE_REVIEW_SYNC_ENABLED', true)) {
    console.log('[google-reviews] automatic sync disabled');
    return;
  }

  const intervalMs = getIntervalMs();
  const intervalMinutes = Math.round(intervalMs / 60000);
  console.log(`[google-reviews] automatic sync enabled every ${intervalMinutes} minute(s)`);

  if (boolEnv('GOOGLE_REVIEW_SYNC_RUN_ON_START', true)) {
    setTimeout(() => runGoogleReviewSync('startup'), 5000).unref?.();
  }

  timer = setInterval(() => runGoogleReviewSync('schedule'), intervalMs);
  timer.unref?.();
}

module.exports = {
  startGoogleReviewScheduler,
  runGoogleReviewSync
};
