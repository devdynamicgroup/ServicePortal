const {
  isLineConfigured,
  isLineWebhookConfigured,
  getLineChannelSecret,
  lineSignatureDebug,
  verifyLineSignature,
  sendLineReply,
  buildCaseResultFlexMessage,
  OA_POSTBACK,
  withQuickReply,
  buildLinkPromptTextMessage,
  buildFollowWelcomeMessage,
  buildBookAgainMessage,
  buildScoreHistoryFlexMessage,
  resolveResultLinkUrl
} = require('../services/line-notifications');
const {
  linkLineUser,
  sendCaseResult,
  markCaseResultNotificationFailed
} = require('../services/workflow-service');
const { buildFeedbackUrl } = require('../services/url-builder');
const { newCorrelationId, logLineLifecycle } = require('../services/observability');
const {
  resolveLineCustomerCases: resolveLineCustomerCasesDomain
} = require('../services/customer-domain/line-reader');

/** M7: shared inbound priority — 1 token, 2 postback, 3 intent, 4 default. */
function resolveInboundDecision(event) {
  if (!event || !event.type) {
    return { priority: 4, kind: 'ignore', reason: 'missing_event' };
  }
  if (event.type === 'message' && event.message?.type === 'text') {
    const messageText = event.message.text;
    const token = extractFeedbackToken(messageText);
    if (token) {
      return { priority: 1, kind: 'feedback_token', token, messageText };
    }
  }
  if (event.type === 'postback') {
    const intent = parseOaPostbackData(event.postback?.data);
    return {
      priority: 2,
      kind: intent ? 'postback' : 'postback_unknown',
      intent: intent || '',
      postbackData: String(event.postback?.data || '')
    };
  }
  if (event.type === 'message' && event.message?.type === 'text') {
    const messageText = event.message.text;
    const intent = detectOaIntent(messageText);
    if (intent) {
      return { priority: 3, kind: 'intent', intent, messageText };
    }
    return { priority: 4, kind: 'default', messageText };
  }
  if (event.type === 'follow') {
    return { priority: 4, kind: 'follow' };
  }
  return { priority: 4, kind: 'ignore', reason: 'unhandled_type', eventType: event.type };
}

async function sendReplyChecked(replyToken, messages, meta = {}) {
  const startedMs = Date.now();
  const replyResult = await sendLineReply(replyToken, messages);
  const base = {
    correlationId: meta.correlationId || newCorrelationId('line'),
    caseId: meta.caseId || null,
    lineUserId: meta.lineUserId || null,
    eventType: meta.eventType || null,
    action: meta.action || null,
    startedMs
  };
  if (replyResult?.ok) {
    logLineLifecycle('info', 'line_reply_ok', {
      ...base,
      success: true,
      durationMs: Date.now() - startedMs
    });
    return {
      handled: true,
      action: meta.action || 'replied',
      replyOk: true,
      correlationId: base.correlationId
    };
  }
  console.warn('[line_reply_failed]', {
    action: meta.action || null,
    lineUserId: meta.lineUserId || null,
    status: replyResult?.status || null,
    error: replyResult?.error || null
  });
  logLineLifecycle('error', 'line_reply_failed', {
    ...base,
    success: false,
    failureReason: replyResult?.error || replyResult?.status || 'reply_failed',
    durationMs: Date.now() - startedMs,
    extra: { replyStatus: replyResult?.status || null }
  });
  return {
    handled: true,
    action: 'handled_with_reply_failure',
    replyOk: false,
    replyStatus: replyResult?.status || 'failed',
    correlationId: base.correlationId,
    intendedAction: meta.action || null
  };
}

function logErrorStack(error) {
  return error?.stack || error?.message || String(error);
}

function scheduleBackground(task) {
  const run = () => {
    Promise.resolve()
      .then(() => task())
      .catch(error => {
        console.error('[line_background] unhandled', {
          error: error?.message || String(error),
          stack: logErrorStack(error)
        });
      });
  };

  // Prefer setImmediate so work runs after the current response I/O turn.
  // Do not use microtasks here — they can run before the HTTP response is flushed.
  if (typeof setImmediate === 'function') {
    setImmediate(run);
    return;
  }
  setTimeout(run, 0);
}

