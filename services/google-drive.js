const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const DRIVE_FETCH_TIMEOUT_MS = Number(process.env.GOOGLE_DRIVE_FETCH_TIMEOUT_MS || 60_000);

/** Visit/display photos shown in the field job UI. */
const MAIN_IMAGE_PURPOSES = new Set([
  'main', 'image', 'photo', 'gallery',
  'tap', 'tapphoto', 'tap-photo',
  'visual', 'meter', 'chlorine',
  'payment', 'slip', 'receipt'
]);

/** Secondary/internal capture used for OCR, backups, or raw readings. */
const DATA_IMAGE_PURPOSES = new Set([
  'data', 'secondary', 'raw', 'ocr', 'backup',
  'reading', 'reading-source', 'meter-raw', 'chlorine-raw', 'internal'
]);

let cachedCredentials = null;
let tokenCache = {
  accessToken: null,
  expiresAt: 0
};

function driveError(message, statusCode = 500, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function clearTokenCache() {
  tokenCache = { accessToken: null, expiresAt: 0 };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DRIVE_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw driveError('Google Drive request timed out. Please try again.', 504);
    }
    throw driveError(error.message || 'Google Drive network error', 502);
  } finally {
    clearTimeout(timer);
  }
}

function classifyDriveApiError(status, data, fallbackMessage) {
  const raw = String(
    data?.error?.message
    || data?.error_description
    || (typeof data === 'string' ? data : '')
    || fallbackMessage
    || ''
  );
  const reason = String(data?.error?.errors?.[0]?.reason || data?.error || '');

  if (status === 401 || /invalid_grant|unauthorized|invalid_client|invalid_token/i.test(raw + reason)) {
    return driveError(
      'Google Drive authentication failed. Check the service account credentials.',
      401,
      data
    );
  }
  if (
    status === 403
    || /insufficientPermissions|storageQuotaExceeded|accessNotConfigured|forbidden/i.test(reason)
    || /insufficient|permission|not been used|disabled|access denied/i.test(raw)
  ) {
    return driveError(
      'Google Drive permission denied. Share the target folders with the service account as Editor, and ensure Drive API is enabled.',
      403,
      data
    );
  }
  if (status === 404 || /notFound/i.test(reason)) {
    return driveError(
      'Google Drive folder or file was not found. Check GOOGLE_DRIVE_MAIN_FOLDER_ID / GOOGLE_DRIVE_DATA_FOLDER_ID.',
      404,
      data
    );
  }
  if (status === 413 || /too large|payload/i.test(raw)) {
    return driveError(`Image exceeds max size of ${MAX_UPLOAD_BYTES} bytes`, 413, data);
  }
  return driveError(
    raw || `Google Drive request failed (${status})`,
    status >= 400 && status < 600 ? status : 502,
    data
  );
}

