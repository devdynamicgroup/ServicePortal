const fs = require('fs');
const path = require('path');
const {
  closeCase,
  startCase,
  publishCaseScore,
  sendCaseResult,
  repairCaseResultNotification,
  createCase,
  submitCustomerPreassessment,
  createTestCase,
  cancelAppointment,
  getReportByToken,
  getFeedbackByToken,
  submitFeedback,
  submitCaseFeedback
} = require('../services/case-flow');
const {
  submitCaseAssessment
} = require('../services/assessment-persistence-service');
const {
  submitCaseScoreStandard
} = require('../services/case-score-standard-service');
const {
  getClientFeedbackStatus,
  ensureClientFeedbackSchema
} = require('../services/client-feedback');
const { fingerprint, withIdempotency, wasReplayed } = require('../services/idempotency-store');
const { newCorrelationId, logEvent } = require('../services/observability');
const { publicBaseUrl } = require('../services/url-builder');
const { assertAppAuth } = require('../services/app-auth');

const BOOKING_IDEMPOTENCY_TTL_MS = 30 * 1000;

// Derives a dedup key for a booking submission so double-click / page-refresh /
// browser resubmission of the exact same booking within the TTL window replays
// the first result instead of creating a second Notion case. An explicit
// Idempotency-Key header (if a caller ever sends one) always wins; otherwise
// the key is derived from the fields that identify "the same booking attempt"
// without requiring any client-side change (M4 audit Critical #1).
function bookingIdempotencyKey(req, body) {
  const headerKey = req.headers['idempotency-key'];
  if (headerKey) return `booking:header:${String(headerKey).trim()}`;
  return `booking:${fingerprint([
    body.fullName || '',
    body.phone || '',
    body.email || '',
    body.appointmentDate || '',
    body.campaignOffer || '',
    body.launchOffer === true ? 'launch' : ''
  ])}`;
}

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

function sendRedirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store'
  });
  res.end();
}

const DEFAULT_GOOGLE_REVIEW_URL = 'https://g.page/r/Ce0EFhVtUyRpEBM/review';

