const crypto = require('crypto');

// Process-local, in-memory idempotency store. Same limitation as the M3
// offer cache and workflow-service's withCaseLock: single-instance only,
// resets on restart. Acceptable under the same precedent already accepted
// for this deployment (see M3 audit notes on offerCache).

const DEFAULT_TTL_MS = 30 * 1000;
const entries = new Map();

function sweepExpired(now = Date.now()) {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
}

function fingerprint(parts) {
  const normalized = parts.map(part => String(part ?? '').trim().toLowerCase()).join('|');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Runs `fn` at most once per `key` within `ttlMs`. Concurrent/duplicate calls
// with the same key while the first is in flight (or shortly after it
// resolves) get the SAME resolved value replayed instead of re-running fn.
async function withIdempotency(key, fn, ttlMs = DEFAULT_TTL_MS) {
  const now = Date.now();
  sweepExpired(now);

  const existing = entries.get(key);
  if (existing) {
    existing.replayCount += 1;
    return existing.promise;
  }

  const promise = Promise.resolve().then(() => fn());
  const entry = { promise, expiresAt: now + ttlMs, replayCount: 0 };
  entries.set(key, entry);

  // If the call fails, don't let a transient error poison the dedup window —
  // remove the entry so a genuine retry can attempt the booking again.
  promise.catch(() => { if (entries.get(key) === entry) entries.delete(key); });

  return promise;
}

function wasReplayed(key) {
  return Boolean(entries.get(key)?.replayCount);
}

function clearIdempotencyStore() {
  entries.clear();
}

module.exports = {
  fingerprint,
  withIdempotency,
  wasReplayed,
  clearIdempotencyStore
};
