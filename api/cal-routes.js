/**
 * Cal.com webhook routes — Phase 1 receive-only.
 * Accepts events, verifies signature (when secret set), logs, placeholder dedupe.
 * Does not call createCase(), write Notion, or map customer fields.
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
      mode: 'receive_only',
      hasWebhookSecret: isCalWebhookConfigured(),
      signatureHeader: SIGNATURE_HEADER,
      dedupePlaceholderEntries: calDedupePlaceholderSize(),
      createsCases: false,
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
      phase: 1,
      mode: 'receive_only',
      triggerEvent: envelope.triggerEvent,
      bookingUidPresent: envelope.bookingUidPresent,
      hasInnerPayload: envelope.hasInnerPayload,
      topLevelKeys: envelope.topLevelKeys,
      dedupeKeyFingerprint: cryptoSafeFingerprint(dedupeKey),
      duplicate: Boolean(dedupe.seen),
      dedupePlaceholder: true,
      createsCases: false
    });

    // CAL-G01 evidence capture (temporary, Phase 2 scope only). Logs the
    // complete, unredacted parsed payload for exactly one real BOOKING_CREATED
    // delivery so the true Cal.com JSON shape can be documented. Read-only:
    // no Case/Notion/business logic is touched here. Remove once
    // docs/CALCOM_G01_RUNTIME_CAPTURE.md has been produced from this evidence.
    if (envelope.triggerEvent === 'BOOKING_CREATED') {
      console.info('[cal_g01_capture]', JSON.stringify({
        correlationId,
        capturedAt: new Date().toISOString(),
        contentType: req.headers['content-type'] || null,
        signatureHeaderPresent: Boolean(signature),
        signatureHeaderValue: signature || null,
        bodyLength: rawBody.length,
        rawBody: payload
      }));
    }

    sendJson(res, 200, {
      ok: true,
      phase: 1,
      mode: 'receive_only',
      received: true,
      duplicate: Boolean(dedupe.seen),
      correlationId,
      triggerEvent: envelope.triggerEvent,
      createsCases: false
    });
    return true;
  }

  return false;
}

function cryptoSafeFingerprint(key) {
  return crypto.createHash('sha256').update(String(key || '')).digest('hex').slice(0, 16);
}

module.exports = { handleCalRoute };
