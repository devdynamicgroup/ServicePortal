/**
 * Cal.com webhook routes.
 *
 * BOOKING_CREATED: verified, deduped, and processed by the Adapter
 * (services/cal-booking-adapter.js) into a real Case via the existing,
 * unmodified createCase(). Scope is BOOKING_CREATED only — every other
 * trigger event (including BOOKING_CANCELLED / BOOKING_RESCHEDULED) is
 * still received, verified, and acknowledged, but not processed — no
 * handler exists for them by design (out of current scope).
 */
const crypto = require('crypto');
const {
  SIGNATURE_HEADER,
  isCalWebhookConfigured,
  verifyCalSignature,
  calSignatureDebug,
  summarizeCalEnvelope,
  buildDedupeKey
} = require('../services/cal-webhook');
const { noteCalDelivery, calDedupePlaceholderSize } = require('../services/cal-dedupe-placeholder');
const { newCorrelationId, logEvent } = require('../services/observability');
const { processBookingCreated } = require('../services/cal-booking-adapter');

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function headerValue(req, name) {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

async function handleCalRoute(req, res, urlPath) {
  if (urlPath === '/api/cal/webhook/status' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      phase: 1,
      mode: 'booking_created_active',
      hasWebhookSecret: isCalWebhookConfigured(),
      signatureHeader: SIGNATURE_HEADER,
      dedupePlaceholderEntries: calDedupePlaceholderSize(),
      createsCases: true,
      createsCasesFor: ['BOOKING_CREATED'],
      webhookUrl: `${(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://127.0.0.1:3040').replace(/\/$/, '')}/api/cal/webhook`
    });
    return true;
  }

  if (urlPath === '/api/cal/webhook' && req.method === 'POST') {
    const correlationId = newCorrelationId('cal');
    let rawBody;
    try {
      rawBody = await readRawBody(req);
    } catch (error) {
      logEvent('warn', 'cal_webhook_body_error', { correlationId, error: error.message });
      sendJson(res, 400, { ok: false, phase: 1, error: error.message || 'Invalid body' });
      return true;
    }

    const signature = headerValue(req, SIGNATURE_HEADER);
    const sigDebug = calSignatureDebug(rawBody, signature);

    if (isCalWebhookConfigured()) {
      if (!verifyCalSignature(rawBody, signature)) {
        logEvent('warn', 'cal_webhook_signature_rejected', {
          correlationId,
          ...sigDebug
        });
        sendJson(res, 401, {
          ok: false,
          phase: 1,
          error: 'Invalid Cal signature',
          correlationId
        });
        return true;
      }
    } else {
      logEvent('warn', 'cal_webhook_secret_missing', {
        correlationId,
        note: 'CAL_WEBHOOK_SECRET unset — signature not enforced (local/dev only)'
      });
    }

    let payload = {};
    try {
      payload = JSON.parse(rawBody.length ? rawBody.toString('utf8') : '{}');
    } catch (error) {
      logEvent('warn', 'cal_webhook_json_error', { correlationId, error: error.message });
      sendJson(res, 400, { ok: false, phase: 1, error: 'Invalid JSON', correlationId });
      return true;
    }

    const envelope = summarizeCalEnvelope(payload);
    const dedupeKey = buildDedupeKey(payload, rawBody);
    const dedupe = noteCalDelivery(dedupeKey);

    logEvent('info', 'cal_webhook_received', {
      correlationId,
      triggerEvent: envelope.triggerEvent,
      bookingUidPresent: envelope.bookingUidPresent,
      hasInnerPayload: envelope.hasInnerPayload,
      topLevelKeys: envelope.topLevelKeys,
      dedupeKeyFingerprint: cryptoSafeFingerprint(dedupeKey),
      duplicate: Boolean(dedupe.seen),
      dedupePlaceholder: true
    });

    // Scope: BOOKING_CREATED only. Every other trigger event (including
    // BOOKING_CANCELLED / BOOKING_RESCHEDULED) is received, verified, and
    // acknowledged above, but intentionally has no handler — out of scope
    // by design, not an oversight.
    if (envelope.triggerEvent !== 'BOOKING_CREATED') {
      sendJson(res, 200, {
        ok: true,
        received: true,
        processed: false,
        duplicate: Boolean(dedupe.seen),
        correlationId,
        triggerEvent: envelope.triggerEvent,
        createsCases: false,
        note: 'Received and acknowledged. No handler for this trigger event in current scope.'
      });
      return true;
    }

    try {
      const outcome = await processBookingCreated(payload, correlationId);
      sendJson(res, 200, {
        ok: true,
        received: true,
        processed: true,
        duplicate: Boolean(outcome.idempotent),
        correlationId,
        triggerEvent: envelope.triggerEvent,
        createsCases: true,
        caseCreated: !outcome.idempotent,
        caseId: outcome.case?.notionId || null,
        calBookingId: outcome.calBookingId
      });
    } catch (error) {
      const statusCode = error.statusCode || 502;
      logEvent(statusCode >= 500 ? 'error' : 'warn', 'cal_adapter_failed', {
        correlationId,
        triggerEvent: envelope.triggerEvent,
        statusCode,
        error: error.message
      });
      sendJson(res, statusCode, {
        ok: false,
        received: true,
        processed: false,
        correlationId,
        triggerEvent: envelope.triggerEvent,
        error: error.message
      });
    }
    return true;
  }

  return false;
}

function cryptoSafeFingerprint(key) {
  return crypto.createHash('sha256').update(String(key || '')).digest('hex').slice(0, 16);
}

module.exports = { handleCalRoute };
