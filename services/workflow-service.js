const crypto = require('crypto');
const { getClient, updateClient, findClientByFeedbackToken } = require('./notion/clients');
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
  return (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://serviceportal.onrender.com').replace(/\/$/, '');
}

function normalizeReportUrl(reportToken) {
  const token = String(reportToken || '').trim();
  if (!token) return '';
  return `${publicBaseUrl()}/r/${encodeURIComponent(token)}`;
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

function notificationState(job) {
  return String(job?.notification?.status || 'not_sent').toLowerCase();
}

function resolveReportUrl(job, payload = {}) {
  const token = String(payload.reportToken || job?.result?.publicReportToken || '').trim();
  if (token) return normalizeReportUrl(token);
  const raw = String(payload.reportUrl || job?.result?.reportUrl || '').trim();
  if (raw.startsWith('/r/')) return `${publicBaseUrl()}${raw}`;
  return '';
}

function resolveFeedbackUrl(job, payload = {}) {
  const raw = String(payload.feedbackUrl || job?.feedback?.url || '').trim();
  if (raw.startsWith('https://') || raw.startsWith('http://')) return raw;
  if (raw.startsWith('/f/')) return `${publicBaseUrl()}${raw}`;
  const token = String(job?.feedback?.token || '').trim();
  if (token) return `${publicBaseUrl()}/f/${token}`;
  return '';
}

async function resolveJob(caseId) {
  const raw = String(caseId || '').trim();
  if (!raw) return null;

  if (/^fb-[a-z0-9-]+$/i.test(raw)) {
    const found = await findClientByFeedbackToken(raw.toLowerCase());
    if (!found?.clientPageId) return null;
    try { return await getClient(found.clientPageId); } catch { return null; }
  }

  if (/^[0-9a-f-]{32,36}$/i.test(raw)) {
    try { return await getClient(raw); } catch { return null; }
  }

  return null;
}

async function linkLineUser(feedbackToken, lineUserId, lineDisplayName = '') {
  const token = String(feedbackToken || '').trim().toLowerCase();
  const userId = String(lineUserId || '').trim();
  const displayName = String(lineDisplayName || '').trim();
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
      lineDisplayName: displayName,
      lineLinked: true,
      lineLinkedAt: now,
      caseWorkflowStatus: stateAtLeast(job.workflow?.status, 'line_linked') ? job.workflow.status : 'line_linked'
    });

    const freshJob = await getClient(feedback.clientPageId);
    const shouldAutoSend = stateAtLeast(freshJob.workflow?.status, 'completed')
      && notificationState(freshJob) !== 'sent';
    let autoSendResult = null;
    if (shouldAutoSend) {
      autoSendResult = await executeSendCaseResult(freshJob, {}, freshJob.id);
    }

    return {
      linked: true,
      alreadyLinked: false,
      clientPageId: feedback.clientPageId,
      lineUserId: userId,
      autoSendTriggered: shouldAutoSend,
      autoSendResult
    };
  });
}

async function executeSendCaseResult(job, payload = {}, caseId = job?.id) {
  const currentState = notificationState(job);
  const lineUserId = String(job?.line?.userId || '').trim();

  if (currentState === 'sent') {
    return {
      ok: true,
      idempotent: true,
      action: 'already_sent',
      case: job,
      line: { ok: true, status: 'sent', messageId: job.notification?.lineMessageId || '' }
    };
  }

  if (currentState === 'sending') {
    return {
      ok: true,
      idempotent: true,
      action: 'already_sending',
      case: job,
      line: { ok: false, status: 'sending', reason: 'already_sending' }
    };
  }

  if (!lineUserId) {
    return {
      ok: true,
      action: 'skipped',
      case: job,
      line: { ok: false, status: 'skipped', reason: 'no_line_user_id' }
    };
  }

  if (!stateAtLeast(job.workflow?.status, 'completed')) {
    const error = new Error('Case is not completed yet');
    error.statusCode = 409;
    throw error;
  }

  const now = new Date().toISOString();
  const reportToken = job.result?.publicReportToken || '';
  const reportUrl = resolveReportUrl(job, payload);
  const feedbackUrl = resolveFeedbackUrl(job, payload);

  if (!reportUrl) {
    const error = new Error('Report URL is missing for this case');
    error.statusCode = 422;
    throw error;
  }

  job = await updateClient(job.notionId, { notificationStatus: 'sending' });

  console.info('[line_close_notify] sending', {
    caseId,
    notionId: job.notionId,
    lineUserId,
    reportUrl,
    reportToken: reportToken || null,
    feedbackUrl: feedbackUrl || null,
    previousNotificationStatus: currentState
  });

  const line = await sendCaseResultNotification(job, {
    reportUrl,
    feedbackUrl,
    reportToken,
    caseId,
    notionId: job.notionId
  });
  const sent = Boolean(line.ok);

  job = await updateClient(job.notionId, sent ? {
    caseWorkflowStatus: 'result_sent',
    notificationStatus: 'sent',
    resultSentAt: now,
    lineMessageId: line.messageId || '',
    lastNotificationError: ''
  } : {
    notificationStatus: 'failed',
    lastNotificationError: line.error || line.reason || line.status || 'send_failed'
  });

  console.info('[line_close_notify] result', {
    caseId,
    notionId: job.notionId,
    ok: sent,
    status: line.status,
    format: line.format || '',
    messageId: line.messageId || '',
    error: line.error || line.reason || ''
  });

  return { ok: true, action: sent ? 'sent' : 'failed', case: job, line };
}

