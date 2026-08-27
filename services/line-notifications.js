const crypto = require('crypto');
const { withRetry, isTransientHttpStatus } = require('./retry');
const { publicBaseUrl, buildReportUrl } = require('./url-builder');

function isLineConfigured() {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN);
}

function normalizeLineChannelSecret(raw) {
  let secret = String(raw || '').trim();
  if (
    (secret.startsWith('"') && secret.endsWith('"')) ||
    (secret.startsWith("'") && secret.endsWith("'"))
  ) {
    secret = secret.slice(1, -1).trim();
  }
  return secret;
}

function getLineChannelSecret() {
  return normalizeLineChannelSecret(process.env.LINE_CHANNEL_SECRET);
}

function isLineWebhookConfigured() {
  return Boolean(getLineChannelSecret());
}

function lineSignatureDebug(rawBody, signature) {
  const secret = getLineChannelSecret();
  const sig = String(signature || '').trim();
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  let calculatedLength = 0;
  if (secret) {
    calculatedLength = crypto.createHmac('sha256', secret).update(body).digest('base64').length;
  }
  return {
    id: 'line_sig_debug',
    hasSecret: Boolean(secret),
    secretLength: secret.length,
    receivedSignatureLength: sig.length,
    calculatedSignatureLength: calculatedLength,
    rawBodyLength: body.length,
    rawBodyIsBuffer: Buffer.isBuffer(rawBody)
  };
}

function verifyLineSignature(rawBody, signature) {
  const secret = getLineChannelSecret();
  const sig = String(signature || '').trim();
  if (!secret || !sig) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  let actual;
  try {
    actual = Buffer.from(sig, 'base64');
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

async function sendLinePush(userId, messages, logContext = {}) {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  if (!userId) {
    return { ok: false, status: 'missing_user_id', messageId: '' };
  }

  if (!isLineConfigured()) {
    // Fail closed by default: mock success must be an explicit opt-in
    // (LINE_MOCK_SEND=true, for local dev), never the default when a token
    // is simply missing. Proven runtime defect — the previous opt-out
    // default (`!== 'false'`) meant an unconfigured token in ANY
    // environment silently returned ok:true, and workflow-service.js
    // persists notificationStatus:'sent' to Notion on `Boolean(line.ok)`
    // alone — recording a customer as notified when no LINE API call ever
    // happened.
    if (process.env.LINE_MOCK_SEND === 'true') {
      return { ok: true, status: 'mock_sent', messageId: `mock-line-${Date.now()}` };
    }
    return { ok: false, status: 'not_configured', messageId: '' };
  }

  const payloadSummary = (messages || []).map(message => ({
    type: message?.type || 'unknown',
    altText: message?.altText || undefined,
    textPreview: message?.text ? String(message.text).slice(0, 80) : undefined
  }));

  console.info('[line_push] sending', {
    caseId: logContext.caseId || null,
    notionId: logContext.notionId || null,
    lineUserId: userId,
    reportUrl: logContext.reportUrl || null,
    startedAt,
    payloadSummary
  });

  let response;
  try {
    response = await withRetry(async () => {
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ to: userId, messages })
      });
      if (!res.ok && isTransientHttpStatus(res.status)) {
        const transientError = new Error(`LINE push transient failure ${res.status}`);
        transientError.status = res.status;
        throw transientError;
      }
      return res;
    });
  } catch (error) {
    console.info('[line_push] result', {
      caseId: logContext.caseId || null,
      notionId: logContext.notionId || null,
      httpStatus: error.status || null,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      retriesExhausted: true
    });
    return { ok: false, status: 'failed', messageId: '', error: error.message };
  }

  const responseBody = await response.text().catch(() => '');
  const requestId = response.headers.get('x-line-request-id') || '';

  console.info('[line_push] result', {
    caseId: logContext.caseId || null,
    notionId: logContext.notionId || null,
    httpStatus: response.status,
    responseBody: responseBody || null,
    requestId,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs
  });

  if (!response.ok) {
    return { ok: false, status: 'failed', messageId: '', error: responseBody || `LINE ${response.status}` };
  }

  return { ok: true, status: 'sent', messageId: requestId, responseBody };
}

