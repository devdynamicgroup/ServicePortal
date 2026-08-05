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

module.exports = {
  DEFAULT_REVIEW_URL,
  publicBaseUrl,
  buildReportUrl,
  buildFeedbackUrl,
  resolveReviewUrl
};
