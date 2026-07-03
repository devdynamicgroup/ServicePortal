const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const bindHost = process.env.BIND_HOST || '0.0.0.0';
const defaultUsers = [
  { username: 'kittichai', password: 'password', name: 'Kittichai T.', role: 'Water Quality Specialist' },
  { username: 'admin', password: 'admin123', name: 'Admin', role: 'Operations' }
];

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

function getAuthUsers() {
  try {
    const parsed = JSON.parse(process.env.AUTH_USERS_JSON || '[]');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (error) {
    console.warn('Invalid AUTH_USERS_JSON', error.message);
  }
  return defaultUsers;
}

async function handleApiRequest(req, res) {
  const urlPath = req.url.split('?')[0];

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
      const raw = String(payload.username || '').trim().toLowerCase();
      const username = raw.includes('@') ? raw.split('@')[0] : raw;
      const password = String(payload.password || '');
      const user = getAuthUsers().find(item =>
        String(item.username || '').toLowerCase() === username &&
        String(item.password || '') === password
      );

      if (!user) {
        send(res, 401, JSON.stringify({ error: 'Username or password is incorrect' }), 'application/json; charset=utf-8');
        return true;
      }

      send(res, 200, JSON.stringify({
        user: {
          username: user.username,
          name: user.name || user.username,
          role: user.role || 'Field Specialist'
        }
      }), 'application/json; charset=utf-8');
      return true;
    } catch {
      send(res, 400, JSON.stringify({ error: 'Invalid login request' }), 'application/json; charset=utf-8');
      return true;
    }
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
      const q = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
      if (!q.trim()) {
        send(res, 200, '[]', 'application/json; charset=utf-8');
        return true;
      }
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=th&limit=8&q=${encodeURIComponent(q)}&viewbox=100.25,14.25,100.95,13.45&bounded=1`;
      const response = await fetch(nominatimUrl, {
        headers: {
          'User-Agent': 'WaterMotionServicePortal/1.0 (field-app)',
          'Accept-Language': 'th,en'
        }
      });
      if (!response.ok) throw new Error(`Nominatim ${response.status}`);
      const rows = await response.json();
      const mapped = (Array.isArray(rows) ? rows : []).map(row => ({
        label: row.display_name,
        code: row.address?.postcode || '',
        city: row.address?.city || row.address?.state || row.address?.province || 'Bangkok'
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
  });
}

listen(port);
