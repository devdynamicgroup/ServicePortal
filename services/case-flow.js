const crypto = require('crypto');
const { getAllClients, getClient, updateClient } = require('./notion/clients');
const {
  upsertFeedbackRecord,
  getFeedbackByToken,
  submitFeedback,
  isClientFeedbackConfigured
} = require('./client-feedback');
const { sendCaseResultNotification } = require('./line-notifications');

const DEFAULT_REVIEW_URL = 'https://g.page/r/Ce0EFhVtUyRpEBM/review';

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://serviceportal.example.com').replace(/\/$/, '');
}

function token(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

async function resolveJob(caseId) {
  if (!caseId) return null;
  if (/^[0-9a-f-]{32,36}$/i.test(caseId)) {
    try {
      return await getClient(caseId);
    } catch {
      return null;
    }
  }
  const jobs = await getAllClients();
  return jobs.find(job => String(job.id) === String(caseId) || String(job.notionId) === String(caseId)) || null;
}

function clientPhone(job) {
  return job?.draft?.fields?.['ci-phone'] || '';
}

async function closeCase(caseId, payload = {}) {
  const job = await resolveJob(caseId);
  if (!job?.notionId) {
    const error = new Error('Case not found');
    error.statusCode = 404;
    throw error;
  }

  const now = new Date().toISOString();
  const reportToken = job.result?.publicReportToken || token('rpt');
  const feedbackToken = job.feedback?.token || token('fb');
  const reportUrl = `${publicBaseUrl()}/r/${reportToken}`;
  const feedbackUrl = `${publicBaseUrl()}/f/${feedbackToken}`;
  const reviewUrl = payload.reviewUrl || job.review?.url || process.env.GOOGLE_REVIEW_URL || DEFAULT_REVIEW_URL;
  const score = payload.score ?? job.result?.waterScore ?? job.draft?.scoreVal ?? null;
  const resultSummary = payload.resultSummary
    || job.result?.summary
    || (score ? `Water score ${score}/100. Please review the full report.` : 'Water assessment report is ready.');
  const recommendations = payload.recommendations
    || job.result?.recommendations
    || 'Please review the result, submit your satisfaction feedback, then leave a Google review if everything looks good.';

  const lineUserId = String(job.line?.userId || '').trim();
  const closePatch = {
    caseWorkflowStatus: 'completed',
    serviceCompletedAt: now,
    closedAt: now,
    completedBy: payload.completedBy || payload.staffName || 'Water Motion Specialist',
    latestWaterScore: score,
    resultSummary,
    recommendations,
    reportUrl,
    publicReportToken: reportToken,
    feedbackToken,
    feedbackUrl,
    feedbackStatus: 'pending',
    reviewUrl,
    reviewStatus: 'not_requested'
  };
  if (lineUserId) {
    closePatch.notificationStatus = 'ready';
  }

  const updatedJob = await updateClient(job.notionId, closePatch);

  let feedbackRecord = null;
  if (isClientFeedbackConfigured()) {
    try {
      feedbackRecord = await upsertFeedbackRecord({
        feedbackToken,
        title: `Feedback - ${updatedJob.name}`,
        clientPageId: updatedJob.notionId,
        clientName: updatedJob.name,
        clientPhone: clientPhone(updatedJob),
        caseId: String(updatedJob.id),
        reportUrl,
        feedbackUrl,
        feedbackStatus: 'pending',
        reviewUrl,
        reviewStatus: 'not_requested'
      });
    } catch (error) {
      console.warn('[closeCase] feedback record upsert failed', error.message);
    }
  }

  let notifiedJob = updatedJob;
  let lineResult = { ok: false, status: 'skipped', reason: 'no_line_user_id', messageId: '' };

  if (lineUserId) {
    const notifyJob = { ...updatedJob, line: { ...updatedJob.line, userId: lineUserId } };
    lineResult = await sendCaseResultNotification(notifyJob, {
      reportUrl,
      feedbackUrl,
      clientId: job.id
    });
    console.info('[line_close_notify]', {
      caseId: job.id,
      notionId: updatedJob.notionId,
      lineUserId,
      reportUrl,
      resultLinkUrl: lineResult.resultLinkUrl || null,
      feedbackUrl: feedbackUrl || null,
      format: lineResult.format || '',
      ok: lineResult.ok,
      status: lineResult.status,
      messageId: lineResult.messageId || '',
      error: lineResult.error || lineResult.reason || ''
    });

    const notificationPatch = lineResult.ok
      ? {
        notificationStatus: lineResult.status === 'mock_sent' ? 'sent' : lineResult.status,
        resultSentAt: now,
        lineMessageId: lineResult.messageId || '',
        lastNotificationError: ''
      }
      : {
        notificationStatus: 'failed',
        lastNotificationError: lineResult.error || lineResult.status || lineResult.reason || 'send_failed'
      };
    notifiedJob = await updateClient(job.notionId, notificationPatch);
  } else {
    console.info('[line_close_notify]', {
      caseId: updatedJob.id,
      notionId: updatedJob.notionId,
      status: 'skipped',
      reason: 'no_line_user_id',
      reportUrl
    });
  }

  return {
    ok: true,
    case: {
      id: notifiedJob.id,
      notionId: notifiedJob.notionId,
      name: notifiedJob.name,
      workflow: notifiedJob.workflow,
      result: notifiedJob.result,
      feedback: notifiedJob.feedback,
      review: notifiedJob.review,
      notification: notifiedJob.notification
    },
    feedbackRecord,
    line: lineResult
  };
}

async function getReportByToken(reportToken) {
  const jobs = await getAllClients();
  return jobs.find(job => job.result?.publicReportToken === reportToken) || null;
}

module.exports = {
  closeCase,
  getReportByToken,
  getFeedbackByToken,
  submitFeedback
};
