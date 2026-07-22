/**
 * OCR Service HTTP client.
 *
 * Communication only — no OCR logic, no image processing, no engine selection.
 * Never throws raw HTTP/network errors to callers; returns a standardized object.
 */

function getOcrServiceUrl() {
  return String(process.env.OCR_SERVICE_URL || 'http://127.0.0.1:5055').replace(/\/$/, '');
}

function isLocalOcrUrl(url) {
  return /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/|$)/i.test(String(url || ''));
}

/**
 * In production, localhost OCR is always wrong (portal dyno ≠ OCR process).
 * Fail fast with a clear code so Render misconfig is obvious in the UI/logs.
 */
function getProductionMisconfigError() {
  if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') return null;
  const url = getOcrServiceUrl();
  if (!process.env.OCR_SERVICE_URL || isLocalOcrUrl(url)) {
    return {
      success: false,
      error: 'OCR_MISCONFIGURED',
      message:
        'OCR_SERVICE_URL is missing or points to localhost. Deploy water-motion-ocr-service and set OCR_SERVICE_URL to its public URL.',
      retry: false,
      statusCode: 503
    };
  }
  return null;
}

function getOcrTimeoutMs() {
  const raw = Number(process.env.OCR_TIMEOUT);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  // Paddle cold start + first predict often exceeds 30s on free-tier hosts.
  return 120000;
}

const RETRYABLE_ERRORS = new Set([
  'ENGINE_UNAVAILABLE',
  'OCR_OFFLINE',
  'OCR_TIMEOUT',
  'OCR_INTERNAL_ERROR'
]);

const MAX_READ_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;
const ENGINE_WARMUP_DELAY_MS = 8000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isDebug() {
  return String(process.env.OCR_DEBUG || '').toLowerCase() === 'true'
    || String(process.env.DEBUG || '').toLowerCase() === 'true';
}

/**
 * @param {{ image_url: string, meter_type: string }} payload
 * @returns {Promise<{
 *   success: boolean,
 *   data?: object,
 *   message?: string,
 *   meter_type?: string,
 *   confidence?: number,
 *   error?: string,
 *   retry?: boolean,
 *   statusCode?: number
 * }>}
 */
async function readMeterOnce(payload, timeoutMs) {
  const baseUrl = getOcrServiceUrl();
  const url = `${baseUrl}/ocr/read-meter`;

  console.warn('[ocr-client] request started', {
    url,
    meter_type: payload?.meter_type || null,
    timeoutMs
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        image_url: payload.image_url,
        meter_type: payload.meter_type
      }),
      signal: controller.signal
    });

    let body;
    try {
      body = await response.json();
    } catch {
      console.warn('[ocr-client] request failed', { reason: 'invalid_json', status: response.status });
      return {
        success: false,
        error: 'OCR_INVALID_RESPONSE',
        message: 'OCR service returned an invalid response',
        retry: true,
        statusCode: response.status
      };
    }

    if (!body || typeof body !== 'object') {
      console.warn('[ocr-client] request failed', { reason: 'empty_body', status: response.status });
      return {
        success: false,
        error: 'OCR_INVALID_RESPONSE',
        message: 'OCR service returned an empty response',
        retry: true,
        statusCode: response.status
      };
    }

    console.warn('[ocr-client] request completed', {
      status: response.status,
      success: Boolean(body.success),
      meter_type: body.meter_type || payload?.meter_type || null
    });

    // Pass through OCR Service envelope; never invent OCR values here.
    return {
      ...body,
      statusCode: response.status
    };
  } catch (error) {
    const aborted = error?.name === 'AbortError'
      || /aborted|timeout/i.test(String(error?.message || ''));

    if (aborted) {
      console.warn('[ocr-client] request failed', { reason: 'timeout', timeoutMs });
      return {
        success: false,
        error: 'OCR_TIMEOUT',
        message: 'OCR service unavailable',
        retry: true
      };
    }

    console.warn('[ocr-client] request failed', {
      reason: 'offline',
      message: isDebug() ? (error?.message || String(error)) : 'connection_error'
    });
    if (isDebug() && error?.stack) {
      console.warn(error.stack);
    }

    return {
      success: false,
      error: 'OCR_OFFLINE',
      message: 'OCR service is not available',
      retry: true
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readMeter(payload) {
  const misconfig = getProductionMisconfigError();
  if (misconfig) {
    console.warn('[ocr-client] production misconfigured', {
      ocrServiceUrl: process.env.OCR_SERVICE_URL || '(unset → localhost default)'
    });
    return misconfig;
  }

  const timeoutMs = getOcrTimeoutMs();
  let lastResult;

  for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
    lastResult = await readMeterOnce(payload, timeoutMs);
    const errorCode = lastResult?.error;
    const shouldRetry = attempt < MAX_READ_ATTEMPTS
      && (lastResult?.retry === true || RETRYABLE_ERRORS.has(errorCode));

    if (!shouldRetry) break;

    const delayMs = errorCode === 'ENGINE_UNAVAILABLE'
      ? ENGINE_WARMUP_DELAY_MS
      : RETRY_DELAY_MS;
    console.warn('[ocr-client] retrying', { attempt, error: errorCode, delayMs });
    await sleep(delayMs);
  }

  return lastResult;
}

module.exports = {
  readMeter,
  getOcrServiceUrl,
  getOcrTimeoutMs
};
