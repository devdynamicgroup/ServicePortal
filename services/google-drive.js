const { Readable } = require('stream');
const {
  isOAuthClientConfigured,
  isDriveOAuthReady,
  getDriveClient,
  getRefreshToken,
  getOAuthEnv
} = require('./google-drive-oauth');

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Payment slip folder → GOOGLE_DRIVE_MAIN_FOLDER_ID ("Payment slip").
 * Only payment receipts go here.
 */
const MAIN_IMAGE_PURPOSES = new Set([
  'main', 'payment', 'slip', 'receipt', 'payment-slip', 'payment_slip'
]);

/**
 * Data / task photos → GOOGLE_DRIVE_DATA_FOLDER_ID ("data image").
 * Meter, tap, visual, chlorine, OCR, and other field captures.
 */
const DATA_IMAGE_PURPOSES = new Set([
  'data', 'secondary', 'raw', 'ocr', 'backup', 'internal',
  'image', 'photo', 'gallery',
  'tap', 'tapphoto', 'tap-photo',
  'visual', 'meter', 'chlorine',
  'reading', 'reading-source', 'meter-raw', 'chlorine-raw'
]);

function driveError(message, statusCode = 500, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
}

function classifyDriveApiError(status, data, fallbackMessage) {
  const googleErrors = Array.isArray(data?.error?.errors)
    ? data.error.errors
    : (Array.isArray(data?.errors) ? data.errors : []);
  const reason = String(googleErrors[0]?.reason || data?.error?.errors?.[0]?.reason || '');
  const raw = String(
    data?.error?.message
    || data?.message
    || data?.error_description
    || (typeof data === 'string' ? data : '')
    || fallbackMessage
    || ''
  );

  try {
    console.warn('[google-drive] API error', {
      status,
      message: raw || null,
      reason: reason || null,
      errors: googleErrors.map(item => ({
        domain: item?.domain || null,
        reason: item?.reason || null,
        message: item?.message || null
      }))
    });
  } catch { /* ignore */ }

  if (status === 401 || /invalid_grant|unauthorized|invalid_client|invalid_token/i.test(raw + reason)) {
    return driveError(
      `Google Drive OAuth failed (${raw || reason || 'unauthorized'}). Re-authorize via /auth/google and update GOOGLE_REFRESH_TOKEN.`,
      401,
      data
    );
  }
  if (status === 403 || /insufficientPermissions|forbidden|accessNotConfigured/i.test(reason + raw)) {
    return driveError(
      `Google Drive permission denied (${raw || reason || 'forbidden'}). `
      + `Confirm the OAuth user owns the target folders and Drive API is enabled. `
      + `Google errors: ${JSON.stringify(googleErrors || [])}`,
      403,
      data
    );
  }
  if (status === 404 || /notFound/i.test(reason)) {
    return driveError(
      `Google Drive folder or file was not found (${raw || 'notFound'}). Check GOOGLE_DRIVE_MAIN_FOLDER_ID / GOOGLE_DRIVE_DATA_FOLDER_ID.`,
      404,
      data
    );
  }
  if (status === 413 || /too large|payload/i.test(raw)) {
    return driveError(`Image exceeds max size of ${MAX_UPLOAD_BYTES} bytes`, 413, data);
  }
  return driveError(
    raw || fallbackMessage || `Google Drive request failed (${status})`,
    status >= 400 && status < 600 ? status : 502,
    data
  );
}

function mapGoogleError(error, fallbackMessage) {
  const status = Number(error?.code || error?.response?.status || error?.statusCode) || 500;
  const data = error?.response?.data || error?.errors || { error: { message: error?.message } };
  if (error?.statusCode && !error?.response) {
    return error;
  }
  return classifyDriveApiError(status, data, fallbackMessage || error?.message);
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
    if (MAIN_IMAGE_PURPOSES.has(rawPurpose)) return 'main';
    if (DATA_IMAGE_PURPOSES.has(rawPurpose)) return 'data';
    // Unknown purposes default to the data-image folder (field photos).
    return 'data';
  }

  return 'data';
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

function isDriveConfigured() {
  return Boolean(isDriveOAuthReady() && getMainFolderId());
}

