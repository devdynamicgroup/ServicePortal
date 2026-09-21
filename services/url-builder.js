// Single source of truth for public URL construction. Consolidates the
// publicBaseUrl()/report-URL/feedback-URL/review-URL logic that used to be
// copy-pasted across api/case-flow-routes.js, services/workflow-service.js,
// services/line-notifications.js and services/case-creation-service.js
// (M4 audit, Part 3). Output is byte-identical to the prior per-file copies.

const DEFAULT_REVIEW_URL = 'https://g.page/r/Ce0EFhVtUyRpEBM/review';

function isCloudRunRuntime() {
  return Boolean(process.env.K_SERVICE);
}

function isProductionLikeRuntime() {
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  if (nodeEnv === 'production') return true;
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID) return true;
  if (isCloudRunRuntime()) return true;
  return false;
}

/**
 * Canonical public origin for report/feedback/LINE absolute URLs.
 * Cloud Run / production MUST set PUBLIC_BASE_URL — never silently use a
 * hardcoded Render hostname (Part L P1-B).
 */
function publicBaseUrl() {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');

  // Render injects RENDER_EXTERNAL_URL. Accept only when not on Cloud Run.
  const renderUrl = String(process.env.RENDER_EXTERNAL_URL || '').trim();
  if (renderUrl && !isCloudRunRuntime()) {
    return renderUrl.replace(/\/$/, '');
  }

  if (isProductionLikeRuntime()) {
    const error = new Error(
      'PUBLIC_BASE_URL must be set in production (Cloud Run / Render). Hardcoded host fallbacks are disabled.'
    );
    error.statusCode = 500;
    error.code = 'PUBLIC_BASE_URL_REQUIRED';
    throw error;
  }

  return 'http://127.0.0.1:3000';
}

function buildReportUrl(reportToken) {
  const token = String(reportToken ?? '').trim();
  if (!token) return '';
  return `${publicBaseUrl()}/r/${encodeURIComponent(token)}`;
}

function buildFeedbackUrl(feedbackToken) {
  const token = String(feedbackToken ?? '').trim();
  if (!token) return '';
  return `${publicBaseUrl()}/f/${encodeURIComponent(token)}`;
}

function resolveReviewUrl(explicitUrl) {
  return String(explicitUrl || process.env.GOOGLE_REVIEW_URL || DEFAULT_REVIEW_URL).trim();
}

// LIFF app "Case Bind" (2026-08-26) -- lets a customer tap a link to bind
// their LINE account to a Case automatically via LIFF's login/profile SDK,
// instead of typing the fb-xxxx code by hand in chat.
//
// Token travels as an extra PATH segment after the LIFF ID, not a query
// string (fixed 2026-09-03). LIFF forwards whatever comes after
// https://liff.line.me/{liffId}/ onto the app's registered Endpoint URL --
// but server.js strips the query string (`req.url.split('?')[0]`) before any
// route ever runs, so a `?token=` here could never reach
// api/liff-routes.js's `/liff/bind/:token` path-based route. The path form
// is the only one server.js's routing can ever resolve; keep them matched.
function buildLiffBindUrl(feedbackToken) {
  const token = String(feedbackToken ?? '').trim();
  if (!token) return '';
  const liffId = String(process.env.LIFF_ID || '2011272555-MAtmaEy4').trim();
  return `https://liff.line.me/${liffId}/${encodeURIComponent(token)}`;
}

module.exports = {
  DEFAULT_REVIEW_URL,
  publicBaseUrl,
  buildReportUrl,
  buildFeedbackUrl,
  buildLiffBindUrl,
  resolveReviewUrl,
  isCloudRunRuntime,
  isProductionLikeRuntime
};
