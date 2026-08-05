/**
 * Cal.com webhook helpers — Phase 1 receive-only.
 * Signature scheme: HMAC-SHA256 hex over raw body; header X-Cal-Signature-256
 * (Cal.com sendPayload: createHmac("sha256", secret).update(body).digest("hex")).
 * Does not create Cases, write Notion, or map customer fields.
 */
const crypto = require('crypto');

const SIGNATURE_HEADER = 'x-cal-signature-256';

function getCalWebhookSecret() {
  return String(process.env.CAL_WEBHOOK_SECRET || '').trim();
}

function isCalWebhookConfigured() {
  return Boolean(getCalWebhookSecret());
}

function verifyCalSignature(rawBody, signature) {
  const secret = getCalWebhookSecret();
  const sig = String(signature || '').trim();
  if (!secret || !sig) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expectedHex = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const expected = Buffer.from(expectedHex, 'utf8');
  const actual = Buffer.from(sig, 'utf8');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function calSignatureDebug(rawBody, signature) {
  const secret = getCalWebhookSecret();
  const sig = String(signature || '').trim();
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  return {
    id: 'cal_sig_debug',
    hasSecret: Boolean(secret),
    secretLength: secret.length,
    signaturePresent: Boolean(sig),
    signatureLength: sig.length,
    bodyBytes: body.length
  };
}

/**
 * Envelope-only peek for logs — not a Case field mapping.
 * Paths may be absent until CAL-G01 payload pack is confirmed.
 */
function summarizeCalEnvelope(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const inner = root.payload && typeof root.payload === 'object' ? root.payload : {};
  const triggerEvent = String(root.triggerEvent || root.trigger || '').trim() || null;
  const bookingUid = String(
    inner.uid || inner.bookingUid || root.uid || root.bookingId || ''
  ).trim() || null;
  return {
    triggerEvent,
    bookingUidPresent: Boolean(bookingUid),
    hasInnerPayload: Boolean(root.payload && typeof root.payload === 'object'),
    topLevelKeys: Object.keys(root).slice(0, 20)
  };
}

function buildDedupeKey(payload, rawBody) {
  const summary = summarizeCalEnvelope(payload);
  if (summary.triggerEvent && summary.bookingUidPresent) {
    const inner = payload.payload && typeof payload.payload === 'object' ? payload.payload : {};
    const uid = String(inner.uid || inner.bookingUid || payload.uid || payload.bookingId || '').trim();
    return `cal:${summary.triggerEvent}:${uid}`;
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 32);
  return `cal:body:${hash}`;
}

module.exports = {
  SIGNATURE_HEADER,
  getCalWebhookSecret,
  isCalWebhookConfigured,
  verifyCalSignature,
  calSignatureDebug,
  summarizeCalEnvelope,
  buildDedupeKey
};
