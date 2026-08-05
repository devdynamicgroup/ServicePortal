/**
 * Phase 1 placeholder dedupe for Cal webhooks (receive-only).
 *
 * Durable + race-safe dedupe is required before Case create (later phase).
 * This store is intentionally process-local and non-durable.
 * It must NOT be treated as production-ready idempotency for createCase().
 */
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h placeholder window only
const entries = new Map();

function sweep(now = Date.now()) {
  for (const [key, expiresAt] of entries) {
    if (expiresAt <= now) entries.delete(key);
  }
}

/**
 * @returns {{ seen: boolean, placeholder: true }}
 */
function noteCalDelivery(key, ttlMs = DEFAULT_TTL_MS) {
  const id = String(key || '').trim();
  if (!id) {
    return { seen: false, placeholder: true, skipped: true };
  }
  const now = Date.now();
  sweep(now);
  if (entries.has(id)) {
    return { seen: true, placeholder: true };
  }
  entries.set(id, now + ttlMs);
  return { seen: false, placeholder: true };
}

function clearCalDedupePlaceholder() {
  entries.clear();
}

function calDedupePlaceholderSize() {
  sweep();
  return entries.size;
}

module.exports = {
  noteCalDelivery,
  clearCalDedupePlaceholder,
  calDedupePlaceholderSize,
  DEFAULT_TTL_MS
};
