/**
 * Part K — static HTTP asset allow/deny boundary.
 * Pure helpers. No I/O. Used by server.js static serving.
 */
const path = require('path');

const STATIC_ALLOWED_EXT = new Set([
  '.html',
  '.css',
  '.js',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.map'
]);

const STATIC_SENSITIVE_BASENAME = /^(?:\.env(?:\..*)?|.*service-account.*|solar-bolt-.*|render-google-service-account.*)$/i;

const BLOCKED_TOP_DIRS = new Set([
  'credentials',
  'data',
  'tmp',
  'backups',
  'node_modules',
  '.git',
  'services',
  'api',
  'config',
  'tests',
  'scripts',
  'docs'
]);

function resolveStaticPath(root, urlPath) {
  const decoded = decodeURIComponent(String(urlPath || '').split('?')[0] || '');
  const requested = decoded === '/' ? '/index.html' : decoded;
  const fullPath = path.normalize(path.join(root, requested));
  if (!fullPath.startsWith(root)) return null;
  return fullPath;
}

function isSensitiveStaticRequest(root, urlPath) {
  const decoded = decodeURIComponent(String(urlPath || '').split('?')[0] || '');
  if (!decoded || decoded === '/') return false;

  const fullPath = resolveStaticPath(root, decoded);
  if (!fullPath) return true;

  const rel = path.relative(root, fullPath);
  if (!rel || rel.startsWith('..')) return true;
  const posix = rel.split(path.sep).join('/');
  const base = path.basename(posix);
  const ext = path.extname(base).toLowerCase();
  const top = posix.split('/')[0];

  if (BLOCKED_TOP_DIRS.has(top)) return true;
  if (STATIC_SENSITIVE_BASENAME.test(base)) return true;
  if (/\.env(\.|$)/i.test(base)) return true;
  if (ext && !STATIC_ALLOWED_EXT.has(ext)) return true;
  return false;
}

function isAllowedStaticFile(root, fullPath) {
  const rel = path.relative(root, fullPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const posix = rel.split(path.sep).join('/');

  if (isSensitiveStaticRequest(root, '/' + posix)) return false;

  if (
    posix === 'index.html'
    || posix === '_wm_index.html'
    || posix === 'favicon.ico'
  ) {
    return true;
  }
  if (posix.startsWith('src/') || posix.startsWith('assets/')) return true;
  return false;
}

module.exports = {
  STATIC_ALLOWED_EXT,
  isSensitiveStaticRequest,
  isAllowedStaticFile,
  resolveStaticPath
};
