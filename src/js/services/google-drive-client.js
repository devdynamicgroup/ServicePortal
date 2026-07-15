/**
 * Frontend Google Drive upload client.
 * Converts captured data URLs into Drive file metadata for job draft storage.
 */

const DriveUploadInflight = new Set();
const DriveContentBlobCache = new Map();
const DRIVE_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const DRIVE_UPLOAD_TIMEOUT_MS = 90_000;
const DRIVE_COMPRESS_MAX_WIDTH = 1280;
const DRIVE_COMPRESS_QUALITY = 0.75;
const DRIVE_RETRYABLE_CODES = new Set(['NETWORK_ERROR', 'UPLOAD_TIMEOUT', 'UNAVAILABLE']);
const DRIVE_QUEUE_KEY = 'wm-drive-upload-queue';
const DRIVE_QUEUE_FALLBACK_PAYLOAD_KEY = 'wm-drive-upload-queue-payloads';
const DRIVE_QUEUE_IDB_NAME = 'wm-drive-upload-db';
const DRIVE_QUEUE_IDB_STORE = 'payloads';
const DRIVE_QUEUE_MAX = 40;
const driveQueuePayloadMemory = new Map();
let driveQueueIdbPromise = null;
let driveQueueMigrated = false;

function openDriveQueueIdb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (driveQueueIdbPromise) return driveQueueIdbPromise;

  driveQueueIdbPromise = new Promise(resolve => {
    try {
      const request = indexedDB.open(DRIVE_QUEUE_IDB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DRIVE_QUEUE_IDB_STORE)) {
          db.createObjectStore(DRIVE_QUEUE_IDB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('Drive queue IndexedDB unavailable', request.error);
        resolve(null);
      };
    } catch (error) {
      console.warn('Drive queue IndexedDB open failed', error);
      resolve(null);
    }
  });

  return driveQueueIdbPromise;
}

