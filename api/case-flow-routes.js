const fs = require('fs');
const path = require('path');
const {
  closeCase,
  publishCaseScore,
  sendCaseResult,
  repairCaseResultNotification,
  createCase,
  submitCustomerPreassessment,
  createTestCase,
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

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://serviceportal.onrender.com').replace(/\/$/, '');
}

function reportFeedbackUrl(job) {
  const token = String(job?.feedback?.token || '').trim();
  if (token) return `${publicBaseUrl()}/f/${encodeURIComponent(token)}`;
  const raw = String(job?.feedback?.url || '').trim();
  if (!raw) return '';
  return raw.replace(/^https?:\/\/serviceportal\.example\.com/i, publicBaseUrl());
}

const ROOT_DIR = path.join(__dirname, '..');
let scorePagePartial = null;

function loadScorePagePartial() {
  if (!scorePagePartial) {
    scorePagePartial = fs.readFileSync(path.join(ROOT_DIR, 'src/pages/score.html'), 'utf8');
  }
  return scorePagePartial;
}

function reportNotFoundHtml() {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Report not found · Water Motion</title>
  <link rel="stylesheet" href="/src/css/styles.css">
</head>
<body>
  <div id="app">
    <div class="content">
      <div class="card">
        <h2 style="margin:0 0 8px">Report not found</h2>
        <p style="margin:0;color:var(--muted)">This report link may be expired or incorrect.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function reportReviewUrl(job) {
  return String(
    job?.review?.url
    || process.env.GOOGLE_REVIEW_URL
    || 'https://g.page/r/Ce0EFhVtUyRpEBM/review'
  ).trim();
}

function reportHtml(job) {
  if (!job) return reportNotFoundHtml();

  const token = String(job.result?.publicReportToken || '').trim();
  const feedbackUrl = reportFeedbackUrl(job);
  const reviewUrl = reportReviewUrl(job);
  const reportConfig = JSON.stringify({ token, feedbackUrl, reviewUrl }).replace(/</g, '\\u003c');
  const scoreMarkup = loadScorePagePartial();

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta name="theme-color" content="#0c0a09">
  <title>Water Score · Water Motion</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/src/css/styles.css">
</head>
<body class="public-report-mode">
  <div id="app">${scoreMarkup}</div>
  <script>window.__WM_PUBLIC_REPORT__ = ${reportConfig};</script>
  <script src="/src/js/state.js"></script>
  <script src="/src/js/i18n.js"></script>
  <script src="/src/js/common.js"></script>
  <script src="/src/js/flows/score.js"></script>
  <script src="/src/js/public-report.js"></script>
</body>
</html>`;
}

function scoreVisual(score) {
  const value = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
  const tier = value == null ? 'รอผลตรวจ' : value >= 90 ? 'Exceptional' : value >= 80 ? 'International' : value >= 65 ? 'Good' : value >= 50 ? 'Fair' : 'Needs Attention';
  const color = value == null ? '#78716c' : value >= 80 ? '#2e9b6f' : value >= 65 ? '#d9a441' : '#f07b7b';
  const degrees = value == null ? 0 : value * 3.6;
  return { value, tier, color, degrees };
}

function publicScoreHtml(job) {
  const score = scoreVisual(Number(job.result?.waterScore));
  const feedbackUrl = reportFeedbackUrl(job);
  return `<!doctype html><html lang="th"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0c0a09">
  <title>Water Score · Water Motion</title>
  <style>
  *{box-sizing:border-box}body{margin:0;background:#0c0a09;color:#fafaf9;font-family:Inter,Arial,sans-serif;line-height:1.5}main{width:min(100%,620px);margin:auto;padding:24px 18px 48px}.brand{font-size:13px;font-weight:800;letter-spacing:.16em;color:#6ee7b7;margin-bottom:24px}.card{background:linear-gradient(145deg,#1c1917,#151312);border:1px solid #292524;border-radius:24px;padding:28px 22px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.35)}h1{font-size:20px;margin:0 0 4px}.client{color:#a8a29e;margin:0 0 26px}.gauge{width:220px;aspect-ratio:1;margin:0 auto 24px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(${score.color} ${score.degrees}deg,#292524 0);position:relative}.gauge:before{content:"";position:absolute;inset:11px;background:#151312;border-radius:50%}.value{position:relative;font-size:64px;font-weight:800;line-height:1}.value small{display:block;font-size:12px;color:#a8a29e;margin-top:9px}.pill{display:inline-flex;padding:7px 14px;border-radius:99px;background:${score.color};color:#0c0a09;font-weight:800;font-size:13px}.summary{font-size:18px;font-weight:700;margin:24px 0 8px}.recommendation{color:#a8a29e;margin:0 auto;max-width:460px}.actions{display:grid;gap:10px;margin-top:24px}.button{display:flex;align-items:center;justify-content:center;min-height:50px;border-radius:12px;background:#2e9b6f;color:#fff;text-decoration:none;font-weight:800}.meta{font-size:12px;color:#57534e;margin-top:18px}@media(max-width:380px){.gauge{width:190px}.value{font-size:54px}.card{padding:24px 16px}}
  </style></head><body><main><div class="brand">WATER MOTION</div><section class="card">
  <h1>Water Score</h1><p class="client">${escapeHtml(job.name)}</p>
  <div class="gauge"><div class="value">${score.value == null ? '—' : score.value}<small>คะแนนจาก 100</small></div></div><div class="pill">${escapeHtml(score.tier)}</div>
  <p class="summary">${escapeHtml(job.result?.summary || 'ผลการตรวจคุณภาพน้ำพร้อมแล้ว')}</p>
  <p class="recommendation">${escapeHtml(job.result?.recommendations || 'Water Motion ใช้ผลตรวจหน้างานเพื่อประเมินคุณภาพน้ำของคุณ')}</p>
  ${feedbackUrl ? `<div class="actions"><a class="button" href="${escapeHtml(feedbackUrl)}">ให้คะแนนการบริการ</a></div>` : ''}
  <div class="meta">Water quality assessment by Water Motion</div></section></main></body></html>`;
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
  const submittedRating = Number(feedback.rating);
  const initialReviewShown = alreadySubmitted && Number.isFinite(submittedRating) && submittedRating >= 4;

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
  .review-link{display:${initialReviewShown ? 'inline-flex' : 'none'};align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;font-weight:800}
  .low-detail{display:${alreadySubmitted && !initialReviewShown ? 'block' : 'none'};padding:12px 14px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;margin-top:12px}
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
        <p id="thanks-message">${initialReviewShown ? 'Your feedback has been saved. If you are happy with the service, you can leave a Google review too.' : 'Your feedback has been saved. We would like to understand more so our team can follow up properly.'}</p>
        <a class="review-link" href="${reviewUrl}" target="_blank" rel="noopener noreferrer">Open Google Review</a>
        <div class="low-detail" id="low-detail">Please add any details in your comment, or contact Water Motion directly so we can help resolve the issue.</div>
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
      const reviewShown = data.reviewShown !== undefined ? Boolean(data.reviewShown) : selectedRating >= 4;
      const link = document.querySelector('.review-link');
      if (data.reviewUrl && link) link.href = data.reviewUrl;
      if (link) link.style.display = reviewShown ? 'inline-flex' : 'none';
      const detail = document.getElementById('low-detail');
      if (detail) detail.style.display = reviewShown ? 'none' : 'block';
      const message = document.getElementById('thanks-message');
      if (message) {
        message.textContent = reviewShown
          ? 'Your feedback has been saved. If you are happy with the service, you can leave a Google review too.'
          : 'Your feedback has been saved. We would like to understand more so our team can follow up properly.';
      }
      document.getElementById('form-wrap').style.display = 'none';
      document.getElementById('thanks').style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  </script>
</body>
</html>`;
}

async function handleCaseFlowRoute(req, res, urlPath) {
  const scoreMatch = urlPath.match(/^\/api\/cases\/([^/]+)\/score$/);
  if (scoreMatch && req.method === 'POST') {
    try {
      const result = await publishCaseScore(decodeURIComponent(scoreMatch[1]), await readJson(req));
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  if (urlPath === '/api/cases' && req.method === 'POST') {
    try {
      const result = await createCase(await readJson(req));
      sendJson(res, 201, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  if (urlPath === '/api/test/create-case' && req.method === 'POST') {
    const testApiEnabled = process.env.ENABLE_TEST_API === 'true' || process.env.NODE_ENV !== 'production';
    if (!testApiEnabled) {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return true;
    }
    try {
      const result = await createTestCase(await readJson(req));
      sendJson(res, 201, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  const preassessmentMatch = urlPath.match(/^\/api\/cases\/([^/]+)\/preassessment$/);
  if (preassessmentMatch && req.method === 'POST') {
    try {
      const result = await submitCustomerPreassessment(
        decodeURIComponent(preassessmentMatch[1]),
        await readJson(req)
      );
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

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

  const sendResultMatch = urlPath.match(/^\/api\/cases\/([^/]+)\/send-result$/);
  if (sendResultMatch && req.method === 'POST') {
    try {
      const result = await sendCaseResult(decodeURIComponent(sendResultMatch[1]), await readJson(req));
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  if (urlPath === '/api/cases/repair-notifications' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const caseId = body.caseId || body.id;
      if (!caseId) {
        sendJson(res, 400, { ok: false, error: 'caseId is required' });
        return true;
      }
      const result = await repairCaseResultNotification(caseId, body);
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
      const token = decodeURIComponent(feedbackApiMatch[1]);
      const payload = await readJson(req);
      const rating = Number(payload.rating);
      const result = await submitFeedback(token, payload);
      const reviewShown = result.reviewStatus === 'requested';
      console.info('[feedback_submit]', {
        token,
        rating: Number.isFinite(rating) ? rating : null,
        reviewShown
      });
      sendJson(res, 200, { ...result, reviewShown });
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