async function sendLineReply(replyToken, messages) {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  if (!replyToken || !isLineConfigured()) {
    return { ok: false, status: isLineConfigured() ? 'missing_reply_token' : 'not_configured' };
  }

  let response;
  try {
    response = await withRetry(async () => {
      const res = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ replyToken, messages })
      });
      if (!res.ok && isTransientHttpStatus(res.status)) {
        const transientError = new Error(`LINE reply transient failure ${res.status}`);
        transientError.status = res.status;
        throw transientError;
      }
      return res;
    });
  } catch (error) {
    console.info('[line_reply] result', {
      httpStatus: error.status || null,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      ok: false,
      retriesExhausted: true
    });
    return { ok: false, status: 'failed', error: error.message };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.info('[line_reply] result', {
      httpStatus: response.status,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      ok: false
    });
    return { ok: false, status: 'failed', error: body || `LINE ${response.status}` };
  }

  console.info('[line_reply] result', {
    httpStatus: response.status,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    ok: true
  });
  return { ok: true, status: 'sent' };
}

const WATER_MOTION_BLUE = '#284dcd';
const WATER_MOTION_MUTED = '#78716c';
const WATER_MOTION_SURFACE = '#f8fafc';

function buildPreassessmentResultUrl(reportToken) {
  return buildReportUrl(reportToken);
}

function resolveResultLinkUrl({ reportToken }) {
  return buildReportUrl(reportToken);
}

function buildCaseResultTextMessage({ resultLinkUrl }) {
  const lines = [
    'ผลตรวจของคุณพร้อมแล้วครับ สามารถดูรายละเอียดได้ที่นี่',
    resultLinkUrl
  ].filter(Boolean);

  return { type: 'text', text: lines.join('\n') };
}

/** M6: OA quick-reply / rich-menu postback payloads (Manager-compatible). */
const OA_POSTBACK = Object.freeze({
  VIEW_LATEST: 'action=view_latest',
  HISTORY: 'action=history',
  BOOK_AGAIN: 'action=book_again',
  CONTACT_ADMIN: 'action=contact_admin'
});

function resolveLineBookingUrl() {
  return String(process.env.LINE_BOOKING_URL || 'https://www.water-motion.co').trim();
}

function buildOaQuickReplyItems() {
  return [
    {
      type: 'action',
      action: {
        type: 'postback',
        label: 'ดูผลตรวจ',
        data: OA_POSTBACK.VIEW_LATEST,
        displayText: 'ดูผลตรวจ'
      }
    },
    {
      type: 'action',
      action: {
        type: 'postback',
        label: 'ประวัติคะแนน',
        data: OA_POSTBACK.HISTORY,
        displayText: 'ประวัติคะแนน'
      }
    },
    {
      type: 'action',
      action: {
        type: 'uri',
        label: 'นัดตรวจ',
        uri: resolveLineBookingUrl()
      }
    }
  ];
}

function withQuickReply(message, items = buildOaQuickReplyItems()) {
  if (!message || typeof message !== 'object') return message;
  return {
    ...message,
    quickReply: { items: items.slice(0, 13) }
  };
}

/**
 * OA "view latest" reply — same rich card as Complete→LINE push
 * (header score + score-card hero + ดูผลตรวจ). History stays on replyHistory / menu.
 */
function buildViewLatestResultReply({ job, resultType, resultLinkUrl } = {}) {
  const reportToken = String(job?.result?.publicReportToken || '').trim();
  const reportUrl = String(resultLinkUrl || '').trim();

  // Keep menu actions except history — history remains via "ประวัติ" intent / rich menu.
  const quickReplyItems = buildOaQuickReplyItems().filter(
    (item) => item?.action?.data !== OA_POSTBACK.HISTORY
  );

  const textMessage = withQuickReply(
    { type: 'text', text: 'ผลตรวจน้ำของคุณพร้อมแล้วครับ' },
    quickReplyItems
  );

  if (!reportUrl) {
    return [textMessage];
  }

  const messagePayload = {
    resultLinkUrl: reportUrl,
    clientName: String(job?.name || '').replace(/\s+\S\.$/, '').trim(),
    waterScore: job?.result?.waterScore,
    scoreCardImageUrl: reportToken
      ? `${publicBaseUrl()}/api/public/score-card/${encodeURIComponent(reportToken)}?format=landscape`
      : '',
    resultType: resultType || 'paid_assessment'
  };

  const flexMessage = buildCaseResultFlexMessageForType(messagePayload, messagePayload.resultType);
  return [textMessage, flexMessage];
}

