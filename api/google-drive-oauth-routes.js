const {
  isOAuthClientConfigured,
  generateAuthUrl,
  exchangeCode,
  getRefreshToken,
  TOKEN_STORE_PATH
} = require('../services/google-drive-oauth');

function sendHtml(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * OAuth setup routes for Google Drive (My Drive uploads).
 * GET /auth/google
 * GET /auth/google/callback
 */
async function handleGoogleDriveOAuthRoute(req, res, urlPath) {
  if (urlPath === '/auth/google' && req.method === 'GET') {
    try {
      if (!isOAuthClientConfigured()) {
        sendHtml(
          res,
          503,
          '<h1>Drive OAuth not configured</h1><p>Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.</p>'
        );
        return true;
      }
      const url = generateAuthUrl('drive-setup');
      res.writeHead(302, { Location: url, 'Cache-Control': 'no-store' });
      res.end();
    } catch (error) {
      console.warn('[drive-oauth] auth start failed', error.message);
      sendHtml(res, error.statusCode || 500, `<h1>OAuth error</h1><p>${escapeHtml(error.message)}</p>`);
    }
    return true;
  }

  if (urlPath === '/auth/google/callback' && req.method === 'GET') {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const err = params.get('error');
      if (err) {
        sendHtml(res, 400, `<h1>Authorization denied</h1><p>${escapeHtml(err)}</p>`);
        return true;
      }
      const code = params.get('code');
      const tokens = await exchangeCode(code);
      const refresh = tokens.refreshToken || getRefreshToken();
      const hasRefresh = Boolean(refresh);
      if (hasRefresh) {
        console.log('[google-drive] refresh token obtained:', refresh);
      } else {
        console.warn('[google-drive] refresh token not returned; reauthorize with prompt=consent and revoke previous grant if needed');
      }

      const redirectHome = String(process.env.PUBLIC_BASE_URL || '/').replace(/\/$/, '') || '/';
      sendHtml(
        res,
        200,
        `<!doctype html>
<html><head><meta charset="utf-8"><title>Drive connected</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.45}
  code,pre{background:#f4f4f5;padding:2px 6px;border-radius:4px}
  pre{padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-all}
  .ok{color:#166534}.warn{color:#9a3412}
</style></head><body>
  <h1 class="${hasRefresh ? 'ok' : 'warn'}">Google Drive ${hasRefresh ? 'connected' : 'partially connected'}</h1>
  <p>Access token received. ${hasRefresh
    ? 'A refresh token was saved for this server process and logged to the console.'
    : 'No new refresh token was returned — revoke prior access in Google Account and authorize again with consent.'}</p>
  ${hasRefresh ? `<p>Copy this value into Render env <code>GOOGLE_REFRESH_TOKEN</code> (shown once in local setup):</p>
  <pre>${escapeHtml(refresh)}</pre>
  <p>Also persisted at <code>${escapeHtml(TOKEN_STORE_PATH)}</code> when the filesystem is writable.</p>` : ''}
  <p>Redirecting to <a href="${escapeHtml(redirectHome)}">home</a> in 3 seconds...</p>
  <script>setTimeout(function(){ window.location = '${escapeHtml(redirectHome)}'; }, 3000);</script>
</body></html>`
      );
    } catch (error) {
      console.warn('[drive-oauth] callback failed', error.message);
      sendHtml(res, error.statusCode || 500, `<h1>OAuth callback failed</h1><p>${escapeHtml(error.message)}</p>`);
    }
    return true;
  }

  if (urlPath === '/auth/google/status' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      oauthClientConfigured: isOAuthClientConfigured(),
      refreshTokenSet: Boolean(getRefreshToken())
    });
    return true;
  }

  return false;
}

module.exports = { handleGoogleDriveOAuthRoute };
