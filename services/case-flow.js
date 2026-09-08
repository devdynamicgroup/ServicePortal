const { getAllClients } = require('./notion/clients');
const { getFeedbackByToken } = require('./client-feedback');
const { closeCase, recordFeedback, sendCaseResult, repairCaseResultNotification, publishCaseScore, submitCaseFeedback, startCase, resolveJob, buildLineConnectPayload, isTerminalCaseStatus } = require('./workflow-service');
const {
  createCase,
  submitCustomerPreassessment,
  createTestCase,
  cancelAppointment,
  CUSTOMER_INPUT_FIELDS,
  SYSTEM_GENERATED_FIELDS
} = require('./case-creation-service');
const { resolveReportByToken } = require('./score-publication-service');

async function getReportByToken(reportToken) {
  const ledgerReport = await resolveReportByToken(reportToken);
  if (ledgerReport) return ledgerReport;
  const jobs = await getAllClients();
  return jobs.find(job => job.result?.publicReportToken === reportToken) || null;
}

/**
 * Read-only lookup for the Job screen's auto-connect prompt (2026-09-08) --
 * deliberately separate from sendCaseResult/executeSendCaseResult so opening
 * a Case never triggers a score publish or a notification-status write, just
 * a QR/link/code the client can offer to show. Reuses the exact same
 * buildLiffBindUrl-based QR generation the post-send-result modal already
 * uses (workflow-service.js:buildLineConnectPayload) -- no new token, no new
 * binding mechanism.
 */
async function getLineConnectInfo(caseId) {
  const job = await resolveJob(caseId);
  if (!job || isTerminalCaseStatus(job)) return null;
  if (job.line?.linked) return { linked: true };
  const payload = await buildLineConnectPayload(job);
  return { linked: false, ...payload };
}

module.exports = {
  closeCase,
  startCase,
  sendCaseResult,
  repairCaseResultNotification,
  publishCaseScore,
  submitCaseFeedback,
  createCase,
  submitCustomerPreassessment,
  createTestCase,
  cancelAppointment,
  CUSTOMER_INPUT_FIELDS,
  SYSTEM_GENERATED_FIELDS,
  getReportByToken,
  getFeedbackByToken,
  submitFeedback: recordFeedback,
  getLineConnectInfo
};
