// Reusable retry wrapper for transient failures (Notion 429/5xx, LINE 429/5xx,
// network errors). Does not change the result shape of the wrapped call: on
// success it returns exactly what the function returned; after exhausting
// retries it throws/returns exactly what the last attempt threw/returned,
// so existing callers' error handling is unaffected.

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Notion SDK errors expose `.status` (and sometimes `.code`); raw fetch
// Response-based failures (LINE) are checked by the caller via isTransientStatus
// on the HTTP status before ever reaching here. This covers thrown errors.
function isTransientError(error) {
  const status = Number(error?.status ?? error?.statusCode);
  if (Number.isFinite(status)) {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const transientCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH'];
  if (transientCodes.includes(code)) return true;
  const message = String(error?.message || '');
  if (/network|fetch failed|timeout/i.test(message)) return true;
  return false;
}

function isTransientHttpStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

async function withRetry(fn, options = {}) {
  const maxAttempts = Number.isFinite(options.maxAttempts) ? options.maxAttempts : DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : DEFAULT_BASE_DELAY_MS;
  const shouldRetry = options.shouldRetry || isTransientError;
  const onRetry = options.onRetry || (() => {});

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt || !shouldRetry(error)) throw error;
      onRetry({ attempt, error });
      await sleep(baseDelayMs * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

module.exports = {
  withRetry,
  isTransientError,
  isTransientHttpStatus
};