function estimateBase64DecodedBytes(b64) {
  const cleaned = String(b64 || '').replace(/\s+/g, '');
  if (!cleaned) return 0;
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

function getMainFolderId() {
  return String(
    process.env.GOOGLE_DRIVE_MAIN_FOLDER_ID
    || process.env.GOOGLE_DRIVE_FOLDER_ID
    || ''
  ).trim();
}

function getDataFolderId() {
  return String(process.env.GOOGLE_DRIVE_DATA_FOLDER_ID || '').trim();
}

/** @deprecated Prefer resolveFolderKey / getMainFolderId. Kept for callers expecting a single folder. */
function getFolderId() {
  return getMainFolderId();
}

function getConfiguredFolderIds() {
  return {
    main: getMainFolderId() || null,
    data: getDataFolderId() || null
  };
}

function listAllowedFolderIds() {
  return Object.values(getConfiguredFolderIds()).filter(Boolean);
}

/**
 * Resolve which Drive folder to use.
 * Accepts: folder key ("main"|"data"), purpose/useCase, or a configured folder id.
 * Default: main (backward compatible).
 */
function resolveFolderKey(input = {}) {
  const rawFolder = String(input.folder || input.folderKey || '').trim();
  const rawPurpose = String(input.purpose || input.useCase || input.type || '').trim().toLowerCase();
  const folders = getConfiguredFolderIds();

  if (rawFolder) {
    const key = rawFolder.toLowerCase();
    if (key === 'main' || key === 'primary') return 'main';
    if (key === 'data' || key === 'secondary') return 'data';
    if (folders.main && rawFolder === folders.main) return 'main';
    if (folders.data && rawFolder === folders.data) return 'data';
    throw driveError(`Unknown Drive folder "${rawFolder}". Use "main" or "data".`, 400);
  }

  if (rawPurpose) {
    if (DATA_IMAGE_PURPOSES.has(rawPurpose)) return 'data';
    if (MAIN_IMAGE_PURPOSES.has(rawPurpose)) return 'main';
    // Unknown purpose → main (safe default for field photos)
    return 'main';
  }

  return 'main';
}

function requireFolderId(folderKey = 'main') {
  const key = folderKey === 'data' ? 'data' : 'main';
  const folderId = key === 'data' ? getDataFolderId() : getMainFolderId();
  if (!folderId) {
    const envName = key === 'data'
      ? 'GOOGLE_DRIVE_DATA_FOLDER_ID'
      : 'GOOGLE_DRIVE_MAIN_FOLDER_ID (or legacy GOOGLE_DRIVE_FOLDER_ID)';
    throw driveError(`${envName} is required`, 503);
  }
  return folderId;
}

function getServiceAccountEmail() {
  try {
    return loadServiceAccountCredentials()?.client_email || null;
  } catch {
    return null;
  }
}

function loadServiceAccountCredentials() {
  if (cachedCredentials) return cachedCredentials;

  const inline = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (inline) {
    try {
      cachedCredentials = JSON.parse(inline);
    } catch (error) {
      throw driveError('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON', 500, error.message);
    }
  } else {
    const configuredPath = String(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || '').trim();
    const candidate = configuredPath
      ? (path.isAbsolute(configuredPath) ? configuredPath : path.join(process.cwd(), configuredPath))
      : path.join(process.cwd(), 'credentials', 'google-service-account.json');

    if (!fs.existsSync(candidate)) {
      throw driveError(
        `Google Drive service account credentials not found. Set GOOGLE_SERVICE_ACCOUNT_KEY_PATH or GOOGLE_SERVICE_ACCOUNT_JSON (looked for ${candidate})`,
        503
      );
    }
    try {
      cachedCredentials = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch (error) {
      throw driveError(`Unable to read service account credentials: ${error.message}`, 500);
    }
  }

  if (!cachedCredentials?.client_email || !cachedCredentials?.private_key) {
    throw driveError('Service account JSON must include client_email and private_key', 500);
  }
  return cachedCredentials;
}

function isDriveConfigured() {
  try {
    loadServiceAccountCredentials();
    return Boolean(getMainFolderId());
  } catch {
    return false;
  }
}

function getDriveStatus() {
  let credentialsLoaded = false;
  let credentialsError = null;
  try {
    loadServiceAccountCredentials();
    credentialsLoaded = true;
  } catch (error) {
    credentialsError = error.message;
  }

  // Do NOT expose raw credentials or private_key here. Only return booleans and service account email.
  const mainConfigured = Boolean(getMainFolderId());
  const dataConfigured = Boolean(getDataFolderId());
  const configured = Boolean(credentialsLoaded && mainConfigured);

  return {
    configured,
    credentialsLoaded: Boolean(credentialsLoaded),
    serviceAccountEmail: credentialsLoaded ? getServiceAccountEmail() : null,
    mainFolderConfigured: mainConfigured,
    dataFolderConfigured: dataConfigured,
    error: credentialsError || null
  };
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createSignedJwt(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: credentials.client_email,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(credentials.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${unsigned}.${signature}`;
}

async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.accessToken;
  }

  const credentials = loadServiceAccountCredentials();
  const assertion = createSignedJwt(credentials);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  });

  let response;
  try {
    response = await fetchWithTimeout(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
  } catch (error) {
    clearTokenCache();
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    clearTokenCache();
    throw classifyDriveApiError(
      response.status,
      data,
      `Failed to obtain Google Drive access token (${response.status})`
    );
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
  };
  return tokenCache.accessToken;
}

async function driveFetch(pathname, options = {}, _retried = false) {
  const token = await getAccessToken();
  const url = pathname.startsWith('http') ? pathname : `${DRIVE_API}${pathname}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };

  const response = await fetchWithTimeout(url, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => ({}));
  } else if (options.raw) {
    data = response;
  } else if (!response.ok) {
    data = await response.text().catch(() => '');
  }

  if (!response.ok) {
    if (response.status === 401 && !_retried) {
      clearTokenCache();
      return driveFetch(pathname, options, true);
    }
    throw classifyDriveApiError(
      response.status,
      typeof data === 'string' ? { error: { message: data } } : data,
      `Google Drive request failed (${response.status})`
    );
  }
  return data;
}

function parseDataUrlOrBase64(input) {
  const raw = String(input || '').trim();
  if (!raw) throw driveError('Image data is required', 400);

  const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/i);
  const b64 = dataUrlMatch ? dataUrlMatch[2] : raw.replace(/\s+/g, '');
  const estimated = estimateBase64DecodedBytes(b64);
  if (estimated > MAX_UPLOAD_BYTES) {
    throw driveError(`Image exceeds max size of ${MAX_UPLOAD_BYTES} bytes`, 413);
  }

  if (dataUrlMatch) {
    return {
      contentType: dataUrlMatch[1],
      buffer: Buffer.from(dataUrlMatch[2], 'base64')
    };
  }

  return {
    contentType: null,
    buffer: Buffer.from(b64, 'base64')
  };
}

function sanitizeFilename(name, contentType) {
  const fallbackExt = (contentType || '').includes('png')
    ? 'png'
    : (contentType || '').includes('webp')
      ? 'webp'
      : 'jpg';
  const cleaned = String(name || `upload-${Date.now()}.${fallbackExt}`)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .trim();
  return cleaned || `upload-${Date.now()}.${fallbackExt}`;
}

function mapFileMetadata(file, options = {}) {
  const base = String(options.publicBaseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const folderKey = options.folderKey || null;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size ? Number(file.size) : null,
    createdTime: file.createdTime || null,
    modifiedTime: file.modifiedTime || null,
    folder: folderKey,
    folderId: options.folderId || null,
    webViewLink: file.webViewLink || null,
    webContentLink: file.webContentLink || null,
    thumbnailLink: file.thumbnailLink || null,
    iconLink: file.iconLink || null,
    // App-authenticated proxy URL (works without making the file public).
    contentUrl: base ? `${base}/api/drive/images/${encodeURIComponent(file.id)}/content` : `/api/drive/images/${encodeURIComponent(file.id)}/content`
  };
}

async function makeFileReadableByLink(fileId) {
  await driveFetch(`/files/${encodeURIComponent(fileId)}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'reader',
      type: 'anyone'
    })
  });
}

async function uploadImage({
  filename,
  contentType,
  dataUrl,
  base64,
  buffer,
  description,
  makePublic,
  folder,
  purpose,
  useCase,
  type
} = {}) {
  const folderKey = resolveFolderKey({ folder, purpose, useCase, type });
  const folderId = requireFolderId(folderKey);
  loadServiceAccountCredentials();

  let bytes = buffer || null;
  let mime = contentType || 'application/octet-stream';

  if (!bytes) {
    const parsed = parseDataUrlOrBase64(dataUrl || base64);
    bytes = parsed.buffer;
    mime = contentType || parsed.contentType || mime;
  }

  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes);
  if (!bytes.length) throw driveError('Uploaded image is empty', 400);
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw driveError(`Image exceeds max size of ${MAX_UPLOAD_BYTES} bytes`, 413);
  }

  // Non-sensitive debug: log upload target and size (do NOT print credentials or image data)
  try {
    const saEmail = getServiceAccountEmail();
    console.log('[google-drive] Uploading image', {
      serviceAccountEmail: saEmail,
      folderKey,
      folderId,
      bytes: bytes.length,
      suggestedFilename: filename || null
    });
  } catch (e) { /* ignore logging failures */ }

  const safeName = sanitizeFilename(filename, mime);
  const metadata = {
    name: safeName,
    parents: [folderId],
    mimeType: mime.startsWith('image/') ? mime : 'image/jpeg'
  };
  if (description) metadata.description = String(description).slice(0, 1000);

  const boundary = `wmbound${crypto.randomBytes(12).toString('hex')}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
    + `--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([preamble, bytes, epilogue]);

  const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${encodeURIComponent('id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,iconLink')}`;
  const created = await driveFetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length)
    },
    body
  });

  const shouldPublic = makePublic != null
    ? Boolean(makePublic)
    : String(process.env.GOOGLE_DRIVE_MAKE_PUBLIC || '').toLowerCase() === 'true';

  if (shouldPublic) {
    try {
      await makeFileReadableByLink(created.id);
    } catch (error) {
      console.warn('[google-drive] Could not set public permission:', error.message);
    }
  }

  return mapFileMetadata(created, { folderKey, folderId });
}