function getDriveStatus() {
  const env = getOAuthEnv();
  const oauthClientConfigured = isOAuthClientConfigured();
  const refreshTokenSet = Boolean(getRefreshToken());
  const mainConfigured = Boolean(getMainFolderId());
  const dataConfigured = Boolean(getDataFolderId());
  const credentialsLoaded = oauthClientConfigured && refreshTokenSet;
  let error = null;
  if (!oauthClientConfigured) {
    error = 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI missing';
  } else if (!refreshTokenSet) {
    error = 'GOOGLE_REFRESH_TOKEN missing — visit /auth/google to authorize';
  }

  return {
    configured: Boolean(credentialsLoaded && mainConfigured),
    credentialsLoaded,
    authMode: 'oauth',
    oauthClientConfigured,
    refreshTokenSet,
    serviceAccountEmail: null,
    mainFolderConfigured: mainConfigured,
    dataFolderConfigured: dataConfigured,
    folders: getConfiguredFolderIds(),
    makePublic: String(process.env.GOOGLE_DRIVE_MAKE_PUBLIC || '').toLowerCase() === 'true',
    clientIdSet: Boolean(env.clientId),
    error
  };
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
    contentUrl: base
      ? `${base}/api/drive/images/${encodeURIComponent(file.id)}/content`
      : `/api/drive/images/${encodeURIComponent(file.id)}/content`
  };
}

async function makeFileReadableByLink(fileId) {
  const drive = getDriveClient();
  try {
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });
  } catch (error) {
    throw mapGoogleError(error, 'Unable to set public permission');
  }
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

  if (!isDriveOAuthReady()) {
    throw driveError(
      'Google Drive OAuth is not configured. Set GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI and GOOGLE_REFRESH_TOKEN (or visit /auth/google).',
      503
    );
  }

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

  const safeName = sanitizeFilename(filename, mime);
  const mimeType = mime.startsWith('image/') ? mime : 'image/jpeg';
  const requestBody = {
    name: safeName,
    parents: [folderId],
    mimeType
  };
  if (description) requestBody.description = String(description).slice(0, 1000);

  console.log('[google-drive] Uploading image (OAuth)', {
    authMode: 'oauth',
    folderKey,
    folderId,
    bytes: bytes.length,
    suggestedFilename: safeName
  });

  const drive = getDriveClient();
  let created;
  try {
    const response = await drive.files.create({
      requestBody,
      media: {
        mimeType,
        body: Readable.from(bytes)
      },
      fields: 'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,iconLink'
    });
    created = response.data;
  } catch (error) {
    throw mapGoogleError(error, 'Google Drive upload failed');
  }

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
  const drive = getDriveClient();

  try {
    const response = await drive.files.list({
      q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType contains 'image/'`,
      spaces: 'drive',
      pageSize: size,
      pageToken: pageToken || undefined,
      orderBy: 'createdTime desc',
      fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,iconLink)'
    });
    return {
      folder: folderKey,
      folderId,
      files: (response.data.files || []).map(file => mapFileMetadata(file, { folderKey, folderId })),
      nextPageToken: response.data.nextPageToken || null
    };
  } catch (error) {
    throw mapGoogleError(error, 'Unable to list Drive images');
  }
}

async function getImage(fileId) {
  if (!fileId) throw driveError('File id is required', 400);
  const drive = getDriveClient();
  let file;
  try {
    const response = await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,webContentLink,thumbnailLink,iconLink,parents,trashed'
    });
    file = response.data;
  } catch (error) {
    throw mapGoogleError(error, 'Unable to get Drive image metadata');
  }

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
  const drive = getDriveClient();
  try {
    await drive.files.delete({ fileId });
  } catch (error) {
    throw mapGoogleError(error, 'Unable to delete Drive image');
  }
  return { deleted: true, id: fileId };
}

async function downloadImageContent(fileId) {
  await getImage(fileId);
  const drive = getDriveClient();
  try {
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    return {
      buffer: Buffer.from(response.data),
      contentType: response.headers?.['content-type'] || 'application/octet-stream'
    };
  } catch (error) {
    throw mapGoogleError(error, 'Unable to download Drive image');
  }
}

module.exports = {
  isDriveConfigured,
  getDriveStatus,
  getConfiguredFolderIds,
  resolveFolderKey,
  getFolderId,
  uploadImage,
  listImages,
  getImage,
  deleteImage,
  downloadImageContent,
  MAX_UPLOAD_BYTES
};
