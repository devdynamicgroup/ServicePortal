const crypto = require('crypto');

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
    if (process.env.LINE_MOCK_SEND === 'false') {
      return { ok: false, status: 'not_configured', messageId: '' };
    }
    return { ok: true, status: 'mock_sent', messageId: `mock-line-${Date.now()}` };
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

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ to: userId, messages })
  });

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

  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ replyToken, messages })
  });

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

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://serviceportal.onrender.com').replace(/\/$/, '');
}

function buildPreassessmentResultUrl(reportToken) {
  const token = String(reportToken ?? '').trim();
  if (!token) return '';
  return `${publicBaseUrl()}/r/${encodeURIComponent(token)}`;
}

function resolveResultLinkUrl({ reportToken }) {
  const token = String(reportToken || '').trim();
  if (!token) return '';
  return `${publicBaseUrl()}/r/${encodeURIComponent(token)}`;
}

function buildCaseResultTextMessage({ resultLinkUrl, reviewUrl }) {
  const lines = [
    'ผลตรวจของคุณพร้อมแล้วครับ สามารถดูรายละเอียดได้ที่นี่',
    resultLinkUrl,
    reviewUrl ? `รีวิวบน Google: ${reviewUrl}` : ''
  ].filter(Boolean);

  return { type: 'text', text: lines.join('\n') };
}

function buildCaseResultFlexMessage({ resultLinkUrl, reviewUrl, clientName }) {
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

  if (reviewUrl) {
    footerButtons.push({
      type: 'button',
      style: 'secondary',
      color: WATER_MOTION_BLUE,
      height: 'sm',
      action: {
        type: 'uri',
        label: 'รีวิวบน Google',
        uri: reviewUrl
      }
    });
  }

  const greeting = clientName
    ? `สวัสดีคุณ ${clientName}`
    : 'ผลการตรวจน้ำพร้อมแล้ว';

  return {
    type: 'flex',
    altText: 'ผลตรวจของคุณพร้อมแล้วครับ',
    contents: {
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
            text: 'ผลตรวจของคุณพร้อมแล้วครับ',
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
                    text: 'กดปุ่มด้านล่างเพื่อเปิดดูรายละเอียดผลตรวจ และรีวิวบริการบน Google',
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
            text: 'Water Motion · บริการตรวจคุณภาพน้ำ',
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
    }
  };
}

async function sendCaseResultNotification(job, payload) {
  const userId = String(job.line?.userId || '').trim();
  if (!userId) {
    return { ok: false, status: 'skipped', reason: 'no_line_user_id', messageId: '' };
  }

  const reportToken = payload.reportToken || job.result?.publicReportToken;
  const resultLinkUrl = resolveResultLinkUrl({ reportToken });
  const reviewUrl = String(
    payload.reviewUrl
    || job.review?.url
    || process.env.GOOGLE_REVIEW_URL
    || 'https://g.page/r/Ce0EFhVtUyRpEBM/review'
  ).trim();
  if (!resultLinkUrl) {
    return { ok: false, status: 'failed', messageId: '', error: 'missing_report_url' };
  }

  const messagePayload = {
    resultLinkUrl,
    reviewUrl,
    clientName: String(job.name || '').replace(/\s+\S\.$/, '').trim()
  };
  const flexMessage = buildCaseResultFlexMessage(messagePayload);
  const textMessage = buildCaseResultTextMessage(messagePayload);
  const logContext = {
    caseId: payload.caseId || job.id || null,
    notionId: payload.notionId || job.notionId || null,
    reportUrl: resultLinkUrl
  };

  const flexResult = await sendLinePush(userId, [flexMessage], logContext);
  if (flexResult.ok) {
    return { ...flexResult, format: 'flex', resultLinkUrl, reportToken: String(reportToken || '') };
  }

  console.warn('[line_close_notify] flex push failed, falling back to text', {
    userId,
    reportToken,
    resultLinkUrl,
    reviewUrl: reviewUrl || null,
    error: flexResult.error || flexResult.status
  });

  const textResult = await sendLinePush(userId, [textMessage], logContext);
  return {
    ...textResult,
    format: textResult.ok ? 'text' : 'text_failed',
    flexError: flexResult.error || flexResult.status,
    resultLinkUrl,
    reportToken: String(reportToken || '')
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
  buildCaseResultTextMessage,
  sendCaseResultNotification
};