/**
 * Unknown/Unlinked Customer reply (2026-08-27, direct request): when the
 * OA cannot resolve any Case for this LINE userId -- never followed from
 * the QR/LIFF flow, or messaged the OA some other way -- the customer is
 * no longer asked to type fb-xxxx or any other code to "identify" their
 * Case. That was the exact anti-pattern being removed: guessing/recovering
 * a Case from a customer-typed code is not attempted here at all. Instead
 * they're handed two ways forward that need no Case lookup whatsoever:
 * start a new inspection on the existing website booking flow (reuses
 * resolveLineBookingUrl() -- no new site, no new Case-from-LINE, no new
 * token/entitlement), or hand the conversation to a human (no ticket
 * system -- LINE Official Account Manager's own chat inbox already lets
 * an admin take over any conversation manually; this just ends the
 * automated reply so there's nothing to conflict with).
 */
function buildUnknownCustomerReply() {
  return withQuickReply({
    type: 'text',
    text: 'สวัสดีครับ 👋\nตอนนี้ยังไม่พบข้อมูลการตรวจของคุณในระบบครับ\n\nหากต้องการตรวจคุณภาพน้ำ เริ่มต้นได้จากเว็บไซต์ของเราเลยครับ\nหากเคยใช้บริการแล้วแต่ยังไม่พบผลตรวจ ติดต่อเจ้าหน้าที่ได้เลยครับ'
  }, [
    {
      type: 'action',
      action: { type: 'uri', label: 'เริ่มตรวจคุณภาพน้ำ', uri: resolveLineBookingUrl() }
    },
    {
      type: 'action',
      action: {
        type: 'postback',
        label: 'ติดต่อเจ้าหน้าที่',
        data: OA_POSTBACK.CONTACT_ADMIN,
        displayText: 'ติดต่อเจ้าหน้าที่'
      }
    }
  ]);
}

/**
 * Ends the automated flow with a plain acknowledgment -- no case creation,
 * no code prompt, no ticket/queue infrastructure. Staff already see and
 * can reply to this conversation directly from LINE Official Account
 * Manager's own chat inbox; admin *notification* for this handoff is an
 * explicit future enhancement, not part of this change.
 */
function buildContactAdminAckMessage() {
  return {
    type: 'text',
    text: 'รับทราบครับ เดี๋ยวเจ้าหน้าที่จะติดต่อกลับโดยเร็วที่สุดครับ 🙏'
  };
}

/**
 * A LINKED customer's message just didn't match any known command/intent
 * -- distinct from buildUnknownCustomerReply(), which is only for when no
 * Case can be resolved for this LINE user at all. Nudges back to the
 * existing menu instead of implying they need to (re)connect.
 */
function buildUnrecognizedMenuPromptMessage() {
  return withQuickReply({
    type: 'text',
    text: 'ขออภัยครับ ไม่เข้าใจข้อความนี้ ลองเลือกจากเมนูด้านล่างได้เลยครับ'
  });
}

function buildFollowWelcomeMessage() {
  return withQuickReply({
    type: 'text',
    text: 'ยินดีต้อนรับสู่ Water Motion\nสแกน QR จากหน้าผลตรวจเพื่อเชื่อมบัญชีอัตโนมัติ หรือส่งรหัส fb-xxxx ก็ได้เช่นกัน'
  });
}

function buildBookAgainMessage() {
  const uri = resolveLineBookingUrl();
  return {
    type: 'text',
    text: `นัดตรวจคุณภาพน้ำอีกครั้งได้ที่นี่\n${uri}`,
    quickReply: {
      items: [
        {
          type: 'action',
          action: { type: 'uri', label: 'เปิดหน้าจอง', uri }
        },
        ...buildOaQuickReplyItems().filter(item => item.action?.type === 'postback')
      ].slice(0, 13)
    }
  };
}

