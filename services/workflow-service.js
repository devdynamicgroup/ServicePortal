const crypto = require('crypto');
const { getAllClients, getClient, updateClient } = require('./notion/clients');
const {
  upsertFeedbackRecord,
  getFeedbackByToken,
  isClientFeedbackConfigured
} = require('./client-feedback');
const { sendCaseResultNotification } = require('./line-notifications');

const DEFAULT_REVIEW_URL = 'https://g.page/r/Ce0EFhVtUyRpEBM/review';
const WORKFLOW_STATES = Object.freeze([
  'created', 'line_linked', 'service_in_progress', 'completed',
  'result_sent', 'feedback_submitted', 'review_requested', 'closed'
]);
const locks = new Map();

function withCaseLock(key, operation) {
  const lockKey = String(key || 'unknown');
  const previous = locks.get(lockKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  locks.set(lockKey, current);
  return current.finally(() => {
    if (locks.get(lockKey) === current) locks.delete(lockKey);
  });
}

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://serviceportal.example.com').replace(/\/$/, '');
}

function newToken(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

function stateRank(state) {
  return WORKFLOW_STATES.indexOf(String(state || '').toLowerCase());
}

function stateAtLeast(state, expected) {
  return stateRank(state) >= stateRank(expected);
}

function canTransition(from, to) {
  const fromRank = stateRank(from);
  const toRank = stateRank(to);
  if (toRank < 0) return false;
  if (fromRank < 0) return to === 'created' || to === 'line_linked';
  return toRank === fromRank || toRank === fromRank + 1;
}

async function resolveJob(caseId) {
  if (!caseId) return null;
  if (/^[0-9a-f-]{32,36}$/i.test(caseId)) {
    try { return await getClient(caseId); } catch { return null; }
  }
  const jobs = await getAllClients();
  return jobs.find(job => String(job.id) === String(caseId) || String(job.notionId) === String(caseId)) || null;
}

async function linkLineUser(feedbackToken, lineUserId) {
  const token = String(feedbackToken || '').trim().toLowerCase();
  const userId = String(lineUserId || '').trim();
  const feedback = await getFeedbackByToken(token);
  if (!feedback?.clientPageId) return { linked: false, reason: 'feedback_not_found' };
  if (!userId) return { linked: false, reason: 'missing_line_user_id' };

  return withCaseLock(feedback.clientPageId, async () => {
    const job = await getClient(feedback.clientPageId);
    const currentUserId = String(job?.line?.userId || '').trim();
    if (job?.line?.linked || currentUserId) {
      return currentUserId === userId
        ? { linked: true, alreadyLinked: true, reason: 'already_linked', clientPageId: feedback.clientPageId }
        : { linked: false, reason: 'linked_to_another_user', clientPageId: feedback.clientPageId };
    }

    const now = new Date().toISOString();
    await updateClient(feedback.clientPageId, {
      lineUserId: userId,
      lineLinked: true,
      lineLinkedAt: now,
      caseWorkflowStatus: stateAtLeast(job.workflow?.status, 'line_linked') ? job.workflow.status : 'line_linked'
    });
    return { linked: true, alreadyLinked: false, clientPageId: feedback.clientPageId, lineUserId: userId };
  });
}

async function closeCase(caseId, payload = {}) {
  const initial = await resolveJob(caseId);
  if (!initial?.notionId) {
    const error = new Error('Case not found'); error.statusCode = 404; throw error;
  }

  return withCaseLock(initial.notionId, async () => {
    let job = await getClient(initial.notionId);
    const notificationState = String(job.notification?.status || 'not_sent');
    if (stateAtLeast(job.workflow?.status, 'completed') && ['sending', 'sent'].includes(notificationState)) {
      return { ok: true, idempotent: true, case: job, line: { ok: notificationState === 'sent', status: notificationState } };
    }

    const now = new Date().toISOString();
    const reportToken = job.result?.publicReportToken || newToken('rpt');
    const feedbackToken = job.feedback?.token || newToken('fb');
    const reportUrl = `${publicBaseUrl()}/r/${reportToken}`;
    const feedbackUrl = `${publicBaseUrl()}/f/${feedbackToken}`;
    const reviewUrl = payload.reviewUrl || job.review?.url || process.env.GOOGLE_REVIEW_URL || DEFAULT_REVIEW_URL;
    const score = payload.score ?? job.result?.waterScore ?? job.draft?.scoreVal ?? null;
    const lineUserId = String(job.line?.userId || '').trim();

    job = await updateClient(job.notionId, {
      caseWorkflowStatus: 'completed', serviceCompletedAt: job.workflow?.serviceCompletedAt || now,
      closedAt: job.workflow?.closedAt || now,
      completedBy: payload.completedBy || payload.staffName || job.workflow?.completedBy || 'Water Motion Specialist',
      latestWaterScore: score,
      resultSummary: payload.resultSummary || job.result?.summary || (score ? `Water score ${score}/100. Please review the full report.` : 'Water assessment report is ready.'),
      recommendations: payload.recommendations || job.result?.recommendations || 'Please review the result and submit your satisfaction feedback.',
      reportUrl, publicReportToken: reportToken, feedbackToken, feedbackUrl,
      feedbackStatus: job.feedback?.status === 'submitted' ? 'submitted' : 'pending',
      reviewUrl, reviewStatus: job.review?.status || 'not_requested',
      notificationStatus: lineUserId ? 'sending' : 'not_sent'
    });

    let feedbackRecord = null;
    if (isClientFeedbackConfigured()) {
      try {
        feedbackRecord = await upsertFeedbackRecord({
          feedbackToken, title: `Feedback - ${job.name}`, clientPageId: job.notionId,
          clientName: job.name, clientPhone: job?.draft?.fields?.['ci-phone'] || '',
          caseId: String(job.id), reportUrl, feedbackUrl, feedbackStatus: 'pending', reviewUrl,
          reviewStatus: 'not_requested'
        });
      } catch (error) { console.warn('[workflow] feedback upsert failed', error.message); }
    }

    if (!lineUserId) return { ok: true, case: job, feedbackRecord, line: { ok: false, status: 'skipped', reason: 'no_line_user_id' } };

    const line = await sendCaseResultNotification(job, { reportUrl, feedbackUrl });
    const sent = Boolean(line.ok);
    job = await updateClient(job.notionId, sent ? {
      caseWorkflowStatus: 'result_sent', notificationStatus: 'sent', resultSentAt: now,
      lineMessageId: line.messageId || '', lastNotificationError: ''
    } : {
      notificationStatus: 'failed', lastNotificationError: line.error || line.reason || line.status || 'send_failed'
    });
    return { ok: true, case: job, feedbackRecord, line };
  });
}

async function recordFeedback(token, payload = {}) {
  const current = await getFeedbackByToken(token);
  if (!current) { const error = new Error('Feedback link not found'); error.statusCode = 404; throw error; }
  const rating = Number(payload.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    const error = new Error('Rating must be between 1 and 5'); error.statusCode = 400; throw error;
  }

  return withCaseLock(current.clientPageId || token, async () => {
    const fresh = await getFeedbackByToken(token);
    if (fresh?.feedbackStatus === 'submitted') {
      return { ok: true, idempotent: true, reviewUrl: fresh.reviewUrl, feedbackStatus: 'submitted', reviewStatus: fresh.reviewStatus };
    }
    const now = new Date().toISOString();
    const requestReview = rating >= 4;
    await upsertFeedbackRecord({ ...fresh, title: `Feedback - ${fresh.clientName || token}`,
      rating, comment: payload.comment || '', submittedAt: now, feedbackStatus: 'submitted',
      reviewStatus: requestReview ? 'requested' : 'not_requested',
      reviewRequestedAt: requestReview ? now : undefined });
    if (fresh.clientPageId) {
      await updateClient(fresh.clientPageId, {
        feedbackRating: rating, feedbackComment: payload.comment || '', feedbackSubmittedAt: now,
        feedbackStatus: 'submitted', caseWorkflowStatus: requestReview ? 'review_requested' : 'feedback_submitted',
        reviewRequestedAt: requestReview ? now : undefined,
        reviewStatus: requestReview ? 'requested' : 'not_requested'
      });
    }
    return { ok: true, reviewUrl: fresh.reviewUrl, feedbackStatus: 'submitted', reviewStatus: requestReview ? 'requested' : 'not_requested' };
  });
}

module.exports = { WORKFLOW_STATES, stateAtLeast, canTransition, linkLineUser, closeCase, recordFeedback, resolveJob };
