const { getAllClients } = require('./notion/clients');
const { getFeedbackByToken } = require('./client-feedback');
const { closeCase, recordFeedback, sendCaseResult, repairCaseResultNotification } = require('./workflow-service');
const {
  createCase,
  submitCustomerPreassessment,
  createTestCase,
  CUSTOMER_INPUT_FIELDS,
  SYSTEM_GENERATED_FIELDS
} = require('./case-creation-service');

async function getReportByToken(reportToken) {
  const jobs = await getAllClients();
  return jobs.find(job => job.result?.publicReportToken === reportToken) || null;
}

module.exports = {
  closeCase,
  sendCaseResult,
  repairCaseResultNotification,
  createCase,
  submitCustomerPreassessment,
  createTestCase,
  CUSTOMER_INPUT_FIELDS,
  SYSTEM_GENERATED_FIELDS,
  getReportByToken,
  getFeedbackByToken,
  submitFeedback: recordFeedback
};
