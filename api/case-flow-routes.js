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

function customerFeedbackHtml(feedback) {
  if (!feedback) {
    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Feedback not found</title>
<body style="font-family:Arial,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;line-height:1.5;color:#1c1917;background:#fafaf9">
  <h1>Feedback link not found</h1>
  <p style="color:#78716c">This feedback link may be expired or incorrect. Please contact Water Motion.</p>
</body>
</html>`;
  }

  const token = escapeHtml(feedback.feedbackToken);
  const clientName = escapeHtml(feedback.clientName || 'Water Motion customer');
  const reviewUrl = escapeHtml(feedback.reviewUrl || 'https://g.page/r/Ce0EFhVtUyRpEBM/review');
  const alreadySubmitted = feedback.feedbackStatus === 'submitted';

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Water Motion Feedback</title>
<style>
  :root{color-scheme:light;--bg:#fafaf9;--card:#fff;--text:#1c1917;--muted:#78716c;--line:#e7e5e1;--accent:#0f766e;--accent-soft:#ccfbf1}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);font-family:Arial,Helvetica,sans-serif;color:var(--text);line-height:1.5}
  main{width:min(100%,620px);margin:0 auto;padding:28px 18px 44px}
  .brand{font-weight:800;font-size:15px;letter-spacing:.04em;text-transform:uppercase;color:var(--accent);margin-bottom:18px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:22px;box-shadow:0 8px 24px rgba(28,25,23,.06)}
  h1{font-size:26px;line-height:1.15;margin:0 0 8px}
  p{margin:0 0 16px;color:var(--muted)}
  label{display:block;font-weight:700;margin:18px 0 8px}
  .stars{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:4px}
  .star{height:48px;border:1px solid var(--line);border-radius:8px;background:#fff;color:#a8a29e;font-size:24px;cursor:pointer}
  .star.sel,.star:hover{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}
  textarea{width:100%;min-height:116px;border:1px solid var(--line);border-radius:8px;padding:12px;font:inherit;resize:vertical}
  .hint{font-size:13px;color:var(--muted);margin-top:4px}
  .error{display:none;color:#b91c1c;background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin:14px 0}
  .actions{margin-top:18px;display:flex;gap:10px;align-items:center}
  button.submit{width:100%;height:48px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-weight:800;font-size:16px;cursor:pointer}
  button.submit:disabled{opacity:.55;cursor:not-allowed}
  .thanks{display:${alreadySubmitted ? 'block' : 'none'}}
  .form-wrap{display:${alreadySubmitted ? 'none' : 'block'}}
  .review-link{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;font-weight:800}
  .meta{font-size:13px;color:var(--muted);margin-top:14px}
</style>
<body>
  <main>
    <div class="brand">Water Motion</div>
    <section class="card">
      <div class="form-wrap" id="form-wrap">
        <h1>How was your service?</h1>
        <p>Thanks, ${clientName}. Please rate your Water Motion experience.</p>
        <form id="feedback-form">
          <label>Rating</label>
          <div class="stars" role="radiogroup" aria-label="Rating">
            <button class="star" type="button" data-rating="1" aria-label="1 star">★</button>
            <button class="star" type="button" data-rating="2" aria-label="2 stars">★</button>
            <button class="star" type="button" data-rating="3" aria-label="3 stars">★</button>
            <button class="star" type="button" data-rating="4" aria-label="4 stars">★</button>
            <button class="star" type="button" data-rating="5" aria-label="5 stars">★</button>
          </div>
          <div class="hint">Select 1 to 5 stars.</div>
          <input id="rating" name="rating" type="hidden" required>
          <label for="comment">Comment <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
          <textarea id="comment" name="comment" maxlength="1200" placeholder="Tell us what went well or what we can improve."></textarea>
          <div class="error" id="error"></div>
          <div class="actions">
            <button class="submit" id="submit-btn" type="submit">Submit feedback</button>
          </div>
        </form>
      </div>
      <div class="thanks" id="thanks">
        <h1>Thank you</h1>
        <p>Your feedback has been saved. If you are happy with the service, you can leave a Google review too.</p>
        <a class="review-link" href="${reviewUrl}" target="_blank" rel="noopener noreferrer">Open Google Review</a>
        <div class="meta">Feedback token: ${token}</div>
      </div>
    </section>
  </main>
  <script>
    let selectedRating = 0;
    const errorBox = document.getElementById('error');
    const submitBtn = document.getElementById('submit-btn');
    const ratingInput = document.getElementById('rating');
    const stars = Array.from(document.querySelectorAll('.star'));

    function setError(message) {
      errorBox.textContent = message || '';
      errorBox.style.display = message ? 'block' : 'none';
    }

    function setRating(value) {
      selectedRating = Number(value) || 0;
      ratingInput.value = selectedRating ? String(selectedRating) : '';
      stars.forEach(star => {
        const active = Number(star.dataset.rating) <= selectedRating;
        star.classList.toggle('sel', active);
        star.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      setError('');
    }

    stars.forEach(star => {
      star.addEventListener('click', () => setRating(star.dataset.rating));
    });

    document.getElementById('feedback-form').addEventListener('submit', async event => {
      event.preventDefault();
      if (!selectedRating) {
        setError('Please select a rating before submitting.');
        return;
      }
      submitBtn.disabled = true;
      setError('');
      const payload = {
        rating: selectedRating,
        comment: document.getElementById('comment').value.trim()
      };
      const res = await fetch('/api/feedback/${token}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        submitBtn.disabled = false;
        setError(data.error || 'Could not submit feedback. Please try again.');
        return;
      }
      const link = document.querySelector('.review-link');
      if (data.reviewUrl && link) link.href = data.reviewUrl;
      document.getElementById('form-wrap').style.display = 'none';
      document.getElementById('thanks').style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
    sendHtml(res, feedback ? 200 : 404, customerFeedbackHtml(feedback));
    return true;
  }

  return false;
}

module.exports = { handleCaseFlowRoute };
