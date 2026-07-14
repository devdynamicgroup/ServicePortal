const {
  isDriveConfigured,
  getDriveStatus,
  uploadImage,
  listImages,
  getImage,
  deleteImage,
  downloadImageContent,
  MAX_UPLOAD_BYTES
} = require('../services/google-drive');
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
    sendJson(res, 200, {
      ok: true,
      ...getDriveStatus(),
      configured: isDriveConfigured()
    });
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

      const file = await uploadImage({
        filename,
        contentType: payload.contentType || payload.mimeType,
        dataUrl: payload.dataUrl || payload.dataURL,
        base64: payload.base64 || payload.data,
        description: payload.description,
        makePublic: payload.makePublic,
        folder,
        purpose
      });

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
      console.warn('POST /api/drive/images failed', error.message);
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
