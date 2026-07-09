function isLineConfigured() {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN);
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

async function sendCaseResultNotification(job, payload) {
  const score = payload.score ?? job.result?.waterScore ?? '-';
  const reportUrl = payload.reportUrl || job.result?.reportUrl || '';
  const feedbackUrl = payload.feedbackUrl || job.feedback?.url || '';
  const text = [
    `Water Motion: ผลประเมินน้ำของคุณพร้อมแล้ว`,
    `คะแนนล่าสุด: ${score}/100`,
    reportUrl ? `ดูผลประเมิน: ${reportUrl}` : '',
    feedbackUrl ? `ให้คะแนนความพึงพอใจ: ${feedbackUrl}` : ''
  ].filter(Boolean).join('\n');

  return sendLinePush(job.line?.userId, [{ type: 'text', text }]);
}

module.exports = {
  isLineConfigured,
  sendLinePush,
  sendCaseResultNotification
};
