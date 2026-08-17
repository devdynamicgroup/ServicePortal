const { getAllClients } = require('./notion/clients');
const { getFeedbackByToken } = require('./client-feedback');
const { closeCase, recordFeedback, sendCaseResult, repairCaseResultNotification, publishCaseScore, submitCaseFeedback, startCase } = require('./workflow-service');
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
  submitFeedback: recordFeedback
};
