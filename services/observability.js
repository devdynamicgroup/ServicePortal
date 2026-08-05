const crypto = require('crypto');
const { toErrorPayload } = require('./error-taxonomy');

// Additive structured logging with correlation IDs. Does not replace or
// alter any existing console.info/console.warn call — those keep their
// current messages/shape exactly. This only adds new, separate log lines
// tagged with a correlationId so a single booking's lifecycle (create ->
// notify -> recover) can be traced across the existing logs.

function newCorrelationId(prefix = 'req') {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

function logEvent(level, event, fields = {}) {
  const line = {
    ts: new Date().toISOString(),
    event,
    ...fields
  };
  const method = level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'info';
  console[method](`[obs:${event}]`, JSON.stringify(line));
}

/** M7: LINE/OA lifecycle fields — additive; callers keep existing console.info. */
function logLineLifecycle(level, event, fields = {}) {
  const startedMs = Number(fields.startedMs);
  const durationMs = Number.isFinite(fields.durationMs)
    ? fields.durationMs
    : (Number.isFinite(startedMs) ? Date.now() - startedMs : undefined);
  logEvent(level, event, {
    correlationId: fields.correlationId || newCorrelationId('line'),
    caseId: fields.caseId || null,
    lineUserId: fields.lineUserId || null,
    eventType: fields.eventType || null,
    durationMs: durationMs ?? null,
    success: fields.success !== undefined ? Boolean(fields.success) : null,
    failureReason: fields.failureReason || null,
    action: fields.action || null,
    ...(fields.extra && typeof fields.extra === 'object' ? fields.extra : {})
  });
}

function logClassifiedError(event, error, fields = {}) {
  const payload = toErrorPayload(error, fields.context || {});
  logEvent('error', event, {
    correlationId: fields.correlationId || newCorrelationId('err'),
    caseId: fields.caseId || null,
    lineUserId: fields.lineUserId || null,
    eventType: fields.eventType || null,
    success: false,
    failureReason: payload.message,
    error: payload
  });
}

module.exports = {
  newCorrelationId,
  logEvent,
  logLineLifecycle,
  logClassifiedError
};