function runAfterResponse(res, task) {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    scheduleBackground(task);
  };

  // sendJson()/res.end() sets writableEnded before we schedule, so this path is normal.
  if (!res || res.writableEnded || res.finished) {
    start();
    return;
  }

  res.once('finish', start);
  res.once('close', start);
  // Last-resort fallback if finish/close never fire.
  setTimeout(start, 5000);
}

async function fetchLineDisplayName(userId) {
  const id = String(userId || '').trim();
  if (!id || !isLineConfigured()) return '';
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
    });
    if (!response.ok) return '';
    const profile = await response.json();
    return String(profile.displayName || '').trim();
  } catch {
    return '';
  }
}

const processedEvents = new Map();
const EVENT_TTL_MS = 10 * 60 * 1000;

function claimEvent(event) {
  const eventId = String(event?.webhookEventId || '');
  if (!eventId) return true;
  const now = Date.now();
  for (const [id, timestamp] of processedEvents) {
    if (now - timestamp > EVENT_TTL_MS) processedEvents.delete(id);
  }
  if (processedEvents.has(eventId)) return false;
  processedEvents.set(eventId, now);
  return true;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function normalizeLineMessageText(text) {
  return String(text || '').normalize('NFKC').trim();
}

function extractFeedbackToken(text) {
  const normalized = normalizeLineMessageText(text);
  const match = normalized.match(/\bfb-[a-z0-9-]+\b/i);
  return match ? match[0].toLowerCase() : '';
}

function parseOaPostbackData(data) {
  const raw = String(data || '').trim();
  if (raw === OA_POSTBACK.VIEW_LATEST || raw === 'view_latest') return 'view_latest';
  if (raw === OA_POSTBACK.HISTORY || raw === 'history') return 'history';
  if (raw === OA_POSTBACK.BOOK_AGAIN || raw === 'book_again') return 'book_again';
  return '';
}

/** M6 NL intents — token path always wins first in handleLineEvent. */
function detectOaIntent(text) {
  const normalized = normalizeLineMessageText(text).toLowerCase();
  if (!normalized) return '';

  if (
    /ดูผลตรวจ|ดูผลน้ำ|ขอดูผล|ผลตรวจล่าสุด|view\s*latest|latest\s*score|ดูคะแนนน้ำ|ผลตรวจน้ำ/.test(normalized)
  ) {
    return 'view_latest';
  }
  if (
    /ประวัติ|ผลก่อนหน้า|คะแนนก่อนหน้า|previous\s*scores?|history|ดูประวัติ/.test(normalized)
  ) {
    return 'history';
  }
  if (
    /นัดตรวจ|จองอีกครั้ง|book\s*again|นัดหมาย|จองตรวจ/.test(normalized)
  ) {
    return 'book_again';
  }
  return '';
}

function caseSortTimestamp(job) {
  return Date.parse(
    job?.notification?.resultSentAt
    || job?.workflow?.serviceCompletedAt
    || job?.workflow?.closedAt
    || job?.createdTime
    || 0
  ) || 0;
}

function caseHasReport(job) {
  return Boolean(String(job?.result?.publicReportToken || '').trim() || String(job?.result?.reportUrl || '').trim());
}

function formatCaseDateLabel(job) {
  const raw = job?.notification?.resultSentAt
    || job?.workflow?.serviceCompletedAt
    || job?.workflow?.closedAt
    || job?.createdTime
    || '';
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toISOString().slice(0, 10);
}

function toHistoryEntry(job) {
  const reportToken = String(job?.result?.publicReportToken || '').trim();
  const resultLinkUrl = reportToken
    ? resolveResultLinkUrl({ reportToken })
    : String(job?.result?.reportUrl || '').trim();
  return {
    waterScore: job?.result?.waterScore,
    dateLabel: formatCaseDateLabel(job),
    resultLinkUrl,
    clientName: job?.name || job?.clientName || ''
  };
}

async function resolveLineCustomerCases(lineUserId) {
  // M8.5: Customer-backed read when flagged; default OFF → Case LINE query only.
  // Reply shape unchanged: { linked, jobs, withReport, latest }.
  return resolveLineCustomerCasesDomain(lineUserId, {
    caseHasReport,
    caseSortTimestamp
  });
}

async function replyViewLatest(event, lineUserId, correlationId) {
  const resolved = await resolveLineCustomerCases(lineUserId);
  if (!resolved.linked) {
    return sendReplyChecked(event.replyToken, [buildLinkPromptTextMessage()], {
      correlationId,
      lineUserId,
      eventType: event.type,
      action: 'view_latest_need_link'
    });
  }
  if (!resolved.latest) {
    return sendReplyChecked(event.replyToken, [withQuickReply({
      type: 'text',
      text: 'ยังไม่พบผลตรวจที่พร้อมเปิดได้ เมื่อผลพร้อม ระบบจะส่งให้ทาง LINE อัตโนมัติ'
    })], {
      correlationId,
      lineUserId,
      eventType: event.type,
      action: 'view_latest_empty'
    });
  }

  const entry = toHistoryEntry(resolved.latest);
  const feedbackToken = String(resolved.latest?.feedback?.token || '').trim();
  const flex = buildCaseResultFlexMessage({
    resultLinkUrl: entry.resultLinkUrl,
    feedbackUrl: feedbackToken ? buildFeedbackUrl(feedbackToken) : (resolved.latest?.feedback?.url || ''),
    clientName: entry.clientName,
    waterScore: entry.waterScore
  });
  const result = await sendReplyChecked(event.replyToken, [
    withQuickReply({ type: 'text', text: 'ผลตรวจล่าสุดของคุณครับ' }),
    flex
  ], {
    correlationId,
    lineUserId,
    caseId: resolved.latest?.id || null,
    eventType: event.type,
    action: 'view_latest'
  });
  return { ...result, caseId: resolved.latest?.id || null };
}

async function replyHistory(event, lineUserId, correlationId) {
  const resolved = await resolveLineCustomerCases(lineUserId);
  if (!resolved.linked) {
    return sendReplyChecked(event.replyToken, [buildLinkPromptTextMessage()], {
      correlationId,
      lineUserId,
      eventType: event.type,
      action: 'history_need_link'
    });
  }
  if (!resolved.withReport.length) {
    return sendReplyChecked(event.replyToken, [withQuickReply({
      type: 'text',
      text: 'ยังไม่มีประวัติผลตรวจในระบบ'
    })], {
      correlationId,
      lineUserId,
      eventType: event.type,
      action: 'history_empty'
    });
  }

  const allWithReport = resolved.withReport;
  const entries = allWithReport.slice(0, 10).map(toHistoryEntry);
  const result = await sendReplyChecked(event.replyToken, [
    withQuickReply({ type: 'text', text: `พบ ${allWithReport.length} รายการผลตรวจ` }),
    buildScoreHistoryFlexMessage(entries)
  ], {
    correlationId,
    lineUserId,
    eventType: event.type,
    action: 'history'
  });
  return { ...result, count: allWithReport.length };
}

async function replyBookAgain(event, lineUserId, correlationId) {
  return sendReplyChecked(event.replyToken, [buildBookAgainMessage()], {
    correlationId,
    lineUserId: lineUserId || '',
    eventType: event.type,
    action: 'book_again'
  });
}

async function replyUnknownPostback(event, lineUserId, correlationId) {
  return sendReplyChecked(event.replyToken, [withQuickReply({
    type: 'text',
    text: 'ขออภัย กรุณาเลือกเมนูอีกครั้ง'
  })], {
    correlationId,
    lineUserId,
    eventType: event.type,
    action: 'postback_unknown'
  });
}

async function handleOaIntent(event, intent, lineUserId, correlationId) {
  if (intent === 'view_latest') return replyViewLatest(event, lineUserId, correlationId);
  if (intent === 'history') return replyHistory(event, lineUserId, correlationId);
  if (intent === 'book_again') return replyBookAgain(event, lineUserId, correlationId);
  return null;
}

async function handleLineEvent(event) {
  if (!event || !event.type) return { handled: false };
  if (!claimEvent(event)) {
    return { handled: true, action: 'duplicate_ignored', webhookEventId: event.webhookEventId };
  }

  const lineUserId = String(event.source?.userId || '').trim();
  const correlationId = newCorrelationId('line');
  const decision = resolveInboundDecision(event);
  logLineLifecycle('info', 'line_inbound_decision', {
    correlationId,
    lineUserId,
    eventType: event.type,
    success: true,
    action: decision.kind,
    extra: { priority: decision.priority, intent: decision.intent || null }
  });

  if (decision.kind === 'postback_unknown') {
    return replyUnknownPostback(event, lineUserId, correlationId);
  }

  if (decision.kind === 'postback') {
    return handleOaIntent(event, decision.intent, lineUserId, correlationId);
  }

  if (decision.kind === 'intent') {
    return handleOaIntent(event, decision.intent, lineUserId, correlationId);
  }

  if (decision.kind === 'default') {
    return sendReplyChecked(event.replyToken, [buildLinkPromptTextMessage()], {
      correlationId,
      lineUserId,
      eventType: event.type,
      action: 'asked_for_token'
    });
  }

  if (decision.kind === 'follow') {
    return sendReplyChecked(event.replyToken, [buildFollowWelcomeMessage()], {
      correlationId,
      lineUserId,
      eventType: event.type,
      action: 'follow_prompt'
    });
  }

  if (decision.kind === 'feedback_token') {
    const token = decision.token;
    const messageText = decision.messageText;
    console.info('[line_token_debug]', {
      id: 'line_token_debug',
      receivedMessageText: messageText,
      parsedToken: token || null,
      messageType: event.message?.type
    });

    const linked = await linkLineUser(
      token,
      lineUserId,
      await fetchLineDisplayName(lineUserId)
    );
    const reusableResultMessage = linked.alreadyLinked && linked.resultAvailable
      ? buildCaseResultFlexMessage({
        resultLinkUrl: linked.resultLinkUrl,
        feedbackUrl: linked.feedbackUrl,
        clientName: linked.clientName
      })
      : null;
    const replyText = linked.alreadyLinked
      ? 'บัญชี LINE นี้เชื่อมกับข้อมูลการรับบริการเรียบร้อยแล้ว'
      : linked.reason === 'linked_to_another_user'
        ? 'รหัสนี้ถูกเชื่อมกับบัญชี LINE อื่นแล้ว กรุณาติดต่อ Water Motion'
        : linked.linked && linked.pendingAutoSend
          ? 'เชื่อมต่อ LINE เรียบร้อยแล้วครับ\nกำลังเตรียมผลตรวจให้...'
          : linked.linked
            ? 'เชื่อมต่อ LINE เรียบร้อยแล้ว\nเมื่อผลตรวจพร้อม ระบบจะส่งให้ทาง LINE อัตโนมัติ'
            : 'ไม่พบรหัส fb-xxxx นี้ กรุณาตรวจสอบและลองอีกครั้ง';
    const replyStartedMs = Date.now();
    const replyStartedAt = new Date(replyStartedMs).toISOString();
    const replyMessages = reusableResultMessage
      ? [
        withQuickReply({ type: 'text', text: 'ผลตรวจของคุณพร้อมแล้วครับ' }),
        reusableResultMessage
      ]
      : [withQuickReply({ type: 'text', text: replyText })];
    const checked = await sendReplyChecked(event.replyToken, replyMessages, {
      correlationId,
      lineUserId,
      caseId: linked.caseId || linked.feedbackToken || token,
      eventType: event.type,
      action: 'link_token'
    });
    console.info('[line_webhook]', {
      caseId: linked.caseId || linked.feedbackToken || token,
      lineUserId,
      replyStartedAt,
      replySentAt: new Date().toISOString(),
      replyDurationMs: Date.now() - replyStartedMs,
      replyStatus: checked.replyStatus || (checked.replyOk ? 'sent' : 'failed'),
      replyOk: Boolean(checked.replyOk)
    });

    if (linked.linked) {
      console.info('[line_link_reply_sent]', {
        caseId: linked.caseId || linked.feedbackToken || token,
        lineUserId,
        reusableResult: Boolean(reusableResultMessage)
      });
    }

    let backgroundTask = null;
    if (linked.linked && linked.pendingAutoSend) {
      const caseId = linked.feedbackToken || token;
      backgroundTask = async () => {
        const startedMs = Date.now();
        const startedAt = new Date(startedMs).toISOString();
        console.info('[line_auto_send]', { caseId, lineUserId, startedAt });
        try {
          const result = await sendCaseResult(caseId);
          console.info('[line_auto_send]', {
            caseId,
            lineUserId,
            startedAt,
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - startedMs,
            action: result.action || '',
            notificationStatus: result.case?.notification?.status || '',
            lineStatus: result.line?.status || '',
            lineOk: Boolean(result.line?.ok)
          });
          logLineLifecycle('info', 'line_auto_send', {
            correlationId,
            caseId,
            lineUserId,
            eventType: 'auto_send',
            startedMs,
            success: Boolean(result.line?.ok),
            action: result.action || 'auto_send',
            failureReason: result.line?.ok ? null : (result.line?.status || 'send_failed')
          });
        } catch (error) {
          try {
            await markCaseResultNotificationFailed(caseId, error);
          } catch (markError) {
            console.error('[line_auto_send] failed to update notification status', {
              caseId,
              lineUserId,
              error: markError.message,
              stack: logErrorStack(markError)
            });
          }
          console.error('[line_auto_send]', {
            caseId,
            lineUserId,
            startedAt,
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - startedMs,
            error: error.message,
            stack: logErrorStack(error)
          });
          logLineLifecycle('error', 'line_auto_send', {
            correlationId,
            caseId,
            lineUserId,
            eventType: 'auto_send',
            startedMs,
            success: false,
            failureReason: error.message
          });
        }
      };
    }

    return {
      ...linked,
      handled: true,
      replyOk: Boolean(checked.replyOk),
      replyStatus: checked.replyStatus || (checked.replyOk ? 'sent' : 'failed'),
      correlationId,
      action: checked.replyOk ? 'link_token' : 'handled_with_reply_failure',
      intendedAction: 'link_token',
      backgroundTask
    };
  }

  return { handled: false, action: 'ignored', type: event.type, correlationId };
}

async function handleLineRoute(req, res, urlPath) {
  if (urlPath === '/api/line/status' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      channelId: process.env.LINE_CHANNEL_ID || null,
      hasChannelSecret: isLineWebhookConfigured(),
      channelSecretLength: isLineWebhookConfigured()
        ? getLineChannelSecret().length
        : 0,
      hasChannelAccessToken: isLineConfigured(),
      webhookUrl: `${(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '')}/api/line/webhook`
    });
    return true;
  }

  if (urlPath === '/api/line/webhook' && req.method === 'POST') {
    console.log('LINE WEBHOOK HIT');
    const rawBody = await readRawBody(req);
    const signatureHeader = req.headers['x-line-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const sigDebug = lineSignatureDebug(rawBody, signature);
    console.log('[line_sig_debug]', sigDebug);

    if (isLineWebhookConfigured() && !verifyLineSignature(rawBody, signature)) {
      console.warn('[line_sig_debug] signature mismatch', sigDebug);
      sendJson(res, 401, { ok: false, error: 'Invalid LINE signature', debug: sigDebug });
      return true;
    }

    try {
      const payload = JSON.parse(rawBody.length ? rawBody.toString('utf8') : '{}');
      const results = [];
      const backgroundTasks = [];
      for (const event of payload.events || []) {
        try {
          const result = await handleLineEvent(event);
          if (typeof result?.backgroundTask === 'function') {
            backgroundTasks.push(result.backgroundTask);
          }
          if (result && typeof result === 'object') {
            const publicResult = { ...result };
            delete publicResult.backgroundTask;
            results.push(publicResult);
          } else {
            results.push(result);
          }
        } catch (error) {
          if (event?.webhookEventId) processedEvents.delete(String(event.webhookEventId));
          throw error;
        }
      }
      sendJson(res, 200, { ok: true, results });
      // Always start auto-send AFTER the webhook HTTP 200 has been written.
      backgroundTasks.forEach(task => runAfterResponse(res, task));
    } catch (error) {
      console.warn('LINE webhook failed', error.message);
      sendJson(res, 500, { ok: false, error: 'Webhook processing failed' });
    }
    return true;
  }

  return false;
}

module.exports = { handleLineRoute };