function buildScoreHistoryFlexMessage(entries = []) {
  const rows = (Array.isArray(entries) ? entries : []).slice(0, 10);
  const contents = rows.length
    ? rows.map((entry, index) => {
      // Strict presence, not bare coercion: Number(null) is 0, which would
      // show "0" for a history entry that never actually got a score.
      const rawEntryScore = entry.waterScore;
      const score = rawEntryScore !== null
        && rawEntryScore !== undefined
        && Number.isFinite(Number(rawEntryScore))
        ? String(Math.round(Number(rawEntryScore)))
        : '—';
      const dateLabel = String(entry.dateLabel || entry.date || '—').slice(0, 32);
      const row = {
        type: 'box',
        layout: 'horizontal',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: dateLabel,
            size: 'sm',
            color: WATER_MOTION_MUTED,
            flex: 3,
            wrap: true
          },
          {
            type: 'text',
            text: score,
            size: 'sm',
            weight: 'bold',
            color: WATER_MOTION_BLUE,
            flex: 1,
            align: 'end'
          }
        ]
      };
      if (entry.resultLinkUrl) {
        return {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          margin: index === 0 ? 'none' : 'md',
          action: { type: 'uri', label: 'open', uri: entry.resultLinkUrl },
          contents: [row]
        };
      }
      return { ...row, margin: index === 0 ? 'none' : 'md' };
    })
    : [{
      type: 'text',
      text: 'ยังไม่มีประวัติผลตรวจ',
      size: 'sm',
      color: WATER_MOTION_MUTED,
      wrap: true
    }];

  return {
    type: 'flex',
    altText: 'ประวัติคะแนนน้ำ',
    contents: {
      type: 'bubble',
      size: 'mega',
      styles: {
        header: { backgroundColor: WATER_MOTION_BLUE },
        body: { backgroundColor: '#ffffff' }
      },
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'ประวัติคะแนนน้ำ',
            weight: 'bold',
            size: 'lg',
            color: '#ffffff'
          }
        ],
        paddingAll: '18px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents,
        paddingAll: '18px'
      }
    }
  };
}

function buildCaseResultFlexMessage({
  resultLinkUrl,
  feedbackUrl,
  clientName,
  scoreCardImageUrl,
  waterScore,
  resultType
}) {
  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: WATER_MOTION_BLUE,
      height: 'sm',
      action: {
        type: 'uri',
        label: 'ดูผลตรวจ',
        uri: resultLinkUrl
      }
    }
  ];

  const isFree = resultType === 'free_water_check';

  const greeting = clientName
    ? `สวัสดีคุณ ${clientName}`
    : (isFree ? 'ผลการตรวจน้ำเบื้องต้นพร้อมแล้ว' : 'ผลการตรวจน้ำพร้อมแล้ว');

  // Strict presence, not bare coercion -- see sendCaseResultNotification's
  // call site below, which now passes waterScore through un-coerced so a
  // real null still reaches here as null, not a pre-mangled 0.
  const scoreLabel = waterScore !== null && waterScore !== undefined && Number.isFinite(Number(waterScore))
    ? `Water Score ${Math.round(Number(waterScore))}/100`
    : (isFree ? 'ผลตรวจน้ำเบื้องต้นพร้อมแล้วครับ' : 'ผลตรวจของคุณพร้อมแล้วครับ');

  const bodyDetail = isFree
    ? 'ดูผลตรวจน้ำเบื้องต้นได้ด้านล่าง หากสนใจแพ็กเกจบริการหรือต้องการคำแนะนำเพิ่มเติม ติดต่อ Water Motion ได้เลยครับ'
    : 'กดปุ่มด้านล่างเพื่อเปิดดูรายละเอียดผลตรวจ และรีวิวบริการบน Google';

  const footerCaption = isFree
    ? 'Water Motion · Free Water Check'
    : 'Water Motion · บริการตรวจคุณภาพน้ำ';

  const bubble = {
    type: 'bubble',
    size: 'mega',
    styles: {
      header: { backgroundColor: WATER_MOTION_BLUE },
      body: { backgroundColor: '#ffffff' },
      footer: { backgroundColor: WATER_MOTION_SURFACE }
    },
    header: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: 'WATER MOTION',
          size: 'xs',
          color: '#bfdbfe',
          weight: 'bold'
        },
        {
          type: 'text',
          text: scoreLabel,
          weight: 'bold',
          size: 'xl',
          color: '#ffffff',
          wrap: true
        }
      ],
      paddingAll: '22px'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          spacing: 'md',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              width: '4px',
              height: '48px',
              backgroundColor: WATER_MOTION_BLUE,
              cornerRadius: '4px',
              flex: 0,
              contents: [{ type: 'filler' }]
            },
            {
              type: 'box',
              layout: 'vertical',
              flex: 1,
              spacing: 'sm',
              contents: [
                {
                  type: 'text',
                  text: greeting,
                  weight: 'bold',
                  size: 'md',
                  color: '#1c1917',
                  wrap: true
                },
                {
                  type: 'text',
                  text: bodyDetail,
                  size: 'sm',
                  color: WATER_MOTION_MUTED,
                  wrap: true
                }
              ]
            }
          ]
        },
        {
          type: 'separator',
          color: '#e7e5e1'
        },
        {
          type: 'text',
          text: footerCaption,
          size: 'xs',
          color: '#a8a29d',
          align: 'center'
        }
      ],
      paddingAll: '20px'
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: footerButtons,
      paddingAll: '16px'
    }
  };

  // Share-card hero for LINE — landscape 1200×630 template.
  if (scoreCardImageUrl) {
    bubble.hero = {
      type: 'image',
      url: scoreCardImageUrl,
      size: 'full',
      aspectRatio: '1200:630',
      aspectMode: 'cover',
      action: {
        type: 'uri',
        label: 'ดูผลตรวจ',
        uri: resultLinkUrl
      }
    };
  }

  return {
    type: 'flex',
    altText: scoreLabel,
    contents: bubble
  };
}