function idbReq(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function readFallbackPayloadMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DRIVE_QUEUE_FALLBACK_PAYLOAD_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeFallbackPayloadMap(map) {
  try {
    const keys = Object.keys(map);
    if (!keys.length) {
      localStorage.removeItem(DRIVE_QUEUE_FALLBACK_PAYLOAD_KEY);
      return;
    }
    // Keep only payloads referenced by current meta / last DRIVE_QUEUE_MAX keys.
    const trimmed = {};
    keys.slice(-DRIVE_QUEUE_MAX).forEach(key => {
      trimmed[key] = map[key];
    });
    localStorage.setItem(DRIVE_QUEUE_FALLBACK_PAYLOAD_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.warn('Drive queue fallback payload write failed', error);
  }
}

async function putQueuePayload(queueKey, dataUrl) {
  if (!queueKey || !dataUrl) return;
  driveQueuePayloadMemory.set(queueKey, dataUrl);

  const db = await openDriveQueueIdb();
  if (db) {
    try {
      const tx = db.transaction(DRIVE_QUEUE_IDB_STORE, 'readwrite');
      await idbReq(tx.objectStore(DRIVE_QUEUE_IDB_STORE).put(dataUrl, queueKey));
      // Prefer IDB — drop any legacy fallback copy for this key.
      const fallback = readFallbackPayloadMap();
      if (fallback[queueKey]) {
        delete fallback[queueKey];
        writeFallbackPayloadMap(fallback);
      }
      return;
    } catch (error) {
      console.warn('Drive queue payload put failed', error);
    }
  }

  const fallback = readFallbackPayloadMap();
  fallback[queueKey] = dataUrl;
  writeFallbackPayloadMap(fallback);
}

async function getQueuePayload(queueKey) {
  if (!queueKey) return '';
  if (driveQueuePayloadMemory.has(queueKey)) return driveQueuePayloadMemory.get(queueKey) || '';

  const db = await openDriveQueueIdb();
  if (db) {
    try {
      const tx = db.transaction(DRIVE_QUEUE_IDB_STORE, 'readonly');
      const value = await idbReq(tx.objectStore(DRIVE_QUEUE_IDB_STORE).get(queueKey));
      if (value) {
        driveQueuePayloadMemory.set(queueKey, value);
        return value;
      }
    } catch (error) {
      console.warn('Drive queue payload get failed', error);
    }
  }

  const fallback = readFallbackPayloadMap()[queueKey];
  if (fallback) {
    driveQueuePayloadMemory.set(queueKey, fallback);
    return fallback;
  }
  return '';
}

async function deleteQueuePayload(queueKey) {
  if (!queueKey) return;
  driveQueuePayloadMemory.delete(queueKey);

  const fallback = readFallbackPayloadMap();
  if (fallback[queueKey]) {
    delete fallback[queueKey];
    writeFallbackPayloadMap(fallback);
  }

  const db = await openDriveQueueIdb();
  if (!db) return;
  try {
    const tx = db.transaction(DRIVE_QUEUE_IDB_STORE, 'readwrite');
    await idbReq(tx.objectStore(DRIVE_QUEUE_IDB_STORE).delete(queueKey));
  } catch (error) {
    console.warn('Drive queue payload delete failed', error);
  }
}

function stripQueueMeta(item = {}) {
  return {
    queueKey: item.queueKey,
    jobId: item.jobId != null ? String(item.jobId) : null,
    tapIndex: item.tapIndex ?? null,
    taskKey: item.taskKey || null,
    previewId: item.previewId || null,
    purpose: item.purpose || 'photo',
    folder: item.folder || purposeToFolder(item.purpose || 'photo', item.contentType, item.filename),
    isSlip: Boolean(item.isSlip),
    createdAt: item.createdAt || new Date().toISOString(),
    attempts: Number(item.attempts || 0),
    lastError: item.lastError || null,
    hasPayload: true
  };
}

function readDriveQueueMeta() {
  try {
    const raw = localStorage.getItem(DRIVE_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDriveQueueMeta(items) {
  try {
    const metaOnly = items.slice(0, DRIVE_QUEUE_MAX).map(item => stripQueueMeta(item));
    localStorage.setItem(DRIVE_QUEUE_KEY, JSON.stringify(metaOnly));
  } catch (error) {
    console.warn('Could not persist Drive upload queue metadata', error);
  }
}

/**
 * Migrate legacy queue entries that still embed dataUrl in localStorage.
 * Safe no-op if the queue is already metadata-only.
 */
async function migrateLegacyDriveQueue() {
  if (driveQueueMigrated) return;
  driveQueueMigrated = true;

  const legacy = readDriveQueueMeta();
  if (!legacy.length) return;

  let changed = false;
  for (const item of legacy) {
    if (!item?.queueKey) continue;
    if (item.dataUrl && String(item.dataUrl).startsWith('data:')) {
      await putQueuePayload(item.queueKey, item.dataUrl);
      changed = true;
    }
  }

  if (changed || legacy.some(item => item && Object.prototype.hasOwnProperty.call(item, 'dataUrl'))) {
    writeDriveQueueMeta(legacy);
  }
}

async function readDriveQueue() {
  try {
    await migrateLegacyDriveQueue();
    const meta = readDriveQueueMeta();
    const hydrated = [];
    for (const item of meta) {
      if (!item?.queueKey) continue;
      const dataUrl = (await getQueuePayload(item.queueKey))
        || (item.dataUrl && String(item.dataUrl).startsWith('data:') ? item.dataUrl : '');
      if (!dataUrl) continue;
      hydrated.push({ ...stripQueueMeta(item), dataUrl });
    }
    return hydrated;
  } catch (error) {
    console.warn('Drive queue read failed', error);
    return [];
  }
}

/**
 * Lightweight queue entry — metadata in localStorage, image payload in IndexedDB when available.
 * Dedupes by queueKey (job + tap + purpose).
 */
async function enqueueDriveUpload(task = {}) {
  await migrateLegacyDriveQueue();
  const queueKey = task.queueKey || `${task.jobId || 'job'}:${task.tapIndex ?? 'x'}:${task.purpose || 'photo'}`;
  const queue = readDriveQueueMeta().filter(item => item && item.queueKey !== queueKey);

  if (task.dataUrl) {
    await putQueuePayload(queueKey, task.dataUrl);
  }

  queue.push(stripQueueMeta({ ...task, queueKey }));
  writeDriveQueueMeta(queue);
  return queueKey;
}

async function removeDriveQueueItem(queueKey) {
  await migrateLegacyDriveQueue();
  const next = readDriveQueueMeta().filter(item => item && item.queueKey !== queueKey);
  await deleteQueuePayload(queueKey);
  writeDriveQueueMeta(next);
}

function drivePhotoPreviewSrc(photo) {
  if (!photo) return '';
  if (typeof photo === 'string') {
    // Legacy base64 / data URL — ok as img src. Auth content URLs need hydrateImg.
    if (photo.startsWith('data:')) return photo;
    if (photo.includes('/api/drive/images/') && photo.includes('/content')) {
      const cached = DriveContentBlobCache.get(fileIdFromContentUrl(photo));
      return cached || '';
    }
    return photo;
  }
  if (photo.previewUrl) return photo.previewUrl;
  if (photo.fileId && DriveContentBlobCache.has(photo.fileId)) {
    return DriveContentBlobCache.get(photo.fileId);
  }
  // Do not return contentUrl directly — endpoint requires app auth.
  return '';
}

function fileIdFromContentUrl(url) {
  const match = String(url || '').match(/\/api\/drive\/images\/([^/]+)\/content/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function isDrivePhotoMeta(photo) {
  return Boolean(photo && typeof photo === 'object' && (photo.fileId || photo.uploading || photo.uploadError));
}

function isDrivePhotoUploaded(photo) {
  return Boolean(photo && typeof photo === 'object' && photo.fileId);
}

function shouldUploadCapturedImage(photo) {
  if (!photo) return true;
  if (typeof photo === 'string') return photo.startsWith('data:');
  if (photo.fileId) return false;
  if (photo.uploading) return false;
  return Boolean(photo.previewUrl || photo.uploadError || photo.pendingAutoRetry);
}

function isRetryableDriveError(error) {
  return DRIVE_RETRYABLE_CODES.has(error?.code);
}

function purposeToFolder(purpose, contentType, filename) {
  const key = String(purpose || '').toLowerCase();
  const mime = String(contentType || '').toLowerCase().split(';')[0].trim();
  const name = String(filename || '');

  if (
    mime === 'application/json'
    || mime === 'text/json'
    || mime.endsWith('+json')
    || /\.jsonl?$/i.test(name)
    || key === 'json'
    || key === 'assessment'
    || key === 'export'
    || key === 'backup'
    || key === 'metadata'
    || key === 'report'
    || key === 'reports'
    || key === 'data'
  ) {
    return 'data';
  }
  // All image / field photo purposes → MAIN folder
  return 'main';
}

function guessContentType(dataUrl, fallback = 'image/jpeg') {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,/i);
  return match?.[1] || fallback;
}

function buildDriveFilename(purpose, ext = 'jpg') {
  const tapLabel = (typeof S !== 'undefined' && S.taps?.[S.activeTap])
    ? String(S.taps[S.activeTap]).replace(/\s+/g, '-').toLowerCase()
    : 'tap';
  const safePurpose = String(purpose || 'photo').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return `${safePurpose}-${tapLabel}-${Date.now()}.${ext}`;
}

function currentJobId() {
  if (typeof S === 'undefined' || !S.activeJob) return null;
  return S.activeJob.id || S.activeJob.notionId || null;
}

function currentUsername() {
  if (typeof S !== 'undefined' && S.user?.username) return S.user.username;
  try {
    const session = JSON.parse(localStorage.getItem('wm-session') || '{}');
    return session.user?.username || null;
  } catch {
    return null;
  }
}

function estimateDataUrlBytes(dataUrl) {
  const match = String(dataUrl || '').match(/^data:[^;]+;base64,(.+)$/i);
  const b64 = match ? match[1] : '';
  if (!b64) return 0;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

function driveClientError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function getDriveAuthHeaders() {
  if (typeof getAppAuthHeaders === 'function') return getAppAuthHeaders();
  try {
    const session = JSON.parse(localStorage.getItem('wm-session') || '{}');
    return session.token ? { Authorization: `Bearer ${session.token}` } : {};
  } catch {
    return {};
  }
}

function mapUploadHttpError(status, serverMessage) {
  const msg = String(serverMessage || '').trim();
  if (status === 401) {
    if (/authentication required|expired session|invalid or expired|sign in/i.test(msg)) {
      return driveClientError(msg || 'Please sign in again to upload photos.', 'APP_AUTH_REQUIRED', status);
    }
    return driveClientError(
      msg || 'Drive authentication failed. Contact support if this keeps happening.',
      'AUTH_FAILED',
      status
    );
  }
  if (status === 403) {
    if (/permission|share|service account|folder|drive api/i.test(msg)) {
      return driveClientError(
        msg || 'Drive permission denied. The upload folder may not be shared with the service account.',
        'PERMISSION_DENIED',
        status
      );
    }
    return driveClientError(
      msg || 'You are not authorized to upload to Drive.',
      'FORBIDDEN',
      status
    );
  }
  if (status === 413) {
    return driveClientError(
      msg || 'Image is too large to upload. Try a smaller photo.',
      'TOO_LARGE',
      status
    );
  }
  if (status === 503 || status === 504) {
    return driveClientError(
      msg || 'Drive is temporarily unavailable. Tap to retry.',
      'UNAVAILABLE',
      status
    );
  }
  if (status === 502) {
    return driveClientError(
      msg || 'Network error talking to Drive. Tap to retry.',
      'NETWORK_ERROR',
      status
    );
  }
  return driveClientError(msg || `Drive upload failed (${status})`, 'UPLOAD_FAILED', status);
}

/**
 * Resize to max 1280px width and JPEG-compress (~75%) for upload / local draft.
 */
function compressImageDataUrl(dataUrl, options = {}) {
  const maxWidth = options.maxWidth || DRIVE_COMPRESS_MAX_WIDTH;
  const quality = options.quality == null ? DRIVE_COMPRESS_QUALITY : options.quality;

  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return Promise.resolve(dataUrl);
  }

  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        if (!width || !height) {
          resolve(dataUrl);
          return;
        }
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function fetchDriveContentObjectUrl(fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw driveClientError('Missing file id', 'INVALID_IMAGE');
  if (DriveContentBlobCache.has(id)) return DriveContentBlobCache.get(id);

  const response = await fetch(`/api/drive/images/${encodeURIComponent(id)}/content`, {
    method: 'GET',
    headers: { ...getDriveAuthHeaders() },
    credentials: 'same-origin',
    cache: 'no-store'
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw mapUploadHttpError(response.status, data.error);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  DriveContentBlobCache.set(id, objectUrl);
  return objectUrl;
}

/**
 * Set img.src for Drive-backed photos using auth fetch when needed.
 * Prefer data URL / cached blob; fall back to authenticated content download.
 */
async function hydrateDriveImg(img, photo, fallbackDataUrl) {
  if (!img) return;
  const syncSrc = drivePhotoPreviewSrc(photo);
  if (syncSrc) {
    img.src = syncSrc;
    img.style.display = 'block';
    return;
  }
  if (fallbackDataUrl) {
    img.src = fallbackDataUrl;
    img.style.display = 'block';
  }

  const fileId = (photo && typeof photo === 'object' && photo.fileId)
    ? photo.fileId
    : fileIdFromContentUrl(typeof photo === 'string' ? photo : photo?.contentUrl);

  if (!fileId) return;
  try {
    const objectUrl = await fetchDriveContentObjectUrl(fileId);
    img.src = objectUrl;
    img.style.display = 'block';
  } catch (error) {
    console.warn('Drive preview hydrate failed', error);
    if (fallbackDataUrl && img.src !== fallbackDataUrl) img.src = fallbackDataUrl;
  }
}

async function uploadDriveImage({
  dataUrl,
  filename,
  purpose,
  folder,
  contentType,
  description,
  jobId
} = {}) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw driveClientError('A data URL image is required for Drive upload', 'INVALID_IMAGE');
  }

  const compressed = await compressImageDataUrl(dataUrl);
  const approxBytes = estimateDataUrlBytes(compressed);
  if (approxBytes > DRIVE_MAX_UPLOAD_BYTES) {
    throw driveClientError(
      `Image is too large to upload (max ${Math.round(DRIVE_MAX_UPLOAD_BYTES / (1024 * 1024))} MB).`,
      'TOO_LARGE',
      413
    );
  }

  const resolvedPurpose = purpose || 'photo';
  const mime = contentType || guessContentType(compressed, 'image/jpeg');
  const resolvedFilename = filename || buildDriveFilename(resolvedPurpose, mime.includes('png') ? 'png' : 'jpg');
  const resolvedFolder = folder || purposeToFolder(resolvedPurpose, mime, resolvedFilename);
  const resolvedJobId = jobId != null ? String(jobId) : currentJobId();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRIVE_UPLOAD_TIMEOUT_MS);
  const requestUrl = '/api/drive/images';
  // Non-sensitive debug: record upload attempt (do not include the image data)
  try {
    console.log('[drive-client] upload attempt', {
      url: requestUrl,
      purpose: resolvedPurpose,
      folder: resolvedFolder,
      filename: resolvedFilename,
      approxBytes
    });
  } catch (e) { /* ignore */ }

  let response;
  try {
    response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getDriveAuthHeaders()
      },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify({
        dataUrl: compressed,
        filename: resolvedFilename,
        contentType: mime,
        purpose: resolvedPurpose,
        folder: resolvedFolder,
        description,
        jobId: resolvedJobId
      })
    });
  } catch (error) {
    // Log network / fetch-level errors.
    try { console.error('[drive-client] network error', { url: requestUrl, message: error?.message || String(error) }); } catch (e) { /* ignore */ }
    if (error?.name === 'AbortError') {
      throw driveClientError('Upload timed out. Tap to retry.', 'UPLOAD_TIMEOUT');
    }
    throw driveClientError('Network interrupted during upload. Tap to retry.', 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }

  // Parse response body (JSON if possible) and log full body for diagnostics.
  let data;
  try {
    data = await response.json();
  } catch (err) {
    try { data = { _raw: await response.text() }; } catch { data = {}; }
  }
  try {
    console.log('[drive-client] upload response', { url: requestUrl, status: response.status, ok: response.ok, body: data });
  } catch (e) { /* ignore */ }
  if (!response.ok || !data.ok || !data.file?.id) {
    throw mapUploadHttpError(response.status, data.error);
  }

  return {
    fileId: data.file.id,
    filename: data.file.name,
    folder: data.file.folder || resolvedFolder,
    folderId: data.file.folderId || null,
    purpose: data.file.purpose || resolvedPurpose,
    uploadedAt: data.file.createdTime || new Date().toISOString(),
    uploadedBy: data.file.uploadedBy || currentUsername(),
    jobId: data.file.jobId || resolvedJobId,
    contentUrl: data.file.contentUrl || `/api/drive/images/${encodeURIComponent(data.file.id)}/content`,
    mimeType: data.file.mimeType || mime,
    webViewLink: data.file.webViewLink || null,
    thumbnailLink: data.file.thumbnailLink || null,
    previewUrl: compressed
  };
}

/**
 * Upload a newly captured image once. Skips if already uploaded / in flight.
 * Returns Drive metadata (without embedding the full data URL permanently on server).
 */
async function uploadCapturedImageOnce({
  dataUrl,
  purpose,
  folder,
  filename,
  inflightKey,
  jobId
} = {}) {
  const key = inflightKey || `${purpose || 'photo'}:${String(dataUrl || '').slice(0, 64)}`;
  if (DriveUploadInflight.has(key)) {
    throw driveClientError('Upload already in progress', 'UPLOAD_IN_FLIGHT');
  }

  DriveUploadInflight.add(key);
  try {
    return await uploadDriveImage({ dataUrl, purpose, folder, filename, jobId });
  } finally {
    DriveUploadInflight.delete(key);
  }
}

window.DrivePhoto = {
  previewSrc: drivePhotoPreviewSrc,
  isMeta: isDrivePhotoMeta,
  isUploaded: isDrivePhotoUploaded,
  shouldUpload: shouldUploadCapturedImage,
  purposeToFolder,
  upload: uploadDriveImage,
  uploadOnce: uploadCapturedImageOnce,
  buildFilename: buildDriveFilename,
  compress: compressImageDataUrl,
  hydrateImg: hydrateDriveImg,
  fetchContentObjectUrl: fetchDriveContentObjectUrl,
  isRetryableError: isRetryableDriveError,
  enqueue: enqueueDriveUpload,
  dequeue: removeDriveQueueItem,
  readQueue: readDriveQueue,
  hasInflight: () => DriveUploadInflight.size > 0,
  maxBytes: DRIVE_MAX_UPLOAD_BYTES,
  timeoutMs: DRIVE_UPLOAD_TIMEOUT_MS,
  retryableCodes: DRIVE_RETRYABLE_CODES
};
