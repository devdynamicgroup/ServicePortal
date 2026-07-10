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

async function sendLinePush(userId, messages) {
  if (!userId) {
    return { ok: false, status: 'missing_user_id', messageId: '' };
  }

  if (!isLineConfigured()) {
    if (process.env.LINE_MOCK_SEND === 'false') {
      return { ok: false, status: 'not_configured', messageId: '' };
    }
    return { ok: true, status: 'mock_sent', messageId: `mock-line-${Date.now()}` };
  }

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ to: userId, messages })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return { ok: false, status: 'failed', messageId: '', error: body || `LINE ${response.status}` };
  }

  const messageId = response.headers.get('x-line-request-id') || '';
  return { ok: true, status: 'sent', messageId };
}

async function sendLineReply(replyToken, messages) {
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
    return { ok: false, status: 'failed', error: body || `LINE ${response.status}` };
  }

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

function buildCaseResultTextMessage({ resultLinkUrl, feedbackUrl }) {
  const lines = [
    'ผลตรวจของคุณพร้อมแล้วครับ สามารถดูรายละเอียดได้ที่นี่',
    resultLinkUrl,
    feedbackUrl ? `ประเมินความพึงพอใจ: ${feedbackUrl}` : ''
  ].filter(Boolean);

  return { type: 'text', text: lines.join('\n') };
}

function buildCaseResultFlexMessage({ resultLinkUrl, feedbackUrl, clientName }) {
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

  if (feedbackUrl) {
    footerButtons.push({
      type: 'button',
      style: 'secondary',
      color: WATER_MOTION_BLUE,
      height: 'sm',
      action: {
        type: 'uri',
        label: 'ประเมินความพึงพอใจ',
        uri: feedbackUrl
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
                    text: 'กดปุ่มด้านล่างเพื่อเปิดดูรายละเอียดผลตรวจ และแจ้งความพึงพอใจหลังใช้บริการ',
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
  const resultLinkUrl = payload.reportUrl || job.result?.reportUrl || buildPreassessmentResultUrl(reportToken);
  const feedbackUrl = payload.feedbackUrl || job.feedback?.url || '';
  if (!resultLinkUrl) {
    return { ok: false, status: 'failed', messageId: '', error: 'missing_report_url' };
  }

  const messagePayload = {
    resultLinkUrl,
    feedbackUrl,
    clientName: String(job.name || '').replace(/\s+\S\.$/, '').trim()
  };
  const flexMessage = buildCaseResultFlexMessage(messagePayload);
  const textMessage = buildCaseResultTextMessage(messagePayload);

  const flexResult = await sendLinePush(userId, [flexMessage]);
  if (flexResult.ok) {
    return { ...flexResult, format: 'flex', resultLinkUrl, reportToken: String(reportToken || '') };
  }

  console.warn('[line_close_notify] flex push failed, falling back to text', {
    userId,
    reportToken,
    resultLinkUrl,
    feedbackUrl: feedbackUrl || null,
    error: flexResult.error || flexResult.status
  });

  const textResult = await sendLinePush(userId, [textMessage]);
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
  buildCaseResultFlexMessage,
  buildCaseResultTextMessage,
  sendCaseResultNotification
};
