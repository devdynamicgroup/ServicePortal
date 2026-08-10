const crypto = require('crypto');

const SESSION_COOKIE = 'wm_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Development-only users — never used unless AUTH_ALLOW_DEV_USERS=true and not production. */
const DEV_ONLY_USERS = [
  { username: 'dev', password: 'dev', name: 'Local Dev', role: 'Development' }
];

function isProductionRuntime() {
  const nodeEnv = String(process.env.NODE_ENV || '').toLowerCase();
  if (nodeEnv === 'production') return true;
  // Render sets NODE_ENV=production in normal deploys; treat RENDER* as production too.
  if (process.env.RENDER || process.env.RENDER_SERVICE_ID) return true;
  return false;
}

function failAuthStartup(message) {
  console.error(`\n[FATAL] ${message}\n`);
  process.exit(1);
}

function isAuthAllowDevUsers() {
  return String(process.env.AUTH_ALLOW_DEV_USERS || '').trim().toLowerCase() === 'true';
}

/**
 * Resolve login users once at startup.
 * Production / default: AUTH_USERS_JSON required (non-empty array).
 * Local only: AUTH_ALLOW_DEV_USERS=true permits DEV_ONLY_USERS (never in production).
 */
function loadAuthUsersOrExit() {
  if (isProductionRuntime() && isAuthAllowDevUsers()) {
    failAuthStartup(
      'AUTH_ALLOW_DEV_USERS must not be enabled in production.\n'
      + '  Fix: unset AUTH_ALLOW_DEV_USERS and set AUTH_USERS_JSON in the host environment.'
    );
  }

  const raw = String(process.env.AUTH_USERS_JSON || '').trim();
  if (raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      failAuthStartup(
        `AUTH_USERS_JSON is invalid JSON (${error.message}).\n`
        + '  Expected a JSON array like '
        + '[{"username":"admin","password":"<strong>","name":"Admin","role":"Operations"}]'
      );
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      failAuthStartup(
        'AUTH_USERS_JSON must be a non-empty JSON array of users with username and password.'
      );
    }
    const invalid = parsed.find(
      item => !item || !String(item.username || '').trim() || !String(item.password || '')
    );
    if (invalid) {
      failAuthStartup(
        'AUTH_USERS_JSON entries must each include non-empty username and password.'
      );
    }
    return parsed;
  }

  if (!isProductionRuntime() && isAuthAllowDevUsers()) {
    console.warn(
      '[auth] WARNING: AUTH_ALLOW_DEV_USERS=true — using development-only login users.\n'
      + '  Do not enable this flag on Render / production. Prefer AUTH_USERS_JSON.'
    );
    return DEV_ONLY_USERS;
  }

  failAuthStartup(
    'AUTH_USERS_JSON is required and the server refused to start.\n'
    + '  Fix: set AUTH_USERS_JSON to a JSON array of portal users, e.g.\n'
    + '  AUTH_USERS_JSON=[{"username":"admin","password":"<strong>","name":"Admin","role":"Operations"}]\n'
    + '  Local development only: set AUTH_ALLOW_DEV_USERS=true (never in production).'
  );
}

const AUTH_USERS = loadAuthUsersOrExit();

const DEV_SESSION_SECRET_FALLBACK = 'wm-dev-auth-session-secret';

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

  // Production / Render: never allow a weak fallback.
  if (isProductionRuntime()) {
    failMissingSessionSecret(
      'AUTH_SESSION_SECRET is required in production and the server refused to start.\n'
      + '  Fix: set AUTH_SESSION_SECRET in the host environment (Render → Environment),\n'
      + '  e.g. openssl rand -hex 32, then restart the service.\n'
      + '  Local only: use NODE_ENV=development (and do not set RENDER) to allow a dev fallback.'
    );
  }

  // Local / non-production: allow fallback so `yarn start` works without manual secret setup.
  console.warn(
    '[auth] WARNING: AUTH_SESSION_SECRET is unset — using the development fallback secret.\n'
    + '  This is for local development only (NODE_ENV=' + (process.env.NODE_ENV || 'development') + ').\n'
    + '  Before production deploy, set a unique AUTH_SESSION_SECRET and never commit it.'
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

function getAuthUsers() {
  return AUTH_USERS;
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

/**
 * Route helper: require auth or write a JSON 401/403 and return null.
 * @returns {object|null} public user, or null after writing the error response
 */
function assertAppAuth(req, res) {
  try {
    return requireAppAuth(req);
  } catch (error) {
    const status = error.statusCode || 401;
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({
      ok: false,
      error: error.message || 'Authentication required',
      code: error.code || 'UNAUTHENTICATED'
    }));
    return null;
  }
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
  assertAppAuth,
  sessionCookieHeader,
  publicUser,
  extractSessionToken,
  isProductionRuntime
};
