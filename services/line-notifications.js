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

function buildCaseResultTextMessage({ reportUrl, feedbackUrl }) {
  const lines = [
    'ผลตรวจของคุณพร้อมแล้วครับ สามารถดูรายละเอียดได้ที่นี่',
    reportUrl,
    feedbackUrl ? `ประเมินความพึงพอใจ: ${feedbackUrl}` : ''
  ].filter(Boolean);

  return { type: 'text', text: lines.join('\n') };
}

function buildCaseResultFlexMessage({ reportUrl, feedbackUrl }) {
  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: WATER_MOTION_BLUE,
      height: 'sm',
      action: {
        type: 'uri',
        label: 'ดูผลตรวจ',
        uri: reportUrl
      }
    }
  ];

  if (feedbackUrl) {
    footerButtons.push({
      type: 'button',
      style: 'secondary',
      height: 'sm',
      action: {
        type: 'uri',
        label: 'ประเมินความพึงพอใจ',
        uri: feedbackUrl
      }
    });
  }

  return {
    type: 'flex',
    altText: 'ผลตรวจของคุณพร้อมแล้วครับ',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'ผลตรวจของคุณพร้อมแล้วครับ',
            weight: 'bold',
            size: 'lg',
            color: '#ffffff',
            wrap: true
          }
        ],
        backgroundColor: WATER_MOTION_BLUE,
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: 'Water Motion',
            weight: 'bold',
            size: 'sm',
            color: WATER_MOTION_BLUE
          },
          {
            type: 'text',
            text: 'คุณสามารถดูรายละเอียดผลการตรวจน้ำได้จากปุ่มด้านล่าง',
            size: 'sm',
            color: '#78716c',
            wrap: true,
            margin: 'md'
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

  const reportUrl = payload.reportUrl || job.result?.reportUrl || '';
  const feedbackUrl = payload.feedbackUrl || job.feedback?.url || '';
  if (!reportUrl) {
    return { ok: false, status: 'failed', messageId: '', error: 'missing_report_url' };
  }

  const messagePayload = { reportUrl, feedbackUrl };
  const flexMessage = buildCaseResultFlexMessage(messagePayload);
  const textMessage = buildCaseResultTextMessage(messagePayload);

  const flexResult = await sendLinePush(userId, [flexMessage]);
  if (flexResult.ok) {
    return { ...flexResult, format: 'flex' };
  }

  console.warn('[line_close_notify] flex push failed, falling back to text', {
    userId,
    reportUrl,
    feedbackUrl: feedbackUrl || null,
    error: flexResult.error || flexResult.status
  });

  const textResult = await sendLinePush(userId, [textMessage]);
  return {
    ...textResult,
    format: textResult.ok ? 'text' : 'text_failed',
    flexError: flexResult.error || flexResult.status
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
  buildCaseResultFlexMessage,
  buildCaseResultTextMessage,
  sendCaseResultNotification
};