async function listImages({ pageSize = 50, pageToken, folder, purpose, useCase, type } = {}) {
  const folderKey = resolveFolderKey({ folder, purpose, useCase, type });
  const folderId = requireFolderId(folderKey);
  const size = Math.min(Math.max(Number(pageSize) || 50, 1), 100);
  const params = new URLSearchParams({
    q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType contains 'image/'`,
    spaces: 'drive',
    pageSize: String(size),
    orderBy: 'createdTime desc',
    fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,iconLink)'
  });
  if (pageToken) params.set('pageToken', pageToken);

  const data = await driveFetch(`/files?${params.toString()}`);
  return {
    folder: folderKey,
    folderId,
    files: (data.files || []).map(file => mapFileMetadata(file, { folderKey, folderId })),
    nextPageToken: data.nextPageToken || null
  };
}

async function getImage(fileId) {
  if (!fileId) throw driveError('File id is required', 400);
  const file = await driveFetch(
    `/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent('id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,iconLink,parents,trashed')}`
  );
  if (file.trashed) throw driveError('File is in trash', 404);

  const allowed = listAllowedFolderIds();
  const parents = Array.isArray(file.parents) ? file.parents : [];
  if (allowed.length && !parents.some(id => allowed.includes(id))) {
    throw driveError('File is outside the configured Drive folders', 403);
  }

  const folders = getConfiguredFolderIds();
  let folderKey = null;
  let folderId = null;
  if (folders.main && parents.includes(folders.main)) {
    folderKey = 'main';
    folderId = folders.main;
  } else if (folders.data && parents.includes(folders.data)) {
    folderKey = 'data';
    folderId = folders.data;
  }

  return mapFileMetadata(file, { folderKey, folderId });
}

async function deleteImage(fileId) {
  await getImage(fileId);
  await driveFetch(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  return { deleted: true, id: fileId };
}

async function downloadImageContent(fileId) {
  await getImage(fileId);

  const attempt = async (retried) => {
    const token = await getAccessToken();
    const response = await fetchWithTimeout(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) {
      if (response.status === 401 && !retried) {
        clearTokenCache();
        return attempt(true);
      }
      const detail = await response.text().catch(() => '');
      throw classifyDriveApiError(
        response.status,
        { error: { message: detail || `Unable to download file (${response.status})` } },
        `Unable to download file (${response.status})`
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get('content-type') || 'application/octet-stream'
    };
  };

  return attempt(false);
}

module.exports = {
  isDriveConfigured,
  getDriveStatus,
  getConfiguredFolderIds,
  resolveFolderKey,
  uploadImage,
  listImages,
  getImage,
  deleteImage,
  downloadImageContent,
  MAX_UPLOAD_BYTES
};
