const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env BEFORE any route/service imports.
const envFile = path.join(__dirname, '.env');
require('dotenv').config({ path: envFile, quiet: true, override: false });
require('./config/env');

// Local DX: prefer NODE_ENV from .env when not on Render (dotenv uses override:false,
// so a shell NODE_ENV=production would otherwise force prod secret requirements).
// Production / Render stay strict — never auto-downgrade those hosts.
(function applyLocalNodeEnvDefault() {
  const onRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
  if (onRender) return;

  let fromFile = '';
  try {
    if (fs.existsSync(envFile)) {
      const match = fs.readFileSync(envFile, 'utf8').match(/^\s*NODE_ENV\s*=\s*(.*)$/m);
      if (match) fromFile = String(match[1] || '').trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    /* ignore */
  }

  if (fromFile) {
    if (process.env.NODE_ENV && process.env.NODE_ENV !== fromFile) {
      console.warn(
        `[env] Using NODE_ENV=${fromFile} from .env (shell had NODE_ENV=${process.env.NODE_ENV})`
      );
    }
    process.env.NODE_ENV = fromFile;
    return;
  }

  if (!String(process.env.NODE_ENV || '').trim()) {
    process.env.NODE_ENV = 'development';
    console.warn('[env] NODE_ENV was unset — defaulting to development for local startup');
  }
})();

console.log('[ENV DEBUG]', {
  cwd: process.cwd(),
  envFile: path.resolve(envFile),
  envExists: fs.existsSync(envFile),
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || null,
  authSessionSecret: Boolean(process.env.AUTH_SESSION_SECRET || process.env.SESSION_SECRET),
  googleBusinessClientId: Boolean(process.env.GOOGLE_BUSINESS_CLIENT_ID),
  googleBusinessClientSecret: Boolean(process.env.GOOGLE_BUSINESS_CLIENT_SECRET),
  googleBusinessRedirect: Boolean(process.env.GOOGLE_BUSINESS_REDIRECT_URI),
  googleDriveConfigured: Boolean(
    (process.env.GOOGLE_DRIVE_MAIN_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID)
    && (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  )
});

// More explicit, non-sensitive startup diagnostics for deployment troubleshooting.
try {
  console.log('[ENV PRESENCE]', {
    NODE_ENV: String(process.env.NODE_ENV || 'development'),
    AUTH_SESSION_SECRET: Boolean(process.env.AUTH_SESSION_SECRET || process.env.SESSION_SECRET),
    GOOGLE_SERVICE_ACCOUNT_JSON: Boolean(String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim()),
    GOOGLE_SERVICE_ACCOUNT_KEY_PATH: Boolean(String(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || '').trim()),
    GOOGLE_DRIVE_MAIN_FOLDER_ID: Boolean(String(process.env.GOOGLE_DRIVE_MAIN_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim()),
    GOOGLE_DRIVE_DATA_FOLDER_ID: Boolean(String(process.env.GOOGLE_DRIVE_DATA_FOLDER_ID || '').trim())
  });
} catch (e) {
  console.warn('[ENV PRESENCE] logging failed', e && e.message ? e.message : e);
}

const { handleClientsRoute } = require('./api/clients-routes');
const { handleCaseFlowRoute } = require('./api/case-flow-routes');
const { handleLineRoute } = require('./api/line-routes');
const { handleGoogleReviewRoute } = require('./api/google-review-routes');
const { handleFeedbackSuggestRoute } = require('./api/feedback-suggest-routes');
const { handleGoogleDriveRoute } = require('./api/google-drive-routes');
const { startGoogleReviewScheduler } = require('./services/google-review-scheduler');
const { getDriveStatus } = require('./services/google-drive');
const {
  authenticateCredentials,
  createSessionToken,
  sessionCookieHeader
} = require('./services/app-auth');

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const bindHost = process.env.BIND_HOST || '0.0.0.0';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

// Non-sensitive Drive status to aid debugging at startup (does not print private keys).
try {
  const _ds = getDriveStatus();
  console.log('[DRIVE STATUS]', {
    configured: Boolean(_ds.configured),
    credentialsLoaded: Boolean(_ds.credentialsLoaded),
    mainFolderConfigured: Boolean(_ds.mainFolderConfigured),
    dataFolderConfigured: Boolean(_ds.dataFolderConfigured),
    serviceAccountEmail: _ds.serviceAccountEmail || null,
    error: _ds.error || null
  });
} catch (e) {
  console.warn('[DRIVE STATUS] unavailable', e && e.message ? e.message : e);
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  res.end(body);
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

const METRO_CITY_MAP = {
  bangkok: 'Bangkok',
  'krung thep maha nakhon': 'Bangkok',
  'krung thep': 'Bangkok',
  nonthaburi: 'Nonthaburi',
  'pathum thani': 'Pathum Thani',
  'samut prakan': 'Samut Prakan',
  'nakhon pathom': 'Nakhon Pathom',
  'samut sakhon': 'Samut Sakhon',
  'samut songkhram': 'Samut Songkhram'
};

function shortenAddressLabel(displayName) {
  const parts = String(displayName || '').split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 4) return parts.join(', ');
  return parts.slice(0, 4).join(', ');
}

function mapMetroCity(address) {
  const raw = [
    address?.suburb,
    address?.city,
    address?.town,
    address?.municipality,
    address?.county,
    address?.state,
    address?.province
  ].filter(Boolean).join(' ').toLowerCase();
  for (const [key, city] of Object.entries(METRO_CITY_MAP)) {
    if (raw.includes(key)) return city;
  }
  return 'Bangkok';
}

async function handleApiRequest(req, res) {
  const urlPath = req.url.split('?')[0];

  if (await handleClientsRoute(req, res, urlPath)) return true;
  if (await handleCaseFlowRoute(req, res, urlPath)) return true;
  if (await handleLineRoute(req, res, urlPath)) return true;
  if (await handleGoogleReviewRoute(req, res, urlPath)) return true;
  if (await handleFeedbackSuggestRoute(req, res, urlPath)) return true;
  if (await handleGoogleDriveRoute(req, res, urlPath)) return true;

  if (urlPath === '/api/auth-config' && req.method === 'GET') {
    send(res, 200, JSON.stringify({
      provider: 'fixed',
      forgotPasswordMode: 'it-contact',
      itContact: process.env.IT_SUPPORT_CONTACT || 'IT Support: 02-000-0000',
      itLine: process.env.IT_SUPPORT_LINE || '@watermotion-it'
    }), 'application/json; charset=utf-8');
    return true;
  }

  if (urlPath === '/api/auth/login' && req.method === 'POST') {
    try {
      const payload = JSON.parse(await readBody(req) || '{}');
      const user = authenticateCredentials(payload.username, payload.password);

      if (!user) {
        send(res, 401, JSON.stringify({ error: 'Username or password is incorrect' }), 'application/json; charset=utf-8');
        return true;
      }

      const token = createSessionToken(user);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': sessionCookieHeader(token)
      });
      res.end(JSON.stringify({ user, token }));
      return true;
    } catch {
      send(res, 400, JSON.stringify({ error: 'Invalid login request' }), 'application/json; charset=utf-8');
      return true;
    }
  }

  if (urlPath === '/api/auth/logout' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie': sessionCookieHeader('', { clear: true })
    });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  if (urlPath === '/api/auth/forgot-password' && req.method === 'POST') {
    send(res, 200, JSON.stringify({
      message: process.env.IT_SUPPORT_CONTACT || 'Please contact IT Support: 02-000-0000',
      line: process.env.IT_SUPPORT_LINE || '@watermotion-it'
    }), 'application/json; charset=utf-8');
    return true;
  }

  if (urlPath === '/api/address-search' && req.method === 'GET') {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const q = params.get('q') || '';
      const province = params.get('province') || '';
      if (!q.trim()) {
        send(res, 200, '[]', 'application/json; charset=utf-8');
        return true;
      }
      const headers = {
        'User-Agent': 'WaterMotionServicePortal/1.0 (field-app)',
        'Accept-Language': 'th,en'
      };
      const searchQuery = province ? `${q}, ${province}, Thailand` : `${q}, Bangkok, Thailand`;
      const boundedUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=th&limit=10&q=${encodeURIComponent(searchQuery)}&viewbox=100.25,14.25,100.95,13.45&bounded=1`;
      let response = await fetch(boundedUrl, { headers });
      if (!response.ok) throw new Error(`Nominatim ${response.status}`);
      let rows = await response.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        const openUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=th&limit=10&q=${encodeURIComponent(searchQuery)}`;
        response = await fetch(openUrl, { headers });
        if (response.ok) rows = await response.json();
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=th&limit=10&q=${encodeURIComponent(q)}`;
        response = await fetch(fallbackUrl, { headers });
        if (response.ok) rows = await response.json();
      }
      const mapped = (Array.isArray(rows) ? rows : []).map(row => ({
        label: shortenAddressLabel(row.display_name),
        labelTh: shortenAddressLabel(row.display_name),
        code: row.address?.postcode || '',
        city: mapMetroCity(row.address)
      }));
      send(res, 200, JSON.stringify(mapped), 'application/json; charset=utf-8');
    } catch (error) {
      console.warn('address-search failed', error.message);
      send(res, 200, '[]', 'application/json; charset=utf-8');
    }
    return true;
  }

  if (urlPath === '/api/maps-config' && req.method === 'GET') {
    send(res, 200, JSON.stringify({
      apiKey: process.env.GOOGLE_MAPS_API_KEY || ''
    }), 'application/json; charset=utf-8');
    return true;
  }

  return false;
}

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const requested = decoded === '/' ? '/index.html' : decoded;
  const fullPath = path.normalize(path.join(root, requested));

  if (!fullPath.startsWith(root)) return null;
  return fullPath;
}

async function handleRequest(req, res) {
  if (await handleApiRequest(req, res)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed');
    return;
  }

  if (req.url.split('?')[0] === '/favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'max-age=86400' });
    res.end();
    return;
  }

  const filePath = resolvePath(req.url);
  if (!filePath) {
    send(res, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (statErr, stat) => {
    const isAssetRequest = req.url.startsWith('/src/') || req.url.includes('.');
    if ((statErr || !stat.isFile()) && isAssetRequest) {
      send(res, 404, 'Not Found');
      return;
    }

    const servePath = !statErr && stat.isFile() ? filePath : path.join(root, 'index.html');
    const ext = path.extname(servePath).toLowerCase();

    fs.readFile(servePath, (readErr, data) => {
      if (readErr) {
        send(res, 500, 'Unable to read file');
        return;
      }

      res.writeHead(200, {
        'Content-Type': types[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

function listen(nextPort) {
  const server = http.createServer(handleRequest);

  // Global diagnostics to help catch startup crashes in hosted environments.
  process.on('uncaughtException', err => {
    try {
      console.error('[UNCAUGHT EXCEPTION]', err && err.message ? err.message : String(err));
      if (err && err.stack) console.error(err.stack);
    } catch (e) { /* ignore logging failures */ }
    process.exit(1);
  });
  process.on('unhandledRejection', reason => {
    try {
      console.error('[UNHANDLED REJECTION]', reason && reason.message ? reason.message : String(reason));
      if (reason && reason.stack) console.error(reason.stack);
    } catch (e) { /* ignore logging failures */ }
    process.exit(1);
  });

  server.once('error', error => {
    if (error.code === 'EADDRINUSE') {
      server.close();
      listen(nextPort + 1);
      return;
    }

    throw error;
  });

  server.listen(nextPort, bindHost, () => {
    console.log(`Water Motion app running at http://${bindHost}:${nextPort}`);
    startGoogleReviewScheduler();
  });
}

listen(port);
