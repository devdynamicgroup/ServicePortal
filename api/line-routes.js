const {
  isLineConfigured,
  isLineWebhookConfigured,
  getLineChannelSecret,
  lineSignatureDebug,
  verifyLineSignature,
  sendLineReply
} = require('../services/line-notifications');
const { getFeedbackByToken } = require('../services/client-feedback');
const { updateClient } = require('../services/notion/clients');

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

async function linkLineUserFromToken(event, token) {
  const feedback = await getFeedbackByToken(token);
  if (!feedback?.clientPageId) {
    return { linked: false, reason: 'feedback_not_found' };
  }

  const lineUserId = event.source?.userId || '';
  if (!lineUserId) {
    return { linked: false, reason: 'missing_line_user_id' };
  }

  await updateClient(feedback.clientPageId, {
    lineUserId,
    lineLinked: true,
    lineLinkedAt: new Date().toISOString()
  });

  return {
    linked: true,
    clientPageId: feedback.clientPageId,
    feedbackToken: token,
    lineUserId
  };
}

async function handleLineEvent(event) {
  if (!event || !event.type) return { handled: false };

  if (event.type === 'message' && event.message?.type === 'text') {
    const messageText = event.message.text;
    const token = extractFeedbackToken(messageText);
    console.info('[line_token_debug]', {
      id: 'line_token_debug',
      receivedMessageText: messageText,
      parsedToken: token || null,
      messageType: event.message?.type
    });
    if (!token) {
      await sendLineReply(event.replyToken, [{
        type: 'text',
        text: 'Please send your feedback link token, for example fb-xxxx, to connect LINE with your service case.'
      }]);
      return { handled: true, action: 'asked_for_token' };
    }

    const linked = await linkLineUserFromToken(event, token);
    await sendLineReply(event.replyToken, [{
      type: 'text',
      text: linked.linked
        ? 'LINE connected. We can send your Water Motion result here.'
        : 'Could not find that feedback token. Please check the link and try again.'
    }]);
    return { handled: true, action: 'link_token', ...linked };
  }

  if (event.type === 'follow') {
    await sendLineReply(event.replyToken, [{
      type: 'text',
      text: 'Thanks for adding Water Motion. Send your feedback token, for example fb-xxxx, to connect this LINE account.'
    }]);
    return { handled: true, action: 'follow_prompt', lineUserId: event.source?.userId || '' };
  }

  return { handled: false, action: 'ignored', type: event.type };
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
      for (const event of payload.events || []) {
        results.push(await handleLineEvent(event));
      }
      sendJson(res, 200, { ok: true, results });
    } catch (error) {
      console.warn('LINE webhook failed', error.message);
      sendJson(res, 200, { ok: true, warning: error.message });
    }
    return true;
  }

  return false;
}

module.exports = { handleLineRoute };