function buildCaseResultFlexMessageForType(payload, resultType) {
  return buildCaseResultFlexMessage({
    ...payload,
    resultType: resultType || 'paid_assessment'
  });
}

async function sendCaseResultNotification(job, payload) {
  const userId = String(job.line?.userId || '').trim();
  if (!userId) {
    return { ok: false, status: 'skipped', reason: 'no_line_user_id', messageId: '' };
  }

  const reportToken = payload.reportToken || job.result?.publicReportToken;
  const resultLinkUrl = resolveResultLinkUrl({ reportToken });
  const feedbackUrl = String(
    payload.feedbackUrl
    || job.feedback?.url
    || ''
  ).trim();
  if (!resultLinkUrl) {
    return { ok: false, status: 'failed', messageId: '', error: 'missing_report_url' };
  }

  // Lazy require avoids circular load with line-result-resolver helpers.
  const { resolveResultType, getAvailableResultForCase } = require('./line-result-resolver');
  const presented = getAvailableResultForCase(job);
  const resultType = presented.resultType || resolveResultType(job);

  const messagePayload = {
    resultLinkUrl,
    feedbackUrl,
    clientName: String(job.name || '').replace(/\s+\S\.$/, '').trim(),
    // Pass the raw value through -- do NOT coerce here. Number(null) is 0,
    // which would silently turn "no score yet" into a fake 0 before
    // buildCaseResultFlexMessage's own presence check ever sees it,
    // making that check a no-op (forensic investigation, 2026-08-25).
    waterScore: job.result?.waterScore,
    scoreCardImageUrl: reportToken
      ? `${publicBaseUrl()}/api/public/score-card/${encodeURIComponent(reportToken)}?format=landscape`
      : '',
    resultType
  };
  const flexMessage = buildCaseResultFlexMessageForType(messagePayload, resultType);
  const textMessage = buildCaseResultTextMessage(messagePayload);
  const logContext = {
    caseId: payload.caseId || job.id || null,
    notionId: payload.notionId || job.notionId || null,
    reportUrl: resultLinkUrl,
    resultType
  };

  const flexResult = await sendLinePush(userId, [flexMessage], logContext);
  if (flexResult.ok) {
    return {
      ...flexResult,
      format: 'flex',
      resultLinkUrl,
      reportToken: String(reportToken || ''),
      resultType
    };
  }

  console.warn('[line_close_notify] flex push failed, falling back to text', {
    userId,
    reportToken,
    resultLinkUrl,
    feedbackUrl: feedbackUrl || null,
    error: flexResult.error || flexResult.status
  });

  const textResult = await sendLinePush(userId, [textMessage], logContext);
  return {
    ...textResult,
    format: textResult.ok ? 'text' : 'text_failed',
    flexError: flexResult.error || flexResult.status,
    resultLinkUrl,
    reportToken: String(reportToken || ''),
    resultType
  };
}

module.exports = {
  isLineConfigured,
  isLineWebhookConfigured,
  getLineChannelSecret,
  lineSignatureDebug,
  verifyLineSignature,
  sendLinePush,
  sendLineReply,
  publicBaseUrl,
  buildPreassessmentResultUrl,
  resolveResultLinkUrl,
  buildCaseResultFlexMessage,
  buildCaseResultFlexMessageForType,
  buildCaseResultTextMessage,
  buildViewLatestResultReply,
  sendCaseResultNotification,
  OA_POSTBACK,
  resolveLineBookingUrl,
  buildOaQuickReplyItems,
  withQuickReply,
  buildUnknownCustomerReply,
  buildContactAdminAckMessage,
  buildUnrecognizedMenuPromptMessage,
  buildFollowWelcomeMessage,
  buildBookAgainMessage,
  buildScoreHistoryFlexMessage
};
