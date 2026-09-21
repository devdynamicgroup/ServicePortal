/**
 * Best-effort in-process background work tracking for Cloud Run SIGTERM drain.
 * Not a durable queue — correctness-critical work should complete before HTTP ACK
 * or use Notion/idempotent recovery (Part L P1-D/C).
 */
const inflight = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trackBackground(task) {
  const run = Promise.resolve()
    .then(() => (typeof task === 'function' ? task() : task))
    .catch((error) => {
      console.warn('[background_work] task failed', error && error.message ? error.message : error);
    })
    .finally(() => {
      inflight.delete(run);
    });
  inflight.add(run);
  return run;
}

async function drainBackgroundWork(timeoutMs = 20000) {
  if (!inflight.size) return { drained: 0, timedOut: false };
  const pending = inflight.size;
  const all = Promise.allSettled([...inflight]);
  const timedOut = await Promise.race([
    all.then(() => false),
    sleep(timeoutMs).then(() => true)
  ]);
  return { drained: pending, timedOut: Boolean(timedOut) };
}

function backgroundInflightCount() {
  return inflight.size;
}

module.exports = {
  trackBackground,
  drainBackgroundWork,
  backgroundInflightCount
};
