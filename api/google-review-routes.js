const {
  generateAuthUrl,
  exchangeCode,
  isOAuthConfigured,
  hasRefreshToken
} = require('../services/googleBusinessAuth');
const {
  probeApiEnablement,
  listAccounts,
  listLocations,
  listReviews
} = require('../services/google-business');
const {
  syncReviewsToNotion,
  getGoogleReviewIntegrationStatus,
  getNotionFeedbackDebug,
  getBusinessDebugStatus
} = require('../services/google-reviews');

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload, null, 2));
}

function readQuery(req) {
  return new URL(req.url, 'http://localhost').searchParams;
}

async function handleGoogleBusinessRoute(req, res, urlPath) {
  if (urlPath === '/api/debug/env' && req.method === 'GET') {
    sendJson(res, 200, {
      cwd: process.cwd(),
      envFile: require('path').resolve('.env'),
      clientExists: Boolean(String(process.env.GOOGLE_BUSINESS_CLIENT_ID || '').trim()),
      secretExists: Boolean(String(process.env.GOOGLE_BUSINESS_CLIENT_SECRET || '').trim()),
      redirectUri: String(process.env.GOOGLE_BUSINESS_REDIRECT_URI || '').trim() || null,
      clientLength: String(process.env.GOOGLE_BUSINESS_CLIENT_ID || '').trim().length,
      secretLength: String(process.env.GOOGLE_BUSINESS_CLIENT_SECRET || '').trim().length
    });
    return true;
  }

  if (urlPath === '/api/google-business/auth-url' && req.method === 'GET') {
    try {
      console.log('OAuth config', {
        client: Boolean(process.env.GOOGLE_BUSINESS_CLIENT_ID),
        secret: Boolean(process.env.GOOGLE_BUSINESS_CLIENT_SECRET),
        redirect: process.env.GOOGLE_BUSINESS_REDIRECT_URI || null
      });
      const params = readQuery(req);
      const url = generateAuthUrl(params.get('state') || undefined);
      sendJson(res, 200, { ok: true, url, authUrl: url, scope: 'https://www.googleapis.com/auth/business.manage' });
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: error.message });
    }
    return true;
  }

  if (urlPath === '/api/google-business/oauth/callback' && req.method === 'GET') {
    try {
      const params = readQuery(req);
      const code = params.get('code');
      const tokens = await exchangeCode(code);
      sendJson(res, 200, {
        ok: true,
        message: 'OAuth exchange succeeded. Save GOOGLE_BUSINESS_REFRESH_TOKEN in environment.',
        hasAccessToken: Boolean(tokens.accessToken),
        hasRefreshToken: Boolean(tokens.refreshToken),
        expiresIn: tokens.expiresIn,
        scope: tokens.scope,
        refreshToken: tokens.refreshToken || null
      });
    } catch (error) {
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message });
    }
    return true;
  }

  if (urlPath === '/api/google-business/accounts' && req.method === 'GET') {
    try {
      const accounts = await listAccounts();
      sendJson(res, 200, { ok: true, count: accounts.length, accounts });
    } catch (error) {
      console.warn('[google-business] accounts failed', error.message);
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message, details: error.details || null });
    }
    return true;
  }

  if (urlPath === '/api/google-business/locations' && req.method === 'GET') {
    try {
      const params = readQuery(req);
      const accountId = params.get('accountId') || process.env.GOOGLE_BUSINESS_ACCOUNT_ID;
      const locations = await listLocations(accountId);
      sendJson(res, 200, { ok: true, accountId, count: locations.length, locations });
    } catch (error) {
      console.warn('[google-business] locations failed', error.message);
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message, details: error.details || null });
    }
    return true;
  }

  if (urlPath === '/api/google-business/reviews' && req.method === 'GET') {
    try {
      const params = readQuery(req);
      const result = await listReviews({
        accountId: params.get('accountId') || undefined,
        locationId: params.get('locationId') || undefined,
        pageSize: params.get('pageSize') || undefined,
        orderBy: params.get('orderBy') || 'updateTime desc',
        fetchAll: params.get('fetchAll') !== 'false'
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      console.warn('[google-business] reviews failed', error.message);
      sendJson(res, error.statusCode || 502, { ok: false, error: error.message, details: error.details || null });
    }
    return true;
  }

  if (urlPath === '/api/debug/business' && req.method === 'GET') {
    try {
      const payload = await getBusinessDebugStatus();
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 502, {
        googleConnected: false,
        account: null,
        location: null,
        reviewCount: 0,
        lastSync: null,
        lastError: error.message || 'Failed to build business debug status'
      });
    }
    return true;
  }

  return false;
}

async function handleGoogleReviewRoute(req, res, urlPath) {
  if (await handleGoogleBusinessRoute(req, res, urlPath)) return true;

  if (urlPath === '/api/google-reviews/status' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      integration: getGoogleReviewIntegrationStatus()
    });
    return true;
  }

  if (urlPath === '/api/google-reviews/sync' && req.method === 'POST') {
    try {
      const result = await syncReviewsToNotion();
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      console.warn('POST /api/google-reviews/sync failed', error.message);
      sendJson(res, error.statusCode || 502, {
        ok: false,
        error: error.message || 'Failed to sync Google reviews',
        missingProperties: error.missingProperties || undefined
      });
    }
    return true;
  }

  if (urlPath === '/api/debug/notion' && req.method === 'GET') {
    try {
      const payload = await getNotionFeedbackDebug();
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 502, {
        databaseConnected: false,
        error: error.message || 'Failed to query Notion feedback database'
      });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleGoogleReviewRoute,
  handleGoogleBusinessRoute
};
