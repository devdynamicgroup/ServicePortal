/**
 * OCR Service HTTP client.
 *
 * Communication only — no OCR logic, no image processing, no engine selection.
 * Never throws raw HTTP/network errors to callers; returns a standardized object.
 */

const { GoogleAuth } = require('google-auth-library');

// google-auth-library ships as a transitive dependency of googleapis (already
// in package.json) — reused here rather than adding a new dependency.
const googleAuth = new GoogleAuth();

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
  // Part L P1-F: default fits Cloud Run request timeout 300s with 3 attempts
  // + warmup delays: 3×90s + 2×8s = 286s < 300s.
  return 90000;
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

/** Worst-case portal wall-clock for ENGINE_UNAVAILABLE path (ms). */
function getOcrWorstCaseBudgetMs() {
  return (getOcrTimeoutMs() * MAX_READ_ATTEMPTS)
    + (ENGINE_WARMUP_DELAY_MS * Math.max(0, MAX_READ_ATTEMPTS - 1));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isDebug() {
  return String(process.env.OCR_DEBUG || '').toLowerCase() === 'true'
    || String(process.env.DEBUG || '').toLowerCase() === 'true';
}

/**
 * OCR service-to-service auth. Two independent mechanisms, selected by host:
 *
 * - Cloud Run (K_SERVICE present): Google-signed ID token via the Cloud Run
 *   runtime identity (ADC / metadata server) — no static credentials, no
 *   service-account keys. Validated entirely by Cloud Run's platform IAM;
 *   the OCR application never sees this token.
 * - Off Cloud Run (e.g. Render): no metadata server exists, so an ID token
 *   can never be obtained there. Falls back to a static shared secret sent
 *   as a header (OCR_SHARED_SECRET), validated by the OCR application
 *   itself (Option B soft rollout — see ocr-service/api/validators.py).
 *
 * Skipped entirely for local/dev OCR URLs, which run without either
 * boundary in front of them. Throws on failure so callers can distinguish
 * auth errors from OCR errors.
 */
const OCR_SHARED_SECRET_HEADER = 'X-OCR-Shared-Secret';

function isCloudRunRuntime() {
  return Boolean(process.env.K_SERVICE);
}

async function getOcrAuthHeaders(baseUrl) {
  if (isLocalOcrUrl(baseUrl)) return {};

  if (!isCloudRunRuntime()) {
    const sharedSecret = process.env.OCR_SHARED_SECRET;
    if (!sharedSecret) return {};
    return { [OCR_SHARED_SECRET_HEADER]: sharedSecret };
  }

  try {
    const client = await googleAuth.getIdTokenClient(baseUrl);
    const idToken = await client.idTokenProvider.fetchIdToken(baseUrl);
    return { Authorization: `Bearer ${idToken}` };
  } catch (error) {
    if (isDebug() && error?.stack) console.warn(error.stack);
    throw error;
  }
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
/**
 * Python json.dumps allows NaN / Infinity by default; Node JSON.parse rejects them.
 * Normalize those tokens so a HTTP 200 OCR envelope remains usable at the boundary.
 */
function sanitizePythonJsonText(rawText) {
  const text = String(rawText || '');
  const sanitized = text
    .replace(/\b-Infinity\b/g, 'null')
    .replace(/\bInfinity\b/g, 'null')
    .replace(/\bNaN\b/g, 'null');
  return {
    text: sanitized,
    changed: sanitized !== text
  };
}

function previewText(rawText, maxLen = 500) {
  const text = String(rawText || '');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…(len=${text.length})`;
}

/**
 * Temporary diagnostic — log only when OCR envelope validation fails.
 * Do not log successful responses here. No behavior change.
 */
function logOcrValidationFailure({
  reason,
  status,
  contentType,
  rawText,
  parseError = null,
  sanitizedText = null
}) {
  console.warn('[ocr-client] OCR_INVALID_RESPONSE diagnostic', {
    status,
    contentType: contentType || null,
    rawBodyPreview1000: previewText(rawText, 1000),
    jsonParseError: parseError == null ? null : String(parseError),
    sanitizedBodyPreview1000: sanitizedText == null
      ? null
      : previewText(sanitizedText, 1000),
    reason
  });
}

function parseOcrServiceBody(rawText, status, contentType) {
  const original = String(rawText || '');
  if (isDebug()) {
    console.warn('[ocr-client] raw OCR response before validation', {
      status,
      contentType: contentType || null,
      bodyLen: original.length,
      preview: previewText(original, 500)
    });
  }

  if (!original.trim()) {
    logOcrValidationFailure({
      reason: 'empty_body',
      status,
      contentType,
      rawText: original,
      parseError: null,
      sanitizedText: null
    });
    return {
      ok: false,
      reason: 'empty_body',
      error: {
        success: false,
        error: 'OCR_INVALID_RESPONSE',
        message: 'OCR service returned an empty response',
        retry: true,
        statusCode: status
      }
    };
  }

  let body;
  let usedSanitize = false;
  try {
    body = JSON.parse(original);
  } catch (firstError) {
    const { text: sanitized, changed } = sanitizePythonJsonText(original);
    usedSanitize = changed;
    if (!changed) {
      logOcrValidationFailure({
        reason: 'invalid_json',
        status,
        contentType,
        rawText: original,
        parseError: firstError?.message || String(firstError),
        sanitizedText: null
      });
      return {
        ok: false,
        reason: 'invalid_json',
        error: {
          success: false,
          error: 'OCR_INVALID_RESPONSE',
          message: 'OCR service returned an invalid response',
          retry: true,
          statusCode: status
        }
      };
    }
    try {
      body = JSON.parse(sanitized);
      if (isDebug()) {
        console.warn('[ocr-client] normalized OCR response after NaN/Infinity sanitize', {
          status,
          contentType: contentType || null,
          preview: previewText(sanitized, 500)
        });
      }
    } catch (secondError) {
      logOcrValidationFailure({
        reason: 'invalid_json_after_sanitize',
        status,
        contentType,
        rawText: original,
        parseError: secondError?.message || String(secondError),
        sanitizedText: sanitized
      });
      return {
        ok: false,
        reason: 'invalid_json_after_sanitize',
        error: {
          success: false,
          error: 'OCR_INVALID_RESPONSE',
          message: 'OCR service returned an invalid response',
          retry: true,
          statusCode: status
        }
      };
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    logOcrValidationFailure({
      reason: 'non_object_body',
      status,
      contentType,
      rawText: original,
      parseError: null,
      sanitizedText: null
    });
    return {
      ok: false,
      reason: 'non_object_body',
      error: {
        success: false,
        error: 'OCR_INVALID_RESPONSE',
        message: 'OCR service returned an empty response',
        retry: true,
        statusCode: status
      }
    };
  }

  if (isDebug()) {
    console.warn('[ocr-client] normalized OCR response', {
      status,
      contentType: contentType || null,
      success: Boolean(body.success),
      hasData: body.data != null && typeof body.data === 'object',
      dataKeys: body.data && typeof body.data === 'object' ? Object.keys(body.data) : [],
      error: body.error || null,
      usedSanitize
    });
  }

  return { ok: true, body, usedSanitize };
}

async function readMeterOnce(payload, timeoutMs) {
  const baseUrl = getOcrServiceUrl();
  const url = `${baseUrl}/ocr/read-meter`;

  console.warn('[ocr-client] request started', {
    url,
    meter_type: payload?.meter_type || null,
    timeoutMs
  });

  let authHeaders;
  try {
    authHeaders = await getOcrAuthHeaders(baseUrl);
  } catch (error) {
    console.warn('[ocr-client] request failed', { reason: 'auth_token_error' });
    return {
      success: false,
      error: 'OCR_AUTH_ERROR',
      message: 'Failed to obtain OCR service authentication token',
      retry: false
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authHeaders
      },
      body: JSON.stringify({
        image_url: payload.image_url,
        meter_type: payload.meter_type
      }),
      signal: controller.signal
    });

    if (response.status === 401 || response.status === 403) {
      const rawText = await response.text();
      console.warn('[ocr-client] request failed', {
        reason: 'auth_rejected',
        status: response.status,
        preview: previewText(rawText, 300)
      });
      return {
        success: false,
        error: 'OCR_AUTH_ERROR',
        message: 'OCR service rejected the request (authentication/authorization failure)',
        retry: false,
        statusCode: response.status
      };
    }

    const rawText = await response.text();
    const contentType = response.headers.get('content-type');
    const parsed = parseOcrServiceBody(rawText, response.status, contentType);
    if (!parsed.ok) {
      return parsed.error;
    }

    const body = parsed.body;
    console.warn('[ocr-client] request completed', {
      status: response.status,
      success: Boolean(body.success),
      meter_type: body.meter_type || payload?.meter_type || null,
      usedSanitize: Boolean(parsed.usedSanitize)
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

/**
 * Diagnostic-only counterpart to readMeter(): same input contract, but hits
 * ocr-service's /ocr/debug-read (returns raw OCR detections/rows/texts
 * instead of just the final parsed values) so a specific image's failure can
 * be traced without guessing from the production API response alone. Single
 * attempt, no retries — never called by the app's own capture flow.
 */
async function debugReadMeter(payload) {
  const misconfig = getProductionMisconfigError();
  if (misconfig) return misconfig;

  const baseUrl = getOcrServiceUrl();
  const url = `${baseUrl}/ocr/debug-read`;
  const timeoutMs = getOcrTimeoutMs();

  let authHeaders;
  try {
    authHeaders = await getOcrAuthHeaders(baseUrl);
  } catch (error) {
    return {
      success: false,
      error: 'OCR_AUTH_ERROR',
      message: 'Failed to obtain OCR service authentication token',
      retry: false
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authHeaders
      },
      body: JSON.stringify({
        image_url: payload.image_url,
        meter_type: payload.meter_type
      }),
      signal: controller.signal
    });

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: 'OCR_AUTH_ERROR',
        message: 'OCR service rejected the request (authentication/authorization failure)',
        retry: false,
        statusCode: response.status
      };
    }

    const rawText = await response.text();
    const contentType = response.headers.get('content-type');
    const parsed = parseOcrServiceBody(rawText, response.status, contentType);
    if (!parsed.ok) return parsed.error;

    return { ...parsed.body, statusCode: response.status };
  } catch (error) {
    const aborted = error?.name === 'AbortError'
      || /aborted|timeout/i.test(String(error?.message || ''));
    return {
      success: false,
      error: aborted ? 'OCR_TIMEOUT' : 'OCR_OFFLINE',
      message: 'OCR service is not available',
      retry: false
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
  debugReadMeter,
  getOcrServiceUrl,
  getOcrTimeoutMs,
  getOcrWorstCaseBudgetMs,
  MAX_READ_ATTEMPTS,
  ENGINE_WARMUP_DELAY_MS,
  // Exported for boundary smoke tests only.
  sanitizePythonJsonText,
  parseOcrServiceBody
};
