// LIFF "Case Bind" flow (2026-08-26) -- lets a customer tap a link inside
// LINE to bind their LINE account to a Case automatically, instead of
// typing the fb-xxxx code by hand into chat with the OA.
//
// The bind page (GET /liff/bind/:token) runs LINE's LIFF SDK client-side to
// obtain an ID token for the logged-in LINE user, then POSTs it here. We
// verify the ID token against LINE's own /oauth2/v2.1/verify endpoint
// server-side rather than trusting a client-declared lineUserId directly --
// otherwise anyone could POST an arbitrary lineUserId and hijack a Case's
// result-delivery target.
//
// The actual bind (Notion write, dual-write, pending-result auto-send) is
// 100% the same code path as the manual fb-xxxx chat flow --
// services/workflow-service.js:linkLineUser -- so behavior stays identical
// between the two entry points.

const { getFeedbackByToken } = require('../services/case-flow');
const {
  linkLineUser,
  sendCaseResult,
  markCaseResultNotificationFailed
} = require('../services/workflow-service');

const LIFF_ID = String(process.env.LIFF_ID || '2011272555-MAtmaEy4').trim();
const LIFF_LOGIN_CHANNEL_ID = String(process.env.LIFF_LOGIN_CHANNEL_ID || '2011272555').trim();

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

// Verifies a LIFF ID token against LINE's own endpoint and returns the
// verified { userId, displayName }. Throws on any failure -- never falls
// back to trusting client-supplied identity.
async function verifyLiffIdToken(idToken) {
  const token = String(idToken || '').trim();
  if (!token) {
    const err = new Error('missing_id_token');
    err.statusCode = 400;
    throw err;
  }
  const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: token, client_id: LIFF_LOGIN_CHANNEL_ID })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.sub) {
    const err = new Error(payload.error_description || payload.error || 'id_token_verification_failed');
    err.statusCode = 401;
    throw err;
  }
  if (String(payload.aud || '') !== LIFF_LOGIN_CHANNEL_ID) {
    const err = new Error('id_token_wrong_audience');
    err.statusCode = 401;
    throw err;
  }
  return { userId: String(payload.sub), displayName: String(payload.name || '').trim() };
}

