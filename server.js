const http = require('http');
const fs = require('fs');
const path = require('path');

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

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const requested = decoded === '/' ? '/index.html' : decoded;
  const fullPath = path.normalize(path.join(root, requested));

  if (!fullPath.startsWith(root)) return null;
  return fullPath;
}

function handleRequest(req, res) {
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
