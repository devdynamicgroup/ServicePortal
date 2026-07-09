const crypto = require('crypto');

function isLineConfigured() {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN);
}

function isLineWebhookConfigured() {
  return Boolean(process.env.LINE_CHANNEL_SECRET);
}

function verifyLineSignature(rawBody, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET || '';
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const actual = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actual, expectedBuffer);
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

async function sendCaseResultNotification(job, payload) {
  const score = payload.score ?? job.result?.waterScore ?? '-';
  const reportUrl = payload.reportUrl || job.result?.reportUrl || '';
  const feedbackUrl = payload.feedbackUrl || job.feedback?.url || '';
  const text = [
    'Water Motion: your water assessment result is ready.',
    `Latest score: ${score}/100`,
    reportUrl ? `Report: ${reportUrl}` : '',
    feedbackUrl ? `Feedback: ${feedbackUrl}` : ''
  ].filter(Boolean).join('\n');

  return sendLinePush(job.line?.userId, [{ type: 'text', text }]);
}

module.exports = {
  isLineConfigured,
  isLineWebhookConfigured,
  verifyLineSignature,
  sendLinePush,
  sendLineReply,
  sendCaseResultNotification
};
