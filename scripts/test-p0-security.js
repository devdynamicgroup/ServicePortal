/**
 * P0 Security Hardening regression tests.
 * Run: node scripts/test-p0-security.js
 */
const { spawnSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function pass(name) {
  passed += 1;
  console.log(`PASS  ${name}`);
}

function fail(name, detail) {
  failed += 1;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

function runNode(env, code) {
  const cleaned = { ...process.env, ...env };
  Object.keys(env).forEach(key => {
    if (env[key] === '' || env[key] == null) delete cleaned[key];
    else cleaned[key] = env[key];
  });
  [
    'AUTH_SESSION_SECRET',
    'SESSION_SECRET',
    'AUTH_USERS_JSON',
    'AUTH_ALLOW_DEV_USERS',
    'RENDER',
    'RENDER_SERVICE_ID',
    'NODE_ENV'
  ].forEach(key => {
    if (Object.prototype.hasOwnProperty.call(env, key) && !env[key]) delete cleaned[key];
  });
  return spawnSync(process.execPath, ['-e', code], {
    cwd: root,
    env: cleaned,
    encoding: 'utf8'
  });
}

const USERS_JSON = JSON.stringify([
  { username: 'tester', password: 'test-pass-strong', name: 'Tester', role: 'Ops' }
]);

// ---- P0.1 default credentials / AUTH_USERS_JSON ----
{
  const missing = runNode(
    {
      NODE_ENV: 'production',
      AUTH_SESSION_SECRET: 'unit-test-secret-value-32chars!!',
      AUTH_USERS_JSON: '',
      AUTH_ALLOW_DEV_USERS: '',
      RENDER: '',
      RENDER_SERVICE_ID: ''
    },
    'require("./services/app-auth")'
  );
  if (missing.status !== 0 && /AUTH_USERS_JSON/.test(String(missing.stderr || '') + String(missing.stdout || ''))) {
    pass('P0.1 production exits when AUTH_USERS_JSON missing');
  } else {
    fail('P0.1 production exits when AUTH_USERS_JSON missing', `status=${missing.status}`);
  }
}

{
  const src = fs.readFileSync(path.join(root, 'services/app-auth.js'), 'utf8');
  if (!/admin123/.test(src) && !/password: 'password'/.test(src) && !/defaultUsers/.test(src)) {
    pass('P0.1 no production defaultUsers / admin123 / password fallback in source');
  } else {
    fail('P0.1 no production defaultUsers / admin123 / password fallback in source');
  }
}

{
  const banned = runNode(
    {
      NODE_ENV: 'production',
      AUTH_SESSION_SECRET: 'unit-test-secret-value-32chars!!',
      AUTH_USERS_JSON: USERS_JSON,
      AUTH_ALLOW_DEV_USERS: 'true',
      RENDER: '',
      RENDER_SERVICE_ID: ''
    },
    'require("./services/app-auth")'
  );
  if (banned.status !== 0 && /AUTH_ALLOW_DEV_USERS/.test(String(banned.stderr || '') + String(banned.stdout || ''))) {
    pass('P0.1 production rejects AUTH_ALLOW_DEV_USERS');
  } else {
    fail('P0.1 production rejects AUTH_ALLOW_DEV_USERS', `status=${banned.status}`);
  }
}

{
  const ok = runNode(
    {
      NODE_ENV: 'production',
      AUTH_SESSION_SECRET: 'unit-test-secret-value-32chars!!',
      AUTH_USERS_JSON: USERS_JSON,
      AUTH_ALLOW_DEV_USERS: '',
      RENDER: '',
      RENDER_SERVICE_ID: ''
    },
    'const a=require("./services/app-auth"); console.log(a.authenticateCredentials("tester","test-pass-strong")?.username||"")'
  );
  if (ok.status === 0 && String(ok.stdout || '').includes('tester')) {
    pass('P0.1 AUTH_USERS_JSON authenticates in production');
  } else {
    fail('P0.1 AUTH_USERS_JSON authenticates in production', String(ok.stderr || ok.stdout || ''));
  }
}

{
  const dev = runNode(
    {
      NODE_ENV: 'development',
      AUTH_SESSION_SECRET: '',
      AUTH_USERS_JSON: '',
      AUTH_ALLOW_DEV_USERS: 'true',
      RENDER: '',
      RENDER_SERVICE_ID: ''
    },
    'const a=require("./services/app-auth"); console.log(a.authenticateCredentials("dev","dev")?.username||"")'
  );
  if (dev.status === 0 && String(dev.stdout || '').includes('dev')) {
    pass('P0.1 AUTH_ALLOW_DEV_USERS enables local-only users');
  } else {
    fail('P0.1 AUTH_ALLOW_DEV_USERS enables local-only users', String(dev.stderr || dev.stdout || ''));
  }
}

// ---- Static source checks P0.3 ----
{
  const driveOauth = fs.readFileSync(path.join(root, 'api/google-drive-oauth-routes.js'), 'utf8');
  const biz = fs.readFileSync(path.join(root, 'api/google-review-routes.js'), 'utf8');
  const driveOk = !/console\.log\([^)]*,\s*refresh\b/.test(driveOauth)
    && !/\$\{escapeHtml\(refresh\)\}/.test(driveOauth)
    && !/<pre>\$\{escapeHtml\(refresh\)\}<\/pre>/.test(driveOauth)
    && /value not logged/.test(driveOauth);
  const bizOk = !/refreshToken:\s*tokens\.refreshToken/.test(biz)
    && /is not returned in this response/.test(biz);
  if (driveOk && bizOk) pass('P0.3 OAuth callbacks do not expose refresh tokens');
  else fail('P0.3 OAuth callbacks do not expose refresh tokens', `driveOk=${driveOk} bizOk=${bizOk}`);
}

// ---- Static P0.4 ----
{
  const authJs = fs.readFileSync(path.join(root, 'src/js/flows/auth.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const ok = /\/api\/auth\/me/.test(authJs)
    && /localStorage\.removeItem\('wm-session'\)/.test(authJs)
    && !/session\.token/.test(authJs)
    && /Cookie-only session/.test(serverJs)
    && /urlPath === '\/api\/auth\/me'/.test(serverJs);
  if (ok) pass('P0.4 cookie-only session + /api/auth/me wired');
  else fail('P0.4 cookie-only session + /api/auth/me wired');
}

// ---- HTTP integration: protected routes + public carve-outs + auth/me ----
function startTestServer() {
  const port = 3100 + Math.floor(Math.random() * 200);
  const env = {
    ...process.env,
    PORT: String(port),
    BIND_HOST: '127.0.0.1',
    NODE_ENV: 'development',
    AUTH_SESSION_SECRET: 'p0-security-test-secret-32chars!!',
    AUTH_USERS_JSON: USERS_JSON,
    AUTH_ALLOW_DEV_USERS: '',
    RENDER: '',
    RENDER_SERVICE_ID: '',
    CARE_LIFECYCLE_ENABLED: 'false',
    CARE_LIFECYCLE_SEND: 'false',
    CARE_LIFECYCLE_SCHEDULER: 'false',
    GOOGLE_REVIEW_SYNC_ENABLED: 'false'
  };
  delete env.RENDER;
  delete env.RENDER_SERVICE_ID;

  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return { child, port };
}

function httpRequest(port, method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function waitForServer(port, attempts = 40) {
  return new Promise(async resolve => {
    for (let i = 0; i < attempts; i += 1) {
      try {
        const res = await httpRequest(port, 'GET', '/api/ops/health');
        if (res.status) return resolve(true);
      } catch {
        /* retry */
      }
      await new Promise(r => setTimeout(r, 250));
    }
    resolve(false);
  });
}

(async () => {
  const { child, port } = startTestServer();
  let ready = false;
  try {
    ready = await waitForServer(port);
    if (!ready) {
      fail('P0 HTTP test server boot', 'timeout');
    } else {
      pass('P0 HTTP test server boot');

      const unauthClients = await httpRequest(port, 'GET', '/api/clients');
      if (unauthClients.status === 401) pass('P0.2 GET /api/clients requires auth');
      else fail('P0.2 GET /api/clients requires auth', `status=${unauthClients.status}`);

      const unauthCases = await httpRequest(port, 'POST', '/api/cases', {
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (unauthCases.status === 401) pass('P0.2 POST /api/cases requires auth');
      else fail('P0.2 POST /api/cases requires auth', `status=${unauthCases.status}`);

      const unauthOcr = await httpRequest(port, 'POST', '/api/ocr/read-meter', {
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (unauthOcr.status === 401) pass('P0.2 POST /api/ocr/read-meter requires auth');
      else fail('P0.2 POST /api/ocr/read-meter requires auth', `status=${unauthOcr.status}`);

      const unauthDebug = await httpRequest(port, 'GET', '/api/debug/env');
      if (unauthDebug.status === 401) pass('P0.2 /api/debug/env requires auth');
      else fail('P0.2 /api/debug/env requires auth', `status=${unauthDebug.status}`);

      const unauthSync = await httpRequest(port, 'POST', '/api/google-reviews/sync');
      if (unauthSync.status === 401) pass('P0.2 POST /api/google-reviews/sync requires auth');
      else fail('P0.2 POST /api/google-reviews/sync requires auth', `status=${unauthSync.status}`);

      // Public carve-outs must not be 401 for missing auth (may be 404/502).
      const report = await httpRequest(port, 'GET', '/api/report/rpt-zzzz');
      if (report.status !== 401) pass('P0.2 GET /api/report/:token stays public');
      else fail('P0.2 GET /api/report/:token stays public', `status=${report.status}`);

      const offer = await httpRequest(port, 'GET', '/api/public/water-check-offer');
      if (offer.status !== 401) pass('P0.2 water-check-offer stays public');
      else fail('P0.2 water-check-offer stays public', `status=${offer.status}`);

      const cal = await httpRequest(port, 'POST', '/api/cal/webhook', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerEvent: 'PING', payload: {} })
      });
      if (cal.status !== 401) pass('P0.2 Cal webhook stays public (signature rules unchanged)');
      else fail('P0.2 Cal webhook stays public', `status=${cal.status}`);

      const login = await httpRequest(port, 'POST', '/api/auth/login', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'tester', password: 'test-pass-strong' })
      });
      let loginJson = {};
      try {
        loginJson = JSON.parse(login.body);
      } catch {
        loginJson = {};
      }
      const setCookie = String(login.headers['set-cookie'] || '');
      const hasCookie = /wm_session=/.test(setCookie);
      const noToken = loginJson.token === undefined;
      if (login.status === 200 && hasCookie && noToken && loginJson.user?.username === 'tester') {
        pass('P0.4 login sets cookie and does not return bearer token');
      } else {
        fail(
          'P0.4 login sets cookie and does not return bearer token',
          `status=${login.status} cookie=${hasCookie} tokenField=${loginJson.token}`
        );
      }

      const cookieHeader = Array.isArray(login.headers['set-cookie'])
        ? login.headers['set-cookie'].map(c => c.split(';')[0]).join('; ')
        : String(login.headers['set-cookie'] || '').split(',')[0].split(';')[0];

      const meUnauth = await httpRequest(port, 'GET', '/api/auth/me');
      if (meUnauth.status === 401) pass('P0.4 GET /api/auth/me rejects anonymous');
      else fail('P0.4 GET /api/auth/me rejects anonymous', `status=${meUnauth.status}`);

      const me = await httpRequest(port, 'GET', '/api/auth/me', {
        headers: { Cookie: cookieHeader }
      });
      let meJson = {};
      try {
        meJson = JSON.parse(me.body);
      } catch {
        meJson = {};
      }
      if (me.status === 200 && meJson.user?.username === 'tester') {
        pass('P0.4 GET /api/auth/me returns user from cookie');
      } else {
        fail('P0.4 GET /api/auth/me returns user from cookie', `status=${me.status} body=${me.body.slice(0, 120)}`);
      }

      const clientsAuth = await httpRequest(port, 'GET', '/api/clients', {
        headers: { Cookie: cookieHeader }
      });
      // 200 if Notion configured, else 503 — must not be 401 when cookie present
      if (clientsAuth.status !== 401) pass('P0.2 authenticated GET /api/clients accepted');
      else fail('P0.2 authenticated GET /api/clients accepted', `status=${clientsAuth.status}`);
    }
  } catch (error) {
    fail('P0 HTTP suite', error.message);
  } finally {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }

  console.log(`\nP0 security tests: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
