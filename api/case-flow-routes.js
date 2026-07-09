const {
  closeCase,
  getReportByToken,
  getFeedbackByToken,
  submitFeedback
} = require('../services/case-flow');
const {
  getClientFeedbackStatus,
  ensureClientFeedbackSchema
} = require('../services/client-feedback');

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(html);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  return JSON.parse(raw);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function reportHtml(job) {
  if (!job) return '<!doctype html><meta charset="utf-8"><title>Report not found</title><p>Report not found.</p>';
  return `<!doctype html>
<html lang="th">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Water Motion Report</title>
<body style="font-family:Arial,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;line-height:1.5">
  <h1>Water Motion Report</h1>
  <h2>${escapeHtml(job.name)}</h2>
  <p><strong>Score:</strong> ${escapeHtml(job.result?.waterScore ?? '-')} / 100</p>
  <p>${escapeHtml(job.result?.summary || 'Assessment result is ready.')}</p>
  <p>${escapeHtml(job.result?.recommendations || '')}</p>
  ${job.feedback?.url ? `<p><a href="${escapeHtml(job.feedback.url)}">ให้คะแนนความพึงพอใจ</a></p>` : ''}
</body>
</html>`;
}

function feedbackHtml(feedback) {
  if (!feedback) return '<!doctype html><meta charset="utf-8"><title>Feedback not found</title><p>Feedback link not found.</p>';
  return `<!doctype html>
<html lang="th">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Client Feedback</title>
<body style="font-family:Arial,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;line-height:1.5">
  <h1>Client Feedback</h1>
  <p>ขอบคุณที่ใช้บริการ Water Motion</p>
  <form id="feedback-form">
    <label>Rating</label>
    <select name="rating" required style="display:block;width:100%;padding:12px;margin:8px 0 16px">
      <option value="">Please select</option>
      <option value="5">5 - Excellent</option>
      <option value="4">4 - Good</option>
      <option value="3">3 - Okay</option>
      <option value="2">2 - Needs work</option>
      <option value="1">1 - Poor</option>
    </select>
    <label>Comment</label>
    <textarea name="comment" rows="5" style="display:block;width:100%;padding:12px;margin:8px 0 16px"></textarea>
    <button type="submit" style="padding:12px 18px">Submit</button>
  </form>
  <p id="message"></p>
  <script>
    document.getElementById('feedback-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = { rating: form.rating.value, comment: form.comment.value };
      const res = await fetch('/api/feedback/${escapeHtml(feedback.feedbackToken)}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        document.getElementById('message').textContent = data.error || 'Could not submit feedback';
        return;
      }
      document.getElementById('message').innerHTML = 'ขอบคุณสำหรับ feedback <br><a href="' + data.reviewUrl + '">ไปที่ Google Review</a>';
      form.style.display = 'none';
    });
  </script>
</body>
</html>`;
}

async function handleCaseFlowRoute(req, res, urlPath) {
  const closeMatch = urlPath.match(/^\/api\/cases\/([^/]+)\/close$/);
  if (closeMatch && req.method === 'POST') {
    try {
      const result = await closeCase(decodeURIComponent(closeMatch[1]), await readJson(req));
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  if (urlPath === '/api/debug/client-feedback' && req.method === 'GET') {
    try {
      sendJson(res, 200, { ok: true, feedback: await getClientFeedbackStatus() });
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  if (urlPath === '/api/debug/client-feedback/sync-schema' && req.method === 'POST') {
    try {
      const result = await ensureClientFeedbackSchema();
      sendJson(res, 200, { ok: true, created: result.created, dataSourceId: result.dataSourceId });
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  const reportApiMatch = urlPath.match(/^\/api\/report\/([^/]+)$/);
  if (reportApiMatch && req.method === 'GET') {
    const report = await getReportByToken(decodeURIComponent(reportApiMatch[1]));
    sendJson(res, report ? 200 : 404, report ? { ok: true, report } : { ok: false, error: 'Report not found' });
    return true;
  }

  const feedbackApiMatch = urlPath.match(/^\/api\/feedback\/([^/]+)$/);
  if (feedbackApiMatch && req.method === 'GET') {
    const feedback = await getFeedbackByToken(decodeURIComponent(feedbackApiMatch[1]));
    sendJson(res, feedback ? 200 : 404, feedback ? { ok: true, feedback } : { ok: false, error: 'Feedback not found' });
    return true;
  }

  if (feedbackApiMatch && req.method === 'POST') {
    try {
      const result = await submitFeedback(decodeURIComponent(feedbackApiMatch[1]), await readJson(req));
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  const reportPageMatch = urlPath.match(/^\/r\/([^/]+)$/);
  if (reportPageMatch && req.method === 'GET') {
    const report = await getReportByToken(decodeURIComponent(reportPageMatch[1]));
    sendHtml(res, report ? 200 : 404, reportHtml(report));
    return true;
  }

  const feedbackPageMatch = urlPath.match(/^\/f\/([^/]+)$/);
  if (feedbackPageMatch && req.method === 'GET') {
    const feedback = await getFeedbackByToken(decodeURIComponent(feedbackPageMatch[1]));
    sendHtml(res, feedback ? 200 : 404, feedbackHtml(feedback));
    return true;
  }

  return false;
}

module.exports = { handleCaseFlowRoute };
