// Single source of truth for public URL construction. Consolidates the
// publicBaseUrl()/report-URL/feedback-URL/review-URL logic that used to be
// copy-pasted across api/case-flow-routes.js, services/workflow-service.js,
// services/line-notifications.js and services/case-creation-service.js
// (M4 audit, Part 3). Output is byte-identical to the prior per-file copies.

const DEFAULT_REVIEW_URL = 'https://g.page/r/Ce0EFhVtUyRpEBM/review';

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://serviceportal.onrender.com').replace(/\/$/, '');
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
  resolveReviewUrl
};