async function sendCaseResult(caseId, payload = {}) {
  const initial = await resolveJob(caseId);
  if (!initial?.notionId) {
    const error = new Error('Case not found');
    error.statusCode = 404;
    throw error;
  }

  return withCaseLock(initial.notionId, async () => {
    const job = await getClient(initial.notionId);
    return executeSendCaseResult(job, payload, initial.id);
  });
}

async function repairCaseResultNotification(caseId, payload = {}) {
  return sendCaseResult(caseId, payload);
}

async function closeCase(caseId, payload = {}) {
  const initial = await resolveJob(caseId);
  if (!initial?.notionId) {
    const error = new Error('Case not found');
    error.statusCode = 404;
    throw error;
  }

  return withCaseLock(initial.notionId, async () => {
    let job = await getClient(initial.notionId);
    const currentState = notificationState(job);
    const alreadyCompleted = stateAtLeast(job.workflow?.status, 'completed');
    const lineUserId = String(job.line?.userId || '').trim();

    if (alreadyCompleted && ['sending', 'sent'].includes(currentState)) {
      return {
        ok: true,
        idempotent: true,
        case: job,
        line: { ok: currentState === 'sent', status: currentState }
      };
    }

    if (alreadyCompleted && ['ready', 'failed', 'not_sent'].includes(currentState) && lineUserId) {
      const sendResult = await executeSendCaseResult(job, payload, initial.id);
      return { ...sendResult, repaired: true };
    }

    const now = new Date().toISOString();
    const reportToken = job.result?.publicReportToken || newToken('rpt');
    const feedbackToken = job.feedback?.token || newToken('fb');
    const reportUrl = normalizeReportUrl(reportToken);
    const feedbackUrl = `${publicBaseUrl()}/f/${feedbackToken}`;
    const reviewUrl = payload.reviewUrl || job.review?.url || process.env.GOOGLE_REVIEW_URL || DEFAULT_REVIEW_URL;
    const score = payload.score ?? job.result?.waterScore ?? job.draft?.scoreVal ?? null;

    job = await updateClient(job.notionId, {
      caseWorkflowStatus: 'completed',
      serviceCompletedAt: job.workflow?.serviceCompletedAt || now,
      closedAt: job.workflow?.closedAt || now,
      completedBy: payload.completedBy || payload.staffName || job.workflow?.completedBy || 'Water Motion Specialist',
      latestWaterScore: score,
      resultSummary: payload.resultSummary || job.result?.summary || (score ? `Water score ${score}/100. Please review the full report.` : 'Water assessment report is ready.'),
      recommendations: payload.recommendations || job.result?.recommendations || 'Please review the result and submit your satisfaction feedback.',
      reportUrl,
      publicReportToken: reportToken,
      feedbackToken,
      feedbackUrl,
      feedbackStatus: job.feedback?.status === 'submitted' ? 'submitted' : 'pending',
      reviewUrl,
      reviewStatus: job.review?.status || 'not_requested',
      notificationStatus: lineUserId ? 'ready' : 'not_sent'
    });

    let feedbackRecord = null;
    if (isClientFeedbackConfigured()) {
      try {
        feedbackRecord = await upsertFeedbackRecord({
          feedbackToken,
          title: `Feedback - ${job.name}`,
          clientPageId: job.notionId,
          clientName: job.name,
          clientPhone: job?.draft?.fields?.['ci-phone'] || '',
          caseId: String(initial.id),
          reportUrl,
          feedbackUrl,
          feedbackStatus: 'pending',
          reviewUrl,
          reviewStatus: 'not_requested'
        });
      } catch (error) {
        console.warn('[workflow] feedback upsert failed', error.message);
      }
    }

    if (!lineUserId) {
      return {
        ok: true,
        case: job,
        feedbackRecord,
        line: { ok: false, status: 'skipped', reason: 'no_line_user_id' }
      };
    }

    const sendResult = await executeSendCaseResult(job, { reportUrl, feedbackUrl, reportToken }, initial.id);
    return { ...sendResult, feedbackRecord };
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

module.exports = {
  WORKFLOW_STATES,
  stateAtLeast,
  canTransition,
  linkLineUser,
  closeCase,
  sendCaseResult,
  repairCaseResultNotification,
  recordFeedback,
  resolveJob
};
