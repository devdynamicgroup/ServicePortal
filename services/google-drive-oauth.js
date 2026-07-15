const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const DRIVE_SCOPE = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive'
];
const TOKEN_STORE_PATH = path.join(process.cwd(), 'data', 'google-drive-oauth.json');

let runtimeRefreshToken = null;

function oauthError(message, statusCode = 500, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function getOAuthEnv() {
  return {
    clientId: String(process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    redirectUri: String(process.env.GOOGLE_REDIRECT_URI || '').trim(),
    envRefreshToken: String(process.env.GOOGLE_REFRESH_TOKEN || '').trim()
  };
}

function readStoredRefreshToken() {
  try {
    if (!fs.existsSync(TOKEN_STORE_PATH)) return '';
    const parsed = JSON.parse(fs.readFileSync(TOKEN_STORE_PATH, 'utf8'));
    return String(parsed.refreshToken || parsed.refresh_token || '').trim();
  } catch {
    return '';
  }
}

function getRefreshToken() {
  return (
    runtimeRefreshToken
    || String(process.env.GOOGLE_REFRESH_TOKEN || '').trim()
    || readStoredRefreshToken()
  );
}

function saveRefreshToken(refreshToken) {
  const token = String(refreshToken || '').trim();
  if (!token) return null;

  runtimeRefreshToken = token;
  process.env.GOOGLE_REFRESH_TOKEN = token;

  try {
    fs.mkdirSync(path.dirname(TOKEN_STORE_PATH), { recursive: true });
    fs.writeFileSync(
      TOKEN_STORE_PATH,
      `${JSON.stringify({
        refreshToken: token,
        updatedAt: new Date().toISOString()
      }, null, 2)}\n`,
      'utf8'
    );
  } catch (error) {
    console.warn('[google-drive-oauth] could not persist refresh token to disk:', error.message);
  }

  return TOKEN_STORE_PATH;
}

function isOAuthClientConfigured() {
  const { clientId, clientSecret, redirectUri } = getOAuthEnv();
  return Boolean(clientId && clientSecret && redirectUri);
}

function isDriveOAuthReady() {
  return isOAuthClientConfigured() && Boolean(getRefreshToken());
}

function createOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = getOAuthEnv();
  if (!clientId || !clientSecret || !redirectUri) {
    throw oauthError(
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required for Drive OAuth',
      503
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getAuthorizedOAuth2Client() {
  const client = createOAuth2Client();
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw oauthError(
      'GOOGLE_REFRESH_TOKEN is missing. Visit /auth/google once to authorize Drive uploads, then set GOOGLE_REFRESH_TOKEN on Render.',
      503
    );
  }
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function generateAuthUrl(state) {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: DRIVE_SCOPE,
    include_granted_scopes: true,
    state: state || undefined
  });
}

async function exchangeCode(code) {
  if (!code) throw oauthError('Authorization code is required', 400);
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  if (!tokens?.access_token) {
    throw oauthError('OAuth token exchange did not return an access token', 502, tokens);
  }

  if (tokens.refresh_token) {
    saveRefreshToken(tokens.refresh_token);
  } else {
    console.warn(
      '[google-drive-oauth] No refresh_token in response. Revoke prior grant or use prompt=consent, then authorize again.'
    );
  }

  client.setCredentials(tokens);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || getRefreshToken() || null,
    expiryDate: tokens.expiry_date || null,
    scope: tokens.scope || DRIVE_SCOPE.join(' '),
    tokenType: tokens.token_type || 'Bearer'
  };
}

/**
 * googleapis Drive client; refresh_token rotates access tokens automatically.
 */
function getDriveClient() {
  const auth = getAuthorizedOAuth2Client();
  return google.drive({ version: 'v3', auth });
}

module.exports = {
  DRIVE_SCOPE,
  TOKEN_STORE_PATH,
  isOAuthClientConfigured,
  isDriveOAuthReady,
  getRefreshToken,
  saveRefreshToken,
  createOAuth2Client,
  getAuthorizedOAuth2Client,
  generateAuthUrl,
  exchangeCode,
  getDriveClient,
  getOAuthEnv
};
