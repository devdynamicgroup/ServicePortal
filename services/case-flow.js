const { getAllClients } = require('./notion/clients');
const { getFeedbackByToken } = require('./client-feedback');
const { closeCase, recordFeedback } = require('./workflow-service');

async function getReportByToken(reportToken) {
  const jobs = await getAllClients();
  return jobs.find(job => job.result?.publicReportToken === reportToken) || null;
}

module.exports = {
  closeCase,
  getReportByToken,
  getFeedbackByToken,
  submitFeedback: recordFeedback
};