function liffBindHtml(token, feedback) {
  const safeToken = escapeHtml(token);
  if (!feedback) {
    return `<!doctype html>
<html lang="th">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Water Motion</title>
<body style="margin:0;font-family:Arial,sans-serif;background:#fafaf9;color:#1c1917;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center">
  <div>
    <h1 style="margin:0 0 8px;font-size:20px">ไม่พบรหัสนี้</h1>
    <p style="margin:0;color:#78716c">ลิงก์นี้อาจหมดอายุหรือไม่ถูกต้อง กรุณาติดต่อ Water Motion</p>
  </div>
</body>
</html>`;
  }

  const clientName = escapeHtml(feedback.clientName || '');

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>เชื่อมบัญชี LINE · Water Motion</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family: 'Segoe UI', Arial, sans-serif; background:#fafaf9; color:#1c1917; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
  .card { max-width: 360px; text-align:center; }
  .spinner { width:36px; height:36px; border:3px solid #e7e5e1; border-top-color:#06c755; border-radius:50%; margin:0 auto 20px; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size:18px; margin:0 0 8px; }
  p { margin:0; color:#78716c; line-height:1.5; font-size:14px; }
  .icon { width:56px; height:56px; border-radius:50%; margin:0 auto 16px; display:flex; align-items:center; justify-content:center; font-size:28px; font-weight:700; }
  .ok { background:#dcfce7; color:#15803d; }
  .err { background:#fee2e2; color:#b91c1c; }
</style>
</head>
<body>
  <div class="card" id="state-loading">
    <div class="spinner"></div>
    <h1>กำลังเชื่อมบัญชี LINE...</h1>
    <p>${clientName ? `สวัสดีคุณ${clientName} ` : ''}กรุณารอสักครู่</p>
  </div>
  <div class="card" id="state-ok" style="display:none">
    <div class="icon ok">&#10003;</div>
    <h1 id="ok-title">เชื่อมบัญชี LINE เรียบร้อยแล้ว</h1>
    <p id="ok-text">ระบบจะส่งผลตรวจให้ทาง LINE เมื่อพร้อม</p>
  </div>
  <div class="card" id="state-err" style="display:none">
    <div class="icon err">&#33;</div>
    <h1>เชื่อมบัญชีไม่สำเร็จ</h1>
    <p id="err-text">กรุณาลองใหม่อีกครั้ง หรือติดต่อ Water Motion</p>
  </div>

  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <script>
    (async () => {
      const show = (id) => {
        ['state-loading', 'state-ok', 'state-err'].forEach(s => {
          document.getElementById(s).style.display = s === id ? 'block' : 'none';
        });
      };
      try {
        await liff.init({ liffId: '${LIFF_ID}' });
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }
        const idToken = liff.getIDToken();
        const res = await fetch('/api/liff/bind/${safeToken}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          document.getElementById('err-text').textContent = data.message || 'กรุณาลองใหม่อีกครั้ง หรือติดต่อ Water Motion';
          show('state-err');
          return;
        }
        if (data.reason === 'already_linked') {
          document.getElementById('ok-title').textContent = 'บัญชี LINE นี้เชื่อมไว้แล้ว';
        } else if (data.pendingAutoSend) {
          document.getElementById('ok-text').textContent = 'กำลังเตรียมผลตรวจให้ครับ รอสักครู่';
        }
        show('state-ok');
        setTimeout(() => { try { liff.closeWindow(); } catch (e) {} }, 2500);
      } catch (error) {
        document.getElementById('err-text').textContent = 'เกิดข้อผิดพลาด กรุณาลองใหม่ในแอป LINE';
        show('state-err');
      }
    })();
  </script>
</body>
</html>`;
}

async function handleLiffRoute(req, res, urlPath) {
  const bindPageMatch = urlPath.match(/^\/liff\/bind\/([^/]+)$/);
  if (bindPageMatch && req.method === 'GET') {
    const token = decodeURIComponent(bindPageMatch[1]);
    const feedback = await getFeedbackByToken(token);
    sendHtml(res, feedback ? 200 : 404, liffBindHtml(token, feedback));
    return true;
  }

  const bindApiMatch = urlPath.match(/^\/api\/liff\/bind\/([^/]+)$/);
  if (bindApiMatch && req.method === 'POST') {
    const token = decodeURIComponent(bindApiMatch[1]);
    try {
      const payload = await readJson(req);
      const { userId, displayName } = await verifyLiffIdToken(payload.idToken);
      const linked = await linkLineUser(token, userId, displayName);

      if (!linked.linked) {
        const statusByReason = { feedback_not_found: 404, missing_line_user_id: 400, linked_to_another_user: 409 };
        sendJson(res, statusByReason[linked.reason] || 400, {
          ok: false,
          reason: linked.reason,
          message: linked.reason === 'linked_to_another_user'
            ? 'รหัสนี้ถูกเชื่อมกับบัญชี LINE อื่นแล้ว กรุณาติดต่อ Water Motion'
            : 'ไม่พบรหัสนี้ กรุณาตรวจสอบและลองอีกครั้ง'
        });
        return true;
      }

      if (linked.pendingAutoSend) {
        const caseId = linked.feedbackToken || token;
        try {
          await sendCaseResult(caseId);
        } catch (sendError) {
          try {
            await markCaseResultNotificationFailed(caseId, sendError);
          } catch { /* best-effort */ }
          console.error('[liff_bind_auto_send_failed]', { caseId, error: sendError.message });
        }
      }

      sendJson(res, 200, {
        ok: true,
        reason: linked.alreadyLinked ? 'already_linked' : 'linked',
        pendingAutoSend: Boolean(linked.pendingAutoSend)
      });
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, message: error.message });
    }
    return true;
  }

  return false;
}

module.exports = { handleLiffRoute, verifyLiffIdToken, liffBindHtml };