// Kept only for legacy Notion schema defaults — never redirect customers here.
function resolveGoogleReviewUrl(feedback) {
  return String(
    feedback?.reviewUrl
    || process.env.GOOGLE_REVIEW_URL
    || DEFAULT_GOOGLE_REVIEW_URL
  ).trim();
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

function preparePublicScoreMarkup(scoreMarkup) {
  let html = String(scoreMarkup || '');

  // Public chrome: hide technician back control.
  html = html.replace(
    /<button class="hdr-back"[\s\S]*?<\/button>/,
    ''
  );

  // Public share uses current URL (wired in public-report.js).
  html = html.replace(
    /onclick="shareScore\(\)"/,
    'onclick="sharePublicReport()"'
  );

  // Public report is read-only: no Give Feedback / Google Review footer.
  html = html.replace(/<div class="foot">[\s\S]*?<\/div>\s*<\/div>\s*$/, '<div class="foot hidden"></div>\n</div>\n');
  return html;
}

function isFreeInspectionJob(job) {
  return Boolean(String(job?.campaignOffer || '').trim());
}

/**
 * Free-campaign customers get the approved share-card design.
 * Mobile = vertical story plate (photo + CTA + score) matching the mock.
 * Desktop = landscape plate.
 */
function freeReportHtml(job) {
  const token = String(job.result?.publicReportToken || '').trim();
  const cacheBust = Date.now();
  const cardUrl = (format) => `/api/public/score-card/${encodeURIComponent(token)}?format=${format}&v=${cacheBust}`;

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta name="theme-color" content="#1a1a1a">
  <title>Water Score · Water Motion</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; background: #121212; }
    body {
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .card-wrap {
      width: 100%;
      height: 100vh;
      height: 100dvh;
      max-width: 100vw;
    }
    .score-img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center center;
    }
    @media (min-width: 720px) {
      html, body { background: #0c0a09; height: auto; }
      body {
        min-height: 100vh;
        padding: 24px;
        overflow: auto;
      }
      .card-wrap {
        width: min(920px, 100%);
        height: auto;
      }
      .score-img {
        width: 100%;
        height: auto;
        object-fit: contain;
        border-radius: 20px;
        box-shadow: 0 24px 60px rgba(0,0,0,0.5);
      }
    }
  </style>
</head>
<body>
  <div class="card-wrap">
    <picture>
      <source media="(min-width: 720px)" srcset="${cardUrl('landscape')}">
      <img class="score-img" src="${cardUrl('story')}" alt="Water Score" decoding="async">
    </picture>
  </div>
</body>
</html>`;
}

function reportHtml(job) {
  if (!job) return reportNotFoundHtml();
  if (isFreeInspectionJob(job)) return freeReportHtml(job);

  const token = String(job.result?.publicReportToken || '').trim();
  const cacheBust = Date.now();
  const reportConfig = JSON.stringify({
    token,
    report: job
  }).replace(/</g, '\\u003c');
  const scoreMarkup = preparePublicScoreMarkup(loadScorePagePartial());

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta name="theme-color" content="#0c0a09">
  <title>Water Score · Water Motion</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/src/css/styles.css?v=${cacheBust}">
</head>
<body class="public-report-mode">
  <div id="app">${scoreMarkup}</div>
  <script>window.__WM_PUBLIC_REPORT__ = ${reportConfig};</script>
  <script src="/src/js/state.js?v=${cacheBust}"></script>
  <script src="/src/js/i18n.js?v=${cacheBust}"></script>
  <script src="/src/js/common.js?v=${cacheBust}"></script>
  <script src="/src/js/score/util/clamp.js?v=${cacheBust}"></script>
  <script src="/src/js/score/util/benchmarkMetadata.js?v=${cacheBust}"></script>
  <script src="/src/js/score/production/computeProductionScore.js?v=${cacheBust}"></script>
  <script src="/src/js/score/production/computeQualityScoreV2.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/registry.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/thailand/limits.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/thailand/weights.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/thailand/score.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/who/limits.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/who/weights.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/who/score.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/eu/limits.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/eu/weights.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/eu/score.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/japan/limits.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/japan/weights.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/japan/score.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/usEpa/limits.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/usEpa/weights.js?v=${cacheBust}"></script>
  <script src="/src/js/score/benchmark/usEpa/score.js?v=${cacheBust}"></script>
  <script src="/src/js/score/eligibility/evidenceEngine.js?v=${cacheBust}"></script>
  <script src="/src/js/score/eligibility/coverageEngine.js?v=${cacheBust}"></script>
  <script src="/src/js/score/eligibility/contract.js?v=${cacheBust}"></script>
  <script src="/src/js/score/eligibility/eligibilityEngine.js?v=${cacheBust}"></script>
  <script src="/src/js/score/eligibility/presentation.js?v=${cacheBust}"></script>
  <script src="/src/js/score/eligibility/reportEligibility.js?v=${cacheBust}"></script>
  <script src="/src/js/flows/score.js?v=${cacheBust}"></script>
  <script src="/src/js/public-report.js?v=${cacheBust}"></script>
</body>
</html>`;
}

function feedbackReportDoneUrl(feedback) {
  const raw = String(feedback?.reportUrl || '').trim();
  if (!raw) return `${publicBaseUrl()}/`;
  if (raw.startsWith('/')) return `${publicBaseUrl()}${raw}`;
  return raw.replace(/^https?:\/\/serviceportal\.example\.com/i, publicBaseUrl());
}

function feedbackHtml(feedback) {
  if (!feedback) return '<!doctype html><meta charset="utf-8"><title>Feedback not found</title><p>Feedback link not found.</p>';
  const token = escapeHtml(feedback.feedbackToken);
  const doneUrl = escapeHtml(feedbackReportDoneUrl(feedback));
  return `<!doctype html>
<html lang="th">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Client Feedback</title>
<body style="font-family:Arial,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;line-height:1.5;color:#1c1917">
  <div id="form-wrap">
    <h1>Client Feedback</h1>
    <p>ขอบคุณที่ใช้บริการ Water Motion — ความคิดเห็นนี้ส่งถึงทีมของเราโดยตรง</p>
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
  </div>
  <div id="thanks" style="display:none;text-align:center;padding:24px 0">
    <div style="width:64px;height:64px;margin:0 auto 16px;border-radius:50%;background:#ccfbf1;color:#0f766e;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700" aria-hidden="true">✓</div>
    <h1 style="margin:0 0 8px">Thank you for your feedback.</h1>
    <p style="color:#78716c">Your comments help us improve our service.</p>
    <p style="margin-top:24px">
      <a href="${doneUrl}" style="display:inline-block;padding:12px 18px;background:#0f766e;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Done</a>
    </p>
  </div>
  <script>
    document.getElementById('feedback-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = { rating: form.rating.value, comment: form.comment.value };
      const res = await fetch('/api/feedback/${token}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        document.getElementById('message').textContent = data.error || 'Could not submit feedback';
        return;
      }
      document.getElementById('form-wrap').style.display = 'none';
      document.getElementById('thanks').style.display = 'block';
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
<body style="margin:0;font-family:Geist,Arial,sans-serif;background:#fafaf9;color:#1c1917">
  <main style="max-width:560px;margin:0 auto;padding:40px 20px">
    <h1 style="margin:0 0 8px;font-size:24px">Feedback link not found</h1>
    <p style="margin:0;color:#78716c;line-height:1.5">This feedback link may be expired or incorrect. Please contact Water Motion.</p>
  </main>
</body>
</html>`;
  }

  const token = escapeHtml(feedback.feedbackToken);
  const clientName = escapeHtml(feedback.clientName || '');
  const alreadySubmitted = String(feedback.feedbackStatus || '').toLowerCase() === 'submitted';
  const reviewUrl = escapeHtml(resolveGoogleReviewUrl(feedback));

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Water Motion Feedback</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--blue:#284dcd;--bg:#fafaf9;--surface:#fff;--text:#1c1917;--muted:#78716c;--border:#e7e5e1;--accent-50:#f0f6fe;--accent-100:#dbeafe}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);font-family:Geist,Arial,sans-serif;color:var(--text);line-height:1.5}
  main{width:min(100%,560px);margin:0 auto;padding:20px 16px 40px}
  .brand{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--blue);margin-bottom:16px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px 18px;box-shadow:0 10px 28px rgba(28,25,23,.06)}
  h1{font-size:22px;margin:0 0 6px;letter-spacing:-.02em}
  .sub{margin:0 0 20px;color:var(--muted);font-size:14px}
  label{display:block;font-size:13px;font-weight:600;margin:0 0 8px}
  .optional{font-weight:400;color:var(--muted)}
  .field{margin-bottom:16px}
  .stars{display:flex;gap:8px}
  .star{flex:1;height:48px;border:1px solid var(--border);border-radius:12px;background:#fff;color:#d6d3d1;font-size:22px;cursor:pointer}
  .star.sel{border-color:var(--blue);background:var(--accent-50);color:var(--blue)}
  input,textarea{width:100%;border:1px solid var(--border);border-radius:12px;padding:12px 13px;font:inherit;background:#fff}
  input{height:44px}
  textarea{min-height:120px;resize:vertical;line-height:1.5}
  input:focus,textarea:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(40,77,205,.1)}
  .error{display:none;margin-top:8px;font-size:13px;color:#b91c1c}
  .error.show{display:block}
  .banner{display:none;margin:14px 0 0;padding:10px 12px;border-radius:10px;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-size:13px}
  .banner.show{display:block}
  button.submit{width:100%;height:48px;margin-top:8px;border:0;border-radius:12px;background:var(--blue);color:#fff;font-weight:700;font-size:15px;cursor:pointer}
  button.submit:disabled{opacity:.45;cursor:not-allowed}
  .thanks{display:none;text-align:center;padding:28px 8px}
  .thanks.show{display:block}
  .icon{width:64px;height:64px;margin:0 auto 16px;border-radius:50%;background:var(--accent-50);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700}
  .review-card{margin-top:16px;text-align:left;padding:18px 16px;border:1px solid var(--border);border-radius:16px;background:var(--surface)}
  .review-lead{margin:0 0 8px;font-size:17px;font-weight:600;line-height:1.35}
  .review-body{margin:0 0 12px;font-size:14px;color:var(--muted);line-height:1.5}
  .review-qr{display:block;width:160px;height:160px;margin:8px auto 12px;border-radius:12px;border:1px solid var(--border);background:#fff;object-fit:contain}
  .review-url{display:block;font-size:13px;color:var(--blue);word-break:break-all;line-height:1.45;padding:10px 12px;background:var(--accent-50);border-radius:12px;border:1px solid var(--accent-100);text-decoration:underline}
  .review-btn{display:block;width:100%;margin-top:12px;height:48px;border:0;border-radius:12px;background:var(--blue);color:#fff;font-weight:700;font-size:15px;text-decoration:none;text-align:center;line-height:48px}
</style>
<body>
  <main>
    <div class="brand">Water Motion</div>
    <section class="card">
      <div id="form-wrap" style="${alreadySubmitted ? 'display:none' : ''}">
        <h1>Help us improve our service</h1>
        <p class="sub">${clientName ? `Thanks, ${clientName}. ` : ''}Your private feedback stays with Water Motion.</p>
        <form id="feedback-form">
          <div class="field">
            <label>Overall Experience</label>
            <div class="stars" role="radiogroup" aria-label="Overall Experience">
              <button class="star" type="button" data-rating="1" aria-label="1 star">★</button>
              <button class="star" type="button" data-rating="2" aria-label="2 stars">★</button>
              <button class="star" type="button" data-rating="3" aria-label="3 stars">★</button>
              <button class="star" type="button" data-rating="4" aria-label="4 stars">★</button>
              <button class="star" type="button" data-rating="5" aria-label="5 stars">★</button>
            </div>
            <div class="error" id="rating-error">Please select a rating</div>
            <input id="rating" name="rating" type="hidden">
          </div>
          <div class="field">
            <label for="name">Name <span class="optional">(optional)</span></label>
            <input id="name" name="name" type="text" value="${clientName}" autocomplete="name" placeholder="Your name">
          </div>
          <div class="field">
            <label for="email">Email <span class="optional">(optional)</span></label>
            <input id="email" name="email" type="email" autocomplete="email" placeholder="you@email.com">
          </div>
          <div class="field">
            <label for="comment">What would you like to tell us?</label>
            <textarea id="comment" name="comment" maxlength="1200" placeholder="Share what went well or what we can improve"></textarea>
            <div class="error" id="comment-error">Please enter a comment</div>
          </div>
          <div class="banner" id="error"></div>
          <button class="submit" id="submit-btn" type="submit">Submit Feedback</button>
        </form>
      </div>
      <div class="thanks${alreadySubmitted ? ' show' : ''}" id="thanks">
        <div class="icon" aria-hidden="true">✓</div>
        <h1>Thank you!</h1>
        <p class="sub">Your feedback has been submitted.<br>We appreciate your time.</p>
        <div class="review-card">
          <p class="review-lead">Thank you for choosing Water Motion.</p>
          <p class="review-body">Scan the QR code or tap the link below to leave a Google review.</p>
          <img class="review-qr" src="/src/assets/google-review-qr.png?v=4" alt="Google Review QR Code" width="160" height="160">
          <a class="review-url" href="${reviewUrl}" target="_blank" rel="noopener noreferrer">${reviewUrl}</a>
          <a class="review-btn" href="${reviewUrl}" target="_blank" rel="noopener noreferrer">Leave Google Review</a>
        </div>
      </div>
    </section>
  </main>
  <script>
    (function () {
      const stars = Array.from(document.querySelectorAll('.star'));
      const ratingInput = document.getElementById('rating');
      const formWrap = document.getElementById('form-wrap');
      const thanks = document.getElementById('thanks');
      const submitBtn = document.getElementById('submit-btn');
      const errorBanner = document.getElementById('error');
      let rating = null;

      function setRating(value) {
        rating = Number(value);
        ratingInput.value = String(rating);
        stars.forEach(btn => {
          const n = Number(btn.dataset.rating);
          btn.classList.toggle('sel', n <= rating);
        });
        document.getElementById('rating-error').classList.remove('show');
      }

      stars.forEach(btn => btn.addEventListener('click', () => setRating(btn.dataset.rating)));

      document.getElementById('feedback-form').addEventListener('submit', async event => {
        event.preventDefault();
        const comment = String(document.getElementById('comment').value || '').trim();
        let ok = true;
        if (!rating) {
          document.getElementById('rating-error').classList.add('show');
          ok = false;
        }
        if (!comment) {
          document.getElementById('comment-error').classList.add('show');
          ok = false;
        } else {
          document.getElementById('comment-error').classList.remove('show');
        }
        if (!ok) return;

        errorBanner.classList.remove('show');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
        try {
          const res = await fetch('/api/feedback/${token}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              rating,
              name: String(document.getElementById('name').value || '').trim(),
              email: String(document.getElementById('email').value || '').trim(),
              comment
            })
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'Could not submit feedback');
          formWrap.style.display = 'none';
          thanks.classList.add('show');
        } catch (error) {
          errorBanner.textContent = error.message || 'Could not submit feedback';
          errorBanner.classList.add('show');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Feedback';
        }
      });
    })();
  </script>
</body>
</html>`;
}

async function handleCaseFlowRoute(req, res, urlPath) {
  const scoreStandardMatch = urlPath.match(/^\/api\/cases\/([^/]+)\/score-standard$/);
  if (scoreStandardMatch && req.method === 'POST') {
    if (!assertAppAuth(req, res)) return true;
    try {
      const result = await submitCaseScoreStandard(
        decodeURIComponent(scoreStandardMatch[1]),
        await readJson(req)
      );
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  const scoreMatch = urlPath.match(/^\/api\/cases\/([^/]+)\/score$/);
  if (scoreMatch && req.method === 'POST') {
    if (!assertAppAuth(req, res)) return true;
    try {
      const body = await readJson(req);
      const headerKey = String(req.headers['idempotency-key'] || '').trim();
      if (headerKey && !body.idempotencyKey) body.idempotencyKey = headerKey;
      const result = await publishCaseScore(decodeURIComponent(scoreMatch[1]), body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  const assessmentMatch = urlPath.match(/^\/api\/cases\/([^/]+)\/assessment$/);
  if (assessmentMatch && req.method === 'POST') {
    if (!assertAppAuth(req, res)) return true;
    try {
      const result = await submitCaseAssessment(
        decodeURIComponent(assessmentMatch[1]),
        await readJson(req)
      );
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  if (urlPath === '/api/cases' && req.method === 'POST') {
    if (!assertAppAuth(req, res)) return true;
    try {
      const body = await readJson(req);
      const idempotencyKey = bookingIdempotencyKey(req, body);
      const correlationId = newCorrelationId('booking');
      const result = await withIdempotency(idempotencyKey, () => createCase(body, {
        startOnSite: Boolean(body.startOnSite),
        skipMap: Boolean(body.skipMap),
        // Launch-offer / Framer free-water-check bookings set launchOffer:true
        // or send campaignOffer. Explicit campaignOffer always wins in createCase.
        launchOffer: body.launchOffer === true,
        campaignOffer: body.campaignOffer,
        correlationId
      }), BOOKING_IDEMPOTENCY_TTL_MS);
      if (wasReplayed(idempotencyKey)) {
        logEvent('info', 'booking_duplicate_blocked', { correlationId, idempotencyKey });
      }
      sendJson(res, 201, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  const startMatch = urlPath.match(/^\/api\/cases\/([^/]+)\/start$/);
  if (startMatch && req.method === 'POST') {
    if (!assertAppAuth(req, res)) return true;
    try {
      const result = await startCase(decodeURIComponent(startMatch[1]), await readJson(req));
      sendJson(res, 200, result);
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
    if (!assertAppAuth(req, res)) return true;
    try {
      const result = await closeCase(decodeURIComponent(closeMatch[1]), await readJson(req));
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  const cancelMatch = urlPath.match(/^\/api\/cases\/([^/]+)\/cancel$/);
  if (cancelMatch && req.method === 'POST') {
    if (!assertAppAuth(req, res)) return true;
    try {
      const result = await cancelAppointment(decodeURIComponent(cancelMatch[1]));
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  const caseFeedbackMatch = urlPath.match(/^\/api\/cases\/([^/]+)\/feedback$/);
  if (caseFeedbackMatch && req.method === 'POST') {
    try {
      const result = await submitCaseFeedback(decodeURIComponent(caseFeedbackMatch[1]), await readJson(req));
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  const sendResultMatch = urlPath.match(/^\/api\/cases\/([^/]+)\/send-result$/);
  if (sendResultMatch && req.method === 'POST') {
    if (!assertAppAuth(req, res)) return true;
    try {
      const result = await sendCaseResult(decodeURIComponent(sendResultMatch[1]), await readJson(req));
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  if (urlPath === '/api/cases/repair-notifications' && req.method === 'POST') {
    if (!assertAppAuth(req, res)) return true;
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
    if (!assertAppAuth(req, res)) return true;
    try {
      sendJson(res, 200, { ok: true, feedback: await getClientFeedbackStatus() });
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  if (urlPath === '/api/debug/client-feedback/sync-schema' && req.method === 'POST') {
    if (!assertAppAuth(req, res)) return true;
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
    try {
      const report = await getReportByToken(decodeURIComponent(reportApiMatch[1]));
      sendJson(res, report ? 200 : 404, report ? { ok: true, report } : { ok: false, error: 'Report not found' });
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
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
      console.info('[feedback_submit]', {
        token,
        rating: Number.isFinite(rating) ? rating : null,
        source: 'token'
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  const reportPageMatch = urlPath.match(/^\/r\/([^/]+)$/);
  if (reportPageMatch && req.method === 'GET') {
    try {
      const report = await getReportByToken(decodeURIComponent(reportPageMatch[1]));
      sendHtml(res, report ? 200 : 404, reportHtml(report));
    } catch (error) {
      sendHtml(res, error.statusCode || 502, `<p>${escapeHtml(error.message || 'Report unavailable')}</p>`);
    }
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
