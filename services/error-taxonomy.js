// Additive shared error shape for ops/logging. Does not replace thrown Errors
// used by existing callers unless they opt in.

const ERROR_KINDS = Object.freeze({
  VALIDATION: 'Validation',
  RETRYABLE: 'Retryable',
  EXTERNAL: 'External',
  BUSINESS: 'Business',
  UNEXPECTED: 'Unexpected'
});

function classifyError(error, fallbackKind = ERROR_KINDS.UNEXPECTED) {
  if (!error) return fallbackKind;
  if (error.kind && Object.values(ERROR_KINDS).includes(error.kind)) return error.kind;
  const status = Number(error.status ?? error.statusCode);
  if (status === 429 || (status >= 500 && status < 600)) return ERROR_KINDS.RETRYABLE;
  const code = String(error.code || error.cause?.code || '').toUpperCase();
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'ENETUNREACH'].includes(code)) {
    return ERROR_KINDS.RETRYABLE;
  }
  if (status >= 400 && status < 500) return ERROR_KINDS.EXTERNAL;
  if (error.business || error.code === 'BUSINESS') return ERROR_KINDS.BUSINESS;
  if (error.validation || error.code === 'VALIDATION') return ERROR_KINDS.VALIDATION;
  return fallbackKind;
}

function createAppError({
  kind = ERROR_KINDS.UNEXPECTED,
  code = 'unexpected',
  message = 'Unexpected error',
  context = {},
  cause = null
} = {}) {
  const err = new Error(message);
  err.kind = kind;
  err.code = code;
  err.context = context && typeof context === 'object' ? { ...context } : {};
  if (cause) err.cause = cause;
  return err;
}

function toErrorPayload(error, extraContext = {}) {
  return {
    kind: classifyError(error),
    code: String(error?.code || 'unexpected'),
    message: String(error?.message || error || 'Unexpected error'),
    context: {
      ...(error?.context && typeof error.context === 'object' ? error.context : {}),
      ...extraContext
    }
  };
}

module.exports = {
  ERROR_KINDS,
  classifyError,
  createAppError,
  toErrorPayload
};
