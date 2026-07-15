let isDriveConfigured, getDriveStatus, uploadImage, listImages, getImage, deleteImage, downloadImageContent, MAX_UPLOAD_BYTES;
let __drive_module_error = null;
try {
  const _gd = require('../services/google-drive');
  isDriveConfigured = _gd.isDriveConfigured;
  getDriveStatus = _gd.getDriveStatus;
  uploadImage = _gd.uploadImage;
  listImages = _gd.listImages;
  getImage = _gd.getImage;
  deleteImage = _gd.deleteImage;
  downloadImageContent = _gd.downloadImageContent;
  resolveFolderKey = _gd.resolveFolderKey;
  getConfiguredFolderIds = _gd.getConfiguredFolderIds;
  MAX_UPLOAD_BYTES = _gd.MAX_UPLOAD_BYTES;
} catch (e) {
  // Preserve the error for diagnostics but avoid crashing during module load.
  __drive_module_error = e;
  console.warn('[drive] could not load services/google-drive:', e && e.message ? e.message : e);
  // Provide safe fallbacks that throw when used.
  const missing = () => { throw Object.assign(new Error('Drive subsystem unavailable at startup'), { statusCode: 503 }); };
  isDriveConfigured = () => false;
  getDriveStatus = () => ({ configured: false, credentialsLoaded: false, serviceAccountEmail: null, mainFolderConfigured: false, dataFolderConfigured: false, error: String(e && e.message) });
  uploadImage = missing;
  listImages = missing;
  getImage = missing;
  deleteImage = missing;
  downloadImageContent = missing;
  resolveFolderKey = () => 'main';
  getConfiguredFolderIds = () => ({ main: null, data: null });
  MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
}
const { requireAppAuth } = require('../services/app-auth');
const { appendDriveUploadAudit } = require('../services/drive-audit');

const IMAGE_ID_RE = /^\/api\/drive\/images\/([^/]+)(?:\/(content))?$/;
// JSON uploads send base64 (~4/3 of binary) plus metadata wrapper.
const MAX_JSON_UPLOAD_BODY_BYTES = Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 512 * 1024;

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

/** @returns {object|null} authenticated user, or null after writing 401/403 */
function assertDriveAppAuth(req, res) {
  try {
    return requireAppAuth(req);
  } catch (error) {
    sendJson(res, error.statusCode || 401, {
      ok: false,
      error: error.message || 'Authentication required',
      code: error.code || 'UNAUTHENTICATED'
    });
    return null;
  }
}

function readBodyBuffer(req, maxBytes = MAX_JSON_UPLOAD_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { req.pause(); } catch { /* ignore */ }
      reject(error);
    };

    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        // Stop buffering; response is sent in the route catch, then the socket is closed.
        fail(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', fail);
  });
}

function statusFromError(error) {
  const code = Number(error?.statusCode);
  if (Number.isFinite(code) && code >= 400 && code < 600) return code;
  return 500;
}

