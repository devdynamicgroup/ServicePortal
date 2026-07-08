const OAUTH_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

function log(step, message, extra) {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[google-business:oauth] ${step}: ${message}${suffix}`);
}

function getOAuthConfig() {
  const clientId = String(process.env.GOOGLE_BUSINESS_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_BUSINESS_CLIENT_SECRET || '').trim();
  const refreshToken = String(process.env.GOOGLE_BUSINESS_REFRESH_TOKEN || '').trim();
  const redirectUri = String(process.env.GOOGLE_BUSINESS_REDIRECT_URI || '').trim();
  return { clientId, clientSecret, refreshToken, redirectUri };
}

function isOAuthConfigured() {
  const { clientId, clientSecret } = getOAuthConfig();
  return Boolean(clientId && clientSecret);
}

function hasRefreshToken() {
  return Boolean(process.env.GOOGLE_BUSINESS_REFRESH_TOKEN);
}

function generateAuthUrl(state) {
  const { clientId, redirectUri } = getOAuthConfig();
  const missing = [];
  if (!clientId) missing.push('GOOGLE_BUSINESS_CLIENT_ID');
  if (!redirectUri) missing.push('GOOGLE_BUSINESS_REDIRECT_URI');
  if (missing.length) {
    const verb = missing.length === 1 ? 'is' : 'are';
    const error = new Error(`${missing.join(' and ')} ${verb} required (empty or missing in .env)`);
    error.statusCode = 400;
    throw error;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true'
  });
  if (state) params.set('state', state);

  const url = `${AUTH_URL}?${params.toString()}`;
  log('auth-url', 'generated');
  return url;
}

async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  if (!clientId || !clientSecret || !redirectUri) {
    const error = new Error('GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET, and GOOGLE_BUSINESS_REDIRECT_URI are required');
    error.statusCode = 400;
    throw error;
  }
  if (!code) {
    const error = new Error('Authorization code is required');
    error.statusCode = 400;
    throw error;
  }

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await response.json();
  if (!response.ok) {
    log('exchange', 'failed', { status: response.status, error: data.error });
    const error = new Error(data.error_description || data.error || 'OAuth code exchange failed');
    error.statusCode = response.status;
    throw error;
  }

  if (data.access_token) {
    tokenCache.accessToken = data.access_token;
    tokenCache.expiresAt = Date.now() + Math.max(0, Number(data.expires_in || 3600) - 60) * 1000;
  }

  log('exchange', 'success', {
    hasAccessToken: Boolean(data.access_token),
    hasRefreshToken: Boolean(data.refresh_token),
    expiresIn: data.expires_in || null
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresIn: data.expires_in || null,
    tokenType: data.token_type || 'Bearer',
    scope: data.scope || OAUTH_SCOPE
  };
}

async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = getOAuthConfig();
  const token = refreshToken || process.env.GOOGLE_BUSINESS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !token) {
    const error = new Error('GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET, and GOOGLE_BUSINESS_REFRESH_TOKEN are required');
    error.statusCode = 400;
    throw error;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: token,
    grant_type: 'refresh_token'
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await response.json();
  if (!response.ok) {
    log('token-refresh', 'failed', { status: response.status, error: data.error });
    const error = new Error(data.error_description || data.error || 'OAuth token refresh failed');
    error.statusCode = response.status;
    throw error;
  }

  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = Date.now() + Math.max(0, Number(data.expires_in || 3600) - 60) * 1000;

  log('token-refresh', 'success', { expiresIn: data.expires_in || null });
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || null,
    tokenType: data.token_type || 'Bearer',
    scope: data.scope || OAUTH_SCOPE
  };
}

async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  if (hasRefreshToken()) {
    const refreshed = await refreshAccessToken();
    return refreshed.accessToken;
  }

  const error = new Error('No valid access token. Complete OAuth and set GOOGLE_BUSINESS_REFRESH_TOKEN.');
  error.statusCode = 401;
  throw error;
}

function clearTokenCache() {
  tokenCache = { accessToken: null, expiresAt: 0 };
}

module.exports = {
  OAUTH_SCOPE,
  generateAuthUrl,
  exchangeCode,
  refreshAccessToken,
  getAccessToken,
  getOAuthConfig,
  isOAuthConfigured,
  hasRefreshToken,
  clearTokenCache
};
