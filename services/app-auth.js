const crypto = require('crypto');

const SESSION_COOKIE = 'wm_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const defaultUsers = [
  { username: 'kittichai', password: 'password', name: 'Kittichai T.', role: 'Water Quality Specialist' },
  { username: 'admin', password: 'admin123', name: 'Admin', role: 'Operations' }
];

function getAuthUsers() {
  try {
    const parsed = JSON.parse(process.env.AUTH_USERS_JSON || '[]');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (error) {
    console.warn('Invalid AUTH_USERS_JSON', error.message);
  }
  return defaultUsers;
}

const DEV_SESSION_SECRET_FALLBACK = 'wm-dev-auth-session-secret';

function isProductionRuntime() {
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  if (nodeEnv === 'production') return true;
  // Render and similar hosts often set NODE_ENV=production; treat RENDER as production too.
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID) return true;
  return false;
}

function isExplicitDevelopment() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'development';
}

function failMissingSessionSecret(message) {
  console.error(`\n[FATAL] ${message}\n`);
  process.exit(1);
}

function getSessionSecret() {
  const configured = String(process.env.AUTH_SESSION_SECRET || process.env.SESSION_SECRET || '').trim();

  if (configured) {
    if (isProductionRuntime() && configured === DEV_SESSION_SECRET_FALLBACK) {
      failMissingSessionSecret(
        'AUTH_SESSION_SECRET must not use the development placeholder in production. '
        + 'Set a unique strong secret (e.g. openssl rand -hex 32).'
      );
    }
    return configured;
  }

  if (isProductionRuntime()) {
    failMissingSessionSecret(
      'AUTH_SESSION_SECRET is required in production and the server refused to start. '
      + 'Set AUTH_SESSION_SECRET in the environment (Render/host secrets), then restart.'
    );
  }

  if (!isExplicitDevelopment()) {
    failMissingSessionSecret(
      'AUTH_SESSION_SECRET is missing. Set AUTH_SESSION_SECRET, or for local-only use set NODE_ENV=development '
      + '(development fallback secret is allowed only when NODE_ENV=development).'
    );
  }

  console.warn(
    '[auth] AUTH_SESSION_SECRET unset — using development fallback. '
    + 'Never deploy with NODE_ENV=development or without AUTH_SESSION_SECRET.'
  );
  return DEV_SESSION_SECRET_FALLBACK;
}

// Resolve once at startup so production misconfig fails before accepting traffic.
const RESOLVED_SESSION_SECRET = getSessionSecret();

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlJson(value) {
  return base64url(JSON.stringify(value));
}

function signPayload(payloadB64) {
  return crypto
    .createHmac('sha256', RESOLVED_SESSION_SECRET)
    .update(payloadB64)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function publicUser(user) {
  return {
    username: user.username,
    name: user.name || user.username,
    role: user.role || 'Field Specialist'
  };
}

function findAuthUser(username) {
  const normalized = String(username || '').trim().toLowerCase();
  const local = normalized.includes('@') ? normalized.split('@')[0] : normalized;
  return getAuthUsers().find(item => String(item.username || '').toLowerCase() === local) || null;
}

function authenticateCredentials(username, password) {
  const user = findAuthUser(username);
  if (!user || String(user.password || '') !== String(password || '')) return null;
  return publicUser(user);
}

function createSessionToken(user, ttlMs = SESSION_TTL_MS) {
  const payload = {
    u: user.username,
    n: user.name || user.username,
    r: user.role || 'Field Specialist',
    iat: Date.now(),
    exp: Date.now() + ttlMs
  };
  const payloadB64 = base64urlJson(payload);
  return `${payloadB64}.${signPayload(payloadB64)}`;
}

function verifySessionToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const [payloadB64, signature] = parts;
  const expected = signPayload(payloadB64);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const json = Buffer.from(padded + pad, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (!payload?.u || !payload?.exp || Date.now() > Number(payload.exp)) return null;
    return {
      username: payload.u,
      name: payload.n || payload.u,
      role: payload.r || 'Field Specialist',
      exp: Number(payload.exp)
    };
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = String(req.headers?.cookie || '');
  const out = {};
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

function extractSessionToken(req) {
  const auth = String(req.headers?.authorization || '');
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer?.[1]) return bearer[1].trim();

  const cookies = parseCookies(req);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];

  const headerToken = String(req.headers?.['x-wm-session'] || '').trim();
  if (headerToken) return headerToken;

  return '';
}

function authError(message, statusCode = 401) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = statusCode === 403 ? 'FORBIDDEN' : 'UNAUTHENTICATED';
  return error;
}

/**
 * Resolve the logged-in app user from Bearer token or wm_session cookie.
 * Throws 401 if missing/invalid, 403 if the user is no longer authorized.
 */
function requireAppAuth(req) {
  const token = extractSessionToken(req);
  if (!token) {
    throw authError('Authentication required', 401);
  }

  const session = verifySessionToken(token);
  if (!session) {
    throw authError('Invalid or expired session', 401);
  }

  const user = findAuthUser(session.username);
  if (!user) {
    throw authError('Unauthorized', 403);
  }

  return publicUser(user);
}

function sessionCookieHeader(token, { clear = false } = {}) {
  const secure = String(process.env.PUBLIC_BASE_URL || '').startsWith('https');
  const parts = [
    `${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (clear) {
    parts.push('Max-Age=0');
  } else {
    parts.push(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  }
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  getAuthUsers,
  authenticateCredentials,
  createSessionToken,
  verifySessionToken,
  requireAppAuth,
  sessionCookieHeader,
  publicUser,
  extractSessionToken
};