async function handleGoogleDriveRoute(req, res, urlPath) {
  if (urlPath === '/api/drive/status' && req.method === 'GET') {
    // Return only non-sensitive status fields expected by diagnostics consumers.
    try {
      const ds = getDriveStatus();
      sendJson(res, 200, {
        ok: true,
        configured: Boolean(ds.configured),
        folderConfigured: Boolean(ds.mainFolderConfigured),
        credentialsLoaded: Boolean(ds.credentialsLoaded),
        authMode: ds.authMode || 'oauth',
        oauthClientConfigured: Boolean(ds.oauthClientConfigured),
        refreshTokenSet: Boolean(ds.refreshTokenSet)
      });
    } catch (e) {
      sendJson(res, 200, { ok: true, configured: false, folderConfigured: false, credentialsLoaded: false });
    }
    return true;
  }

  if (urlPath === '/api/drive/images' && req.method === 'GET') {
    if (!assertDriveAppAuth(req, res)) return true;
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const result = await listImages({
        pageSize: params.get('pageSize'),
        pageToken: params.get('pageToken') || undefined,
        folder: params.get('folder') || undefined,
        purpose: params.get('purpose') || params.get('useCase') || params.get('type') || undefined
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      console.warn('GET /api/drive/images failed', error.message);
      sendJson(res, statusFromError(error), {
        ok: false,
        error: error.message || 'Unable to list Drive images'
      });
    }
    return true;
  }

  if (urlPath === '/api/drive/images' && req.method === 'POST') {
    const user = assertDriveAppAuth(req, res);
    if (!user) return true;
    let purpose = null;
    let folder = null;
    let filename = null;
    let jobId = null;
    try {
      const raw = await readBodyBuffer(req);
      // Non-sensitive debug: record that an upload was attempted and approximate payload size.
      try {
        console.log('[drive] Incoming upload attempt', {
          user: user?.username || null,
          url: req.url,
          bodyBytes: raw ? raw.length : 0,
          ip: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null
        });
      } catch (e) { /* continue quietly if logging fails */ }
      const contentType = String(req.headers['content-type'] || '');
      let payload = {};

      if (contentType.includes('application/json') || raw[0] === 0x7b /* { */) {
        payload = JSON.parse(raw.toString('utf8') || '{}');
      } else {
        sendJson(res, 415, {
          ok: false,
          error: 'Send JSON with { filename, contentType?, dataUrl|base64 }'
        });
        return true;
      }

      purpose = payload.purpose || payload.useCase || payload.type || null;
      folder = payload.folder || null;
      filename = payload.filename || payload.name || null;
      jobId = payload.jobId != null ? String(payload.jobId) : null;
      const uploadContentType = payload.contentType || payload.mimeType || null;

      // Log route entry and intended target folder key/id
      try {
        const folderKey = resolveFolderKey({
          folder,
          purpose,
          contentType: uploadContentType,
          mimeType: uploadContentType,
          filename
        });
        const folders = getConfiguredFolderIds();
        const folderId = folders && folders[folderKey] ? folders[folderKey] : null;
        console.log('[Drive Upload]', {
          filename,
          mimeType: uploadContentType,
          folder: folderKey,
          selectedFolderId: folderId
        });
        // Safe, non-sensitive environment presence booleans to help diagnose missing config on hosts like Render.
        try {
          console.log('[drive] env presence', {
            GOOGLE_DRIVE_MAIN_FOLDER_ID: Boolean(String(process.env.GOOGLE_DRIVE_MAIN_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim()),
            GOOGLE_DRIVE_DATA_FOLDER_ID: Boolean(String(process.env.GOOGLE_DRIVE_DATA_FOLDER_ID || '').trim()),
            GOOGLE_CLIENT_ID: Boolean(String(process.env.GOOGLE_CLIENT_ID || '').trim()),
            GOOGLE_REFRESH_TOKEN: Boolean(String(process.env.GOOGLE_REFRESH_TOKEN || '').trim())
          });
        } catch (e) { /* ignore logging failures */ }
      } catch (e) {
        console.warn('[drive] could not resolve folder key for upload', { folder, purpose, message: e && e.message ? e.message : String(e) });
      }

      const file = await uploadImage({
        filename,
        contentType: uploadContentType,
        dataUrl: payload.dataUrl || payload.dataURL,
        base64: payload.base64 || payload.data,
        description: payload.description,
        makePublic: payload.makePublic,
        folder,
        purpose
      });

      try {
        console.log('[drive] upload succeeded', { fileId: file.id, name: file.name, folder: file.folder, folderId: file.folderId, webViewLink: file.webViewLink || null });
      } catch (e) { /* ignore logging failures */ }

      appendDriveUploadAudit({
        user: user.username,
        filename: file.name || filename,
        purpose,
        folder: file.folder || folder,
        jobId,
        success: true,
        fileId: file.id
      });

      sendJson(res, 201, {
        ok: true,
        file: {
          ...file,
          purpose: purpose || null,
          uploadedBy: user.username,
          jobId
        }
      });
    } catch (error) {
      console.warn('POST /api/drive/images failed', error && error.message ? error.message : String(error));
      // If the Drive subsystem provided detailed error info (Google API body), log it for diagnostics.
      try {
        if (error && error.details) {
          console.error('[drive] google api error details:', JSON.stringify(error.details));
        }
      } catch (e) { /* ignore logging failures */ }
      appendDriveUploadAudit({
        user: user.username,
        filename,
        purpose,
        folder,
        jobId,
        success: false,
        error: error.message || 'Unable to upload image'
      });
      if (!res.writableEnded && !res.headersSent) {
        sendJson(res, statusFromError(error), {
          ok: false,
          error: error.message || 'Unable to upload image',
          code: error.code || undefined
        });
      }
      // Drop oversized/aborted uploads after JSON is written so the connection cannot hang.
      if (error?.statusCode === 413) {
        try { req.destroy(); } catch { /* ignore */ }
      }
    }
    return true;
  }

  const match = urlPath.match(IMAGE_ID_RE);
  if (match) {
    const fileId = decodeURIComponent(match[1]);
    const action = match[2] || null;

    if (action === 'content' && req.method === 'GET') {
      if (!assertDriveAppAuth(req, res)) return true;
      try {
        const { buffer, contentType } = await downloadImageContent(fileId);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': String(buffer.length),
          'Cache-Control': 'private, max-age=300'
        });
        res.end(buffer);
      } catch (error) {
        console.warn('GET /api/drive/images/:id/content failed', error.message);
        sendJson(res, statusFromError(error), {
          ok: false,
          error: error.message || 'Unable to download image'
        });
      }
      return true;
    }

    if (!action && req.method === 'GET') {
      if (!assertDriveAppAuth(req, res)) return true;
      try {
        const file = await getImage(fileId);
        sendJson(res, 200, { ok: true, file });
      } catch (error) {
        console.warn('GET /api/drive/images/:id failed', error.message);
        sendJson(res, statusFromError(error), {
          ok: false,
          error: error.message || 'Unable to get image metadata'
        });
      }
      return true;
    }

    if (!action && req.method === 'DELETE') {
      if (!assertDriveAppAuth(req, res)) return true;
      try {
        const result = await deleteImage(fileId);
        sendJson(res, 200, { ok: true, ...result });
      } catch (error) {
        console.warn('DELETE /api/drive/images/:id failed', error.message);
        sendJson(res, statusFromError(error), {
          ok: false,
          error: error.message || 'Unable to delete image'
        });
      }
      return true;
    }
  }

  return false;
}

module.exports = { handleGoogleDriveRoute };
