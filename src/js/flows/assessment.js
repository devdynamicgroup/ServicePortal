const TASK_KEYS = {
  'tapphoto-check': 'tapphoto',
  'visual-check': 'visual',
  'meter-check': 'meter',
  'chlorine-check': 'chlorine',
  'pressure-check': 'pressure',
  'infra-check': 'infra'
};
const TASK_PHOTO_IDS = {
  tapphoto: 'tap-photo-preview',
  visual: 'vis-photo-preview',
  meter: 'meter-photo-preview',
  chlorine: 'cl-photo-preview'
};
const PHOTO_ID_TASKS = Object.fromEntries(Object.entries(TASK_PHOTO_IDS).map(([key, id]) => [id, key]));
const CHECK_SVG = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>';

function ensureTapData() {
  if (!S.tapData) {
    S.tapData = (S.taps || []).map(() => ({ tasks: {}, photos: {} }));
  }
  while (S.tapData.length < S.taps.length) {
    S.tapData.push({ tasks: {}, photos: {} });
  }
}

function initTaps() {
  if (!S.taps?.length) {
    S.taps = [...DEFAULT_TAPS];
    S.activeTap = 0;
    S.tapData = S.taps.map(() => ({ tasks: {}, photos: {} }));
  }
  renderTapTabs();
  renderAssessList();
}

function renderTapTabs() {
  const bar = document.getElementById('tap-tabs');
  if (!bar) return;
  bar.innerHTML = S.taps.map((t, i) => `<button type="button" class="tap-tab${i === S.activeTap ? ' active' : ''}" onclick="switchTap(${i})">${t}</button>`).join('');
  const nameEl = document.getElementById('tap-name');
  if (nameEl) nameEl.value = S.taps[S.activeTap];
}

function switchTap(i) {
  S.activeTap = i;
  renderTapTabs();
  renderAssessList();
  if (S.screen === 's-meter' && window.MeterReadingCapture) MeterReadingCapture.init();
}

function restoreTaskPhoto(previewId) {
  ensureTapData();
  const key = PHOTO_ID_TASKS[previewId];
  let photo = key ? S.tapData[S.activeTap]?.photos?.[key] : null;
  photo = normalizeInterruptedPhoto(photo);
  if (key && photo && photo !== S.tapData[S.activeTap].photos[key]) {
    S.tapData[S.activeTap].photos[key] = photo;
    saveActiveJobState?.();
  }
  if (photo) setPhotoPreview(previewId, photo, { silent: true, skipUpload: true });
}

function restoreCurrentPhotoScreen(screenId) {
  const map = {
    's-photo': 'tap-photo-preview',
    's-visual': 'vis-photo-preview',
    's-meter': 'meter-photo-preview',
    's-chlorine': 'cl-photo-preview'
  };
  if (map[screenId]) restoreTaskPhoto(map[screenId]);
}

function addTap() {
  S.taps.push(`Tap ${S.taps.length + 1}`);
  S.activeTap = S.taps.length - 1;
  ensureTapData();
  renderTapTabs();
  renderAssessList();
}

function updateTapName() {
  const v = document.getElementById('tap-name').value.trim();
  S.taps[S.activeTap] = v || `Tap ${S.activeTap + 1}`;
  renderTapTabs();
  showToast('Tap name updated');
}

function updateAssessScreen() {
  const isFull = S.pkg === 'full';
  ['btn-upgrade-pf', 'btn-upgrade-inf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = isFull ? 'none' : 'inline';
  });
  ['row-pressure', 'row-infra'].forEach(id => {
    const row = document.getElementById(id);
    if (!row) return;
    row.classList.toggle('locked', !isFull);
    const lock = row.querySelector('.assess-lock');
    const chk = row.querySelector('.li-check');
    if (lock) lock.classList.toggle('hidden', isFull);
    if (chk) chk.classList.toggle('hidden', !isFull);
    row.querySelector('.assess-title-lock')?.classList.toggle('dimmed', !isFull);
  });
  renderJobSteps();
  renderTapTabs();
  renderAssessList();
}

function requireFull(screen) {
  if (S.pkg !== 'full') {
    showPkgSheet();
    return;
  }
  goScreen(screen);
}

function captureTaskPhoto(key) {
  const previewId = TASK_PHOTO_IDS[key];
  if (!previewId) return;
  ensureTapData();
  const existing = S.tapData[S.activeTap].photos[key];
  // Never replace Drive metadata with a live <img> content URL.
  if (typeof DrivePhoto !== 'undefined' && DrivePhoto.isUploaded(existing)) return;
  if (typeof DrivePhoto !== 'undefined' && DrivePhoto.isMeta(existing) && existing.previewUrl) return;

  const img = document.getElementById(previewId);
  if (img?.src && img.style.display !== 'none' && img.src.startsWith('data:')) {
    S.tapData[S.activeTap].photos[key] = img.src;
  }
}

function renderAssessList() {
  ensureTapData();
  const data = S.tapData[S.activeTap] || { tasks: {}, photos: {} };

  Object.entries(TASK_KEYS).forEach(([checkId, key]) => {
    const el = document.getElementById(checkId);
    if (!el) return;
    const done = !!data.tasks[key];
    el.classList.toggle('done', done);
    el.innerHTML = done ? CHECK_SVG : '';
  });

  ['tapphoto', 'meter', 'chlorine'].forEach(key => {
    const thumbEl = document.getElementById(`thumb-${key}`);
    if (!thumbEl) return;
    const photo = data.photos[key];
    const src = typeof DrivePhoto !== 'undefined' ? DrivePhoto.previewSrc(photo) : (typeof photo === 'string' ? photo : '');
    if (src) {
      thumbEl.innerHTML = '';
      const img = document.createElement('img');
      img.alt = '';
      img.src = src;
      thumbEl.appendChild(img);
      thumbEl.classList.add('has-photo');
      thumbEl.classList.toggle('upload-failed', Boolean(photo && typeof photo === 'object' && photo.uploadError));
    } else {
      thumbEl.innerHTML = '';
      thumbEl.classList.remove('has-photo', 'upload-failed');
    }
  });
}

function completeSub(checkId, returnScreen) {
  const key = TASK_KEYS[checkId];
  if (key) {
    ensureTapData();
    S.tapData[S.activeTap].tasks[key] = true;
    captureTaskPhoto(key);
  }
  goScreen(returnScreen);
  renderAssessList();
}

function selSeg(el, group) {
  el.closest('.seg').querySelectorAll('.seg-opt').forEach(o => o.classList.remove('sel'));
  el.classList.add('sel');
}

const SCORE_READING_BASE = { ph: 7.2, tds: 450, ec: 690, temp: 28, turbidity: 1.2, orp: 320, do: 6.8, chlorine: 2.1 };

function generateRandomScoreReadings() {
  const spread = () => (Math.random() * 2 - 1);
  const d = spread();
  const freeCl = Math.max(0.05, SCORE_READING_BASE.chlorine * 0.45 + d * 0.18);
  const totalCl = Math.max(freeCl + 0.05, SCORE_READING_BASE.chlorine * 0.55 + d * 0.22);
  return {
    ph: (SCORE_READING_BASE.ph + d * 0.22).toFixed(1),
    tds: String(Math.round(SCORE_READING_BASE.tds + d * 55)),
    ec: String(Math.round(SCORE_READING_BASE.ec + d * 75)),
    temp: String(Math.round(SCORE_READING_BASE.temp + d * 3)),
    turbidity: Math.max(0.1, +(SCORE_READING_BASE.turbidity + d * 0.35).toFixed(1)),
    orp: String(Math.round(SCORE_READING_BASE.orp + d * 45)),
    do: Math.max(0.1, +(SCORE_READING_BASE.do + d * 0.7).toFixed(1)),
    freeChlorine: freeCl.toFixed(2),
    totalChlorine: totalCl.toFixed(2)
  };
}

const METER_READING_FIELDS = {
  ph: 'm-ph',
  tds: 'm-tds',
  ec: 'm-ec',
  temp: 'm-temp',
  turbidity: 'm-turb',
  orp: 'm-orp',
  do: 'm-do'
};

const CHLORINE_READING_FIELDS = {
  freeChlorine: 'm-free-cl',
  totalChlorine: 'm-total-cl'
};

const PHOTO_SCAN_PROFILES = {
  'meter-photo-preview': {
    fields: METER_READING_FIELDS,
    pick(readings) {
      return {
        ph: readings.ph,
        tds: readings.tds,
        ec: readings.ec,
        temp: readings.temp,
        turbidity: readings.turbidity,
        orp: readings.orp,
        do: readings.do
      };
    },
    persist(tap, readings) {
      tap.meterReadings = readings;
      tap.meterSource = 'mock-ocr';
    }
  },
  'cl-photo-preview': {
    fields: CHLORINE_READING_FIELDS,
    pick(readings) {
      return {
        freeChlorine: readings.freeChlorine,
        totalChlorine: readings.totalChlorine
      };
    },
    persist(tap, readings) {
      tap.chlorineReadings = readings;
      tap.chlorineSource = 'mock-ocr';
    }
  }
};

const MOCK_METER_PHOTO = 'data:image/svg+xml,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" rx="24" fill="#111827"/>
  <rect x="48" y="52" width="544" height="256" rx="18" fill="#0f172a" stroke="#334155" stroke-width="3"/>
  <text x="80" y="120" fill="#93c5fd" font-family="Arial, sans-serif" font-size="28" font-weight="700">Mock meter photo</text>
  <text x="80" y="178" fill="#f8fafc" font-family="Arial, sans-serif" font-size="44" font-weight="700">pH 7.2  TDS 450</text>
  <text x="80" y="232" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="30">EC 690  Temp 28C</text>
  <text x="80" y="272" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="30">Turb 1.2  ORP 320  DO 6.8</text>
</svg>`);

const MeterReadingOcrProvider = {
  async analyzePhoto(photoSrc) {
    await new Promise(resolve => setTimeout(resolve, 650));
    const random = generateRandomScoreReadings();
    return {
      source: 'mock-ocr',
      confidence: 0.85 + Math.random() * 0.1,
      photo: photoSrc || MOCK_METER_PHOTO,
      readings: {
        ph: random.ph,
        tds: random.tds,
        ec: random.ec,
        temp: random.temp,
        turbidity: random.turbidity,
        orp: random.orp,
        do: random.do
      }
    };
  }
};

function writeReadingFields(fieldMap, readings = {}) {
  Object.entries(fieldMap).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.value = readings[key] ?? '';
  });
}

async function processAssessmentPhoto(previewId, photoSrc) {
  const profile = PHOTO_SCAN_PROFILES[previewId];
  if (!profile || !photoSrc || processAssessmentPhoto._busy) return;
  processAssessmentPhoto._busy = true;

  try {
    showToast(typeof t === 'function' ? t('meter.processingTitle') : 'Reading image...');
    await new Promise(resolve => setTimeout(resolve, 650));

    const random = generateRandomScoreReadings();
    const readings = profile.pick(random);
    writeReadingFields(profile.fields, readings);

    const tap = getActiveTapRecord();
    profile.persist(tap, readings);
    // Invalidate cached score readings so the next Water Score uses fresh OCR values.
    S.scoreBaseReadings = null;
    S.scoreVal = null;
    if (S.activeJob?.draft) {
      S.activeJob.draft.scoreBaseReadings = null;
      S.activeJob.draft.scoreVal = null;
    }
    saveActiveJobState?.();
    renderAssessList();
    showToast(typeof t === 'function' ? t('meter.toastFilled') : 'Readings filled');
  } finally {
    processAssessmentPhoto._busy = false;
  }
}
processAssessmentPhoto._busy = false;

function getActiveTapRecord() {
  ensureTapData();
  const tap = S.tapData[S.activeTap] || (S.tapData[S.activeTap] = { tasks: {}, photos: {} });
  tap.tasks = tap.tasks || {};
  tap.photos = tap.photos || {};
  return tap;
}

function readMeterReadingFields() {
  return Object.fromEntries(Object.entries(METER_READING_FIELDS).map(([key, id]) => [key, document.getElementById(id)?.value || '']));
}

function writeMeterReadingFields(readings = {}) {
  Object.entries(METER_READING_FIELDS).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.value = readings[key] ?? '';
  });
}

function persistMeterReadings() {
  const tap = getActiveTapRecord();
  tap.meterReadings = readMeterReadingFields();
  saveActiveJobState?.();
}

window.MeterReadingCapture = {
  provider: MeterReadingOcrProvider,
  _processing: false,

  init() {
    const tap = getActiveTapRecord();
    writeMeterReadingFields(tap.meterReadings || {});
    this.bindFieldPersistence();
    if (tap.photos?.meter) setPhotoPreview('meter-photo-preview', tap.photos.meter, { silent: true, skipUpload: true });
  },

  bindFieldPersistence() {
    Object.values(METER_READING_FIELDS).forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.meterBound) return;
      el.dataset.meterBound = 'true';
      el.addEventListener('input', persistMeterReadings);
      el.addEventListener('change', persistMeterReadings);
    });
  },

  async processPhoto(photoSrc) {
    if (this._processing || !photoSrc) return;
    this._processing = true;
    try {
      await processAssessmentPhoto('meter-photo-preview', photoSrc);
    } catch (error) {
      console.error(error);
      showToast(typeof t === 'function' ? t('meter.toastError') : 'Could not read image');
    } finally {
      this._processing = false;
    }
  },

  save() {
    persistMeterReadings();
    completeSub('meter-check', 's-assess');
    saveActiveJobState?.();
  }
};

function openPhotoStudio(inputId, previewId) {
  if (!inputId) return;
  openCameraCapture(inputId, previewId || null);
}

function readImageFile(file, onLoad) {
  if (!file) return;
  const maxBytes = (typeof DrivePhoto !== 'undefined' && DrivePhoto.maxBytes)
    ? DrivePhoto.maxBytes
    : (15 * 1024 * 1024);
  if (file.size > maxBytes) {
    showToast(typeof t === 'function' ? t('photo.tooLarge') : 'Image is too large to upload (max 15 MB)');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => onLoad(reader.result);
  reader.onerror = () => {
    showToast(typeof t === 'function' ? t('photo.uploadFailed') : 'Could not read image file');
  };
  reader.readAsDataURL(file);
}

function handlePhotoFile(input, previewId) {
  const file = input.files?.[0];
  if (!file || !previewId) return;
  readImageFile(file, src => {
    setPhotoPreview(previewId, src);
    closeCameraCapture();
    if (previewId !== 'meter-photo-preview' && previewId !== 'cl-photo-preview') showToast('Photo uploaded');
  });
}

function openPhotoCapture(inputId, keepCapture = false) {
  closeCameraCapture?.();
  const input = document.getElementById(inputId);
  if (!input) return;

  input.accept = 'image/*';
  if (keepCapture) {
    input.setAttribute('capture', 'environment');
  } else {
    input.removeAttribute('capture');
  }
  input.value = '';
  input.click();
}

function waitForVideoFrame(video, timeoutMs = 4000) {
  if (video.videoWidth && video.videoHeight) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Camera timeout')), timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    video.addEventListener('loadedmetadata', done, { once: true });
    video.addEventListener('loadeddata', done, { once: true });
  });
}
const CameraCapture = {
  stream: null,
  inputId: null,
  previewId: null,
  capturedDataUrl: null
};

function setCameraMode(mode) {
  const video = document.getElementById('camera-video');
  const review = document.getElementById('camera-review');
  const liveActions = document.getElementById('camera-actions-live');
  const reviewActions = document.getElementById('camera-actions-review');
  const isReview = mode === 'review';
  video?.classList.toggle('hidden', isReview);
  review?.classList.toggle('hidden', !isReview);
  liveActions?.classList.toggle('hidden', isReview);
  reviewActions?.classList.toggle('hidden', !isReview);
}

async function openCameraCapture(inputId, previewId) {
  CameraCapture.inputId = inputId;
  CameraCapture.previewId = previewId || null;

  const overlay = document.getElementById('camera-overlay');
  const video = document.getElementById('camera-video');
  const error = document.getElementById('camera-error');
  const ua = navigator.userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);

  // Live camera overlay (desktop + mobile) when getUserMedia is available.
  // Fallback: native capture / file picker if live camera cannot start.
  if (!overlay || !video || !navigator.mediaDevices?.getUserMedia) {
    if (inputId) openPhotoCapture(inputId, isMobile);
    else showToast('Camera not available on this device');
    return;
  }

  closeTransientOverlays?.();
  error?.classList.add('hidden');
  stopCameraStream();
  CameraCapture.capturedDataUrl = null;
  setCameraMode('live');
  overlay.classList.remove('hidden');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    CameraCapture.stream = stream;
    video.srcObject = stream;
    await video.play();
    await waitForVideoFrame(video).catch(() => {});
  } catch (errorObj) {
    console.warn(errorObj);
    closeCameraCapture();
    if (inputId) {
      openPhotoCapture(inputId, isMobile);
      return;
    }
    error?.classList.remove('hidden');
    overlay.classList.remove('hidden');
  }
}

function stopCameraStream() {
  CameraCapture.stream?.getTracks().forEach(track => track.stop());
  CameraCapture.stream = null;
  const video = document.getElementById('camera-video');
  if (video) video.srcObject = null;
}

function closeCameraCapture() {
  stopCameraStream();
  CameraCapture.capturedDataUrl = null;
  const review = document.getElementById('camera-review');
  if (review) review.src = '';
  setCameraMode('live');
  document.getElementById('camera-overlay')?.classList.add('hidden');
}

function fallbackPhotoPicker(event) {
  event?.stopPropagation?.();
  event?.preventDefault?.();
  const inputId = CameraCapture.inputId;
  closeCameraCapture();
  if (inputId) openPhotoCapture(inputId);
}

async function captureCameraFrame() {
  const video = document.getElementById('camera-video');
  if (!video) return;

  try {
    await waitForVideoFrame(video, 2500);
  } catch {
    showToast('Camera not ready — try upload instead');
    return;
  }

  if (!video.videoWidth || !video.videoHeight) {
    showToast('Camera not ready — try upload instead');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

  // Show a review step so the user can confirm the shot before returning.
  CameraCapture.capturedDataUrl = dataUrl;
  const review = document.getElementById('camera-review');
  if (review) review.src = dataUrl;
  stopCameraStream();
  setCameraMode('review');
}

function retakeCameraPhoto() {
  CameraCapture.capturedDataUrl = null;
  const review = document.getElementById('camera-review');
  if (review) review.src = '';
  // Reopen the live stream, keeping the same target input/preview.
  openCameraCapture(CameraCapture.inputId, CameraCapture.previewId);
}

function useCameraPhoto() {
  const dataUrl = CameraCapture.capturedDataUrl;
  if (!dataUrl) {
    closeCameraCapture();
    return;
  }
  if (CameraCapture.inputId === 'slip-input') {
    handleSlipCapture(dataUrl);
  } else if (CameraCapture.previewId) {
    setPhotoPreview(CameraCapture.previewId, dataUrl);
  }
  closeCameraCapture();
}

document.addEventListener('change', event => {
  const input = event.target;
  if (!input?.matches?.('input[type="file"][accept^="image"]')) return;
  if (input.id === 'slip-input') return;
  const previewId = input.dataset.previewId;
  if (previewId && typeof handlePhotoFile === 'function') handlePhotoFile(input, previewId);
}, true);

function previewPhoto(input, previewId) {
  const file = input.files[0];
  if (!file) return;
  readImageFile(file, src => {
    console.debug('[photo] previewPhoto -> setPhotoPreview', previewId, file.name);
    setPhotoPreview(previewId, src);
    showToast('Photo uploaded');
  });
}

function setPhotoUploadUi(previewId, state) {
  const img = document.getElementById(previewId);
  const box = img?.closest('.photo-box') || img?.closest('.slip-upload-card');
  if (!box) return;
  box.classList.toggle('is-uploading', state === 'uploading');
  box.classList.toggle('upload-failed', state === 'failed');
  let badge = box.querySelector('.photo-upload-status');
  if (state === 'failed') {
    if (!badge) {
      badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'photo-upload-status';
      badge.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        retryDrivePhotoUpload(previewId);
      });
      box.appendChild(badge);
    }
    badge.textContent = typeof t === 'function' ? t('photo.uploadFailedRetry') : 'Upload failed · Tap to retry';
    badge.classList.remove('hidden');
  } else if (badge) {
    badge.classList.add('hidden');
  }
}

function resolveCaptureDataUrl(photoOrSrc) {
  if (!photoOrSrc) return '';
  if (typeof photoOrSrc === 'string') return photoOrSrc.startsWith('data:') ? photoOrSrc : '';
  if (photoOrSrc.previewUrl && String(photoOrSrc.previewUrl).startsWith('data:')) return photoOrSrc.previewUrl;
  return '';
}

function normalizeInterruptedPhoto(photo) {
  if (!photo || typeof photo !== 'object') return photo;
  if (photo.fileId) return photo;
  // Upload abandoned mid-flight (reload) — keep preview and allow retry.
  // Skip while a live in-page upload is still running (screen switch must not mark failed).
  if (photo.uploading && photo.previewUrl) {
    if (typeof DrivePhoto !== 'undefined' && DrivePhoto.hasInflight?.()) {
      return photo;
    }
    return {
      ...photo,
      uploading: false,
      uploadError: photo.uploadError || 'Upload interrupted',
      uploadErrorCode: photo.uploadErrorCode || 'NETWORK_ERROR',
      pendingAutoRetry: photo.pendingAutoRetry !== false
    };
  }
  return photo;
}

function applyDriveContentSrc(img, photoOrUrl, fallbackDataUrl) {
  if (!img) return;
  if (typeof DrivePhoto !== 'undefined' && DrivePhoto.hydrateImg) {
    DrivePhoto.hydrateImg(img, photoOrUrl, fallbackDataUrl);
    return;
  }
  const url = typeof photoOrUrl === 'string'
    ? photoOrUrl
    : (photoOrUrl?.previewUrl || photoOrUrl?.contentUrl || '');
  if (!url && fallbackDataUrl) {
    img.src = fallbackDataUrl;
    return;
  }
  if (!url) return;
  const onError = () => {
    if (fallbackDataUrl) img.src = fallbackDataUrl;
  };
  img.addEventListener('error', onError, { once: true });
  img.src = url;
}

function buildStoredDrivePhotoMeta(meta, { purpose, previewUrl } = {}) {
  const resolvedPurpose = meta.purpose || purpose || null;
  const folderFromPurpose = typeof DrivePhoto !== 'undefined' && DrivePhoto.purposeToFolder
    ? DrivePhoto.purposeToFolder(resolvedPurpose, meta.mimeType, meta.filename)
    : 'main';
  return {
    fileId: meta.fileId,
    filename: meta.filename,
    folder: meta.folder || folderFromPurpose,
    folderId: meta.folderId || null,
    category: meta.category || null,
    subCategory: meta.subCategory || null,
    customerFolderId: meta.customerFolderId || null,
    customerFolderUrl: meta.customerFolderUrl || null,
    categoryFolderId: meta.categoryFolderId || null,
    categoryFolderUrl: meta.categoryFolderUrl || null,
    subCategoryFolderId: meta.subCategoryFolderId || null,
    subCategoryFolderUrl: meta.subCategoryFolderUrl || null,
    purpose: resolvedPurpose,
    uploadedAt: meta.uploadedAt || new Date().toISOString(),
    uploadedBy: meta.uploadedBy || S.user?.username || null,
    jobId: meta.jobId || S.activeJob?.notionId || S.activeJob?.id || null,
    contentUrl: meta.contentUrl,
    webViewLink: meta.webViewLink || null,
    mimeType: meta.mimeType || null,
    previewUrl: previewUrl || meta.previewUrl || null
  };
}

function markDriveUploadFailed(photoBase, error) {
  const retryable = typeof DrivePhoto !== 'undefined' && DrivePhoto.isRetryableError?.(error);
  return {
    ...photoBase,
    uploading: false,
    uploadError: error.message || 'Upload failed',
    uploadErrorCode: error.code || null,
    pendingAutoRetry: Boolean(retryable)
  };
}

function driveQueueKey(taskKey, tapIndex) {
  const jobId = S.activeJob?.notionId || S.activeJob?.id || 'job';
  return `${jobId}:${tapIndex ?? 'x'}:${taskKey}`;
}

async function uploadTaskPhotoToDrive(taskKey, previewId, dataUrl) {
  if (typeof DrivePhoto === 'undefined') return null;
  ensureTapData();
  const tapIndex = S.activeTap;
  const photos = S.tapData[tapIndex].photos;
  const existing = photos[taskKey];
  const customer = typeof DrivePhoto.resolveActiveCustomerContext === 'function'
    ? DrivePhoto.resolveActiveCustomerContext()
    : {
        notionId: S.activeJob?.notionId || S.activeJob?.id || null,
        customerName: S.activeJob?.name || null,
        jobId: S.activeJob?.notionId || S.activeJob?.id || null,
        customerFolderId: S.activeJob?.drive?.folderId || null
      };
  const category = typeof DrivePhoto.resolveClientCategory === 'function'
    ? DrivePhoto.resolveClientCategory(taskKey, 'image/jpeg')
    : 'Site Inspection';
  const subCategory = typeof DrivePhoto.resolveClientSubCategory === 'function'
    ? DrivePhoto.resolveClientSubCategory(taskKey, 'image/jpeg')
    : taskKey;
  const jobId = customer.jobId;
  const queueKey = driveQueueKey(taskKey, tapIndex);

  // Already uploaded for THIS capture — skip. A new dataUrl must always upload.
  if (DrivePhoto.isUploaded(existing) && resolveCaptureDataUrl(existing) === dataUrl) {
    await DrivePhoto.dequeue?.(queueKey);
    return existing;
  }

  // Live upload in progress for the same capture — do not start a second POST.
  if (existing?.uploading && resolveCaptureDataUrl(existing) === dataUrl) {
    return existing;
  }

  const compressed = await DrivePhoto.compress(dataUrl);

  // Re-check after async compress (flush/retry may have finished meanwhile).
  const latest = S.tapData[tapIndex]?.photos?.[taskKey];
  if (DrivePhoto.isUploaded(latest) && resolveCaptureDataUrl(latest) === compressed) {
    await DrivePhoto.dequeue?.(queueKey);
    return latest;
  }
  if (latest?.uploading && resolveCaptureDataUrl(latest) === compressed) {
    return latest;
  }

  photos[taskKey] = {
    uploading: true,
    previewUrl: compressed,
    folder: 'main',
    purpose: taskKey,
    category,
    subCategory,
    notionId: customer.notionId,
    uploadedAt: null,
    jobId,
    pendingAutoRetry: false
  };
  setPhotoUploadUi(previewId, 'uploading');
  saveActiveJobState?.();

  try {
    const meta = await DrivePhoto.uploadOnce({
      dataUrl: compressed,
      purpose: taskKey,
      folder: 'main',
      category,
      subCategory,
      uploadType: subCategory,
      contentType: 'image/jpeg',
      inflightKey: `main:${taskKey}:${tapIndex}`,
      jobId,
      notionId: customer.notionId,
      customerName: customer.customerName,
      customerFolderId: customer.customerFolderId
    });

    const stored = buildStoredDrivePhotoMeta(meta, { purpose: taskKey, previewUrl: compressed });

    // Write back to the tap that started the upload (user may have switched taps).
    if (S.tapData[tapIndex]?.photos) S.tapData[tapIndex].photos[taskKey] = stored;
    setPhotoUploadUi(previewId, 'ok');
    applyDriveContentSrc(document.getElementById(previewId), stored, compressed);
    await DrivePhoto.dequeue?.(queueKey);
    saveActiveJobState?.();
    renderAssessList();
    return stored;
  } catch (error) {
    if (error?.code === 'UPLOAD_IN_FLIGHT') return S.tapData[tapIndex]?.photos?.[taskKey];
    console.warn('Drive upload failed', error);
    const failed = markDriveUploadFailed({
      previewUrl: compressed,
      folder: 'main',
      purpose: taskKey,
      category,
      subCategory,
      notionId: customer.notionId,
      jobId
    }, error);
    if (S.tapData[tapIndex]?.photos) S.tapData[tapIndex].photos[taskKey] = failed;
    if (DrivePhoto.isRetryableError?.(error)) {
      await DrivePhoto.enqueue?.({
        queueKey,
        jobId,
        notionId: customer.notionId,
        customerName: customer.customerName,
        customerFolderId: customer.customerFolderId,
        tapIndex,
        taskKey,
        previewId,
        purpose: taskKey,
        category,
        subCategory,
        folder: 'main',
        dataUrl: compressed,
        lastError: error.message
      });
    }
    setPhotoUploadUi(previewId, 'failed');
    saveActiveJobState?.();
    showToast(
      error.message
      || (typeof t === 'function' ? t('photo.uploadFailed') : 'Photo saved locally — Drive upload failed')
    );
    return failed;
  }
}

async function uploadSlipPhotoToDrive(dataUrl) {
  if (typeof DrivePhoto === 'undefined') return null;
  if (DrivePhoto.isUploaded(S.paymentSlipPhoto) && resolveCaptureDataUrl(S.paymentSlipPhoto) === dataUrl) {
    return S.paymentSlipPhoto;
  }
  if (S.paymentSlipPhoto?.uploading && resolveCaptureDataUrl(S.paymentSlipPhoto) === dataUrl) {
    return S.paymentSlipPhoto;
  }

  const customer = typeof DrivePhoto.resolveActiveCustomerContext === 'function'
    ? DrivePhoto.resolveActiveCustomerContext()
    : {
        notionId: S.activeJob?.notionId || S.activeJob?.id || null,
        customerName: S.activeJob?.name || null,
        jobId: S.activeJob?.notionId || S.activeJob?.id || null,
        customerFolderId: S.activeJob?.drive?.folderId || null
      };
  const jobId = customer.jobId;
  const queueKey = driveQueueKey('payment', 'slip');
  const compressed = await DrivePhoto.compress(dataUrl);

  if (DrivePhoto.isUploaded(S.paymentSlipPhoto) && resolveCaptureDataUrl(S.paymentSlipPhoto) === compressed) {
    await DrivePhoto.dequeue?.(queueKey);
    return S.paymentSlipPhoto;
  }
  if (S.paymentSlipPhoto?.uploading && resolveCaptureDataUrl(S.paymentSlipPhoto) === compressed) {
    return S.paymentSlipPhoto;
  }

  S.paymentSlipPhoto = {
    uploading: true,
    previewUrl: compressed,
    folder: 'main',
    purpose: 'payment',
    category: 'Payment',
    subCategory: 'Slip',
    notionId: customer.notionId,
    jobId,
    pendingAutoRetry: false
  };
  S.paymentSlipSource = typeof t === 'function' ? t('pay.uploaded') : 'Photo attached';
  setPhotoUploadUi('slip-preview', 'uploading');
  saveActiveJobState?.();

  try {
    const meta = await DrivePhoto.uploadOnce({
      dataUrl: compressed,
      purpose: 'payment',
      folder: 'main',
      category: 'Payment',
      subCategory: 'Slip',
      uploadType: 'Slip',
      contentType: 'image/jpeg',
      filename: DrivePhoto.buildFilename('payment-slip'),
      inflightKey: 'main:payment:slip',
      jobId,
      notionId: customer.notionId,
      customerName: customer.customerName,
      customerFolderId: customer.customerFolderId
    });
    S.paymentSlipPhoto = buildStoredDrivePhotoMeta(meta, { purpose: 'payment', previewUrl: compressed });
    setPhotoUploadUi('slip-preview', 'ok');
    applyDriveContentSrc(document.getElementById('slip-preview'), S.paymentSlipPhoto, compressed);
    await DrivePhoto.dequeue?.(queueKey);
    saveActiveJobState?.();
    return S.paymentSlipPhoto;
  } catch (error) {
    if (error?.code === 'UPLOAD_IN_FLIGHT') return S.paymentSlipPhoto;
    console.warn('Slip Drive upload failed', error);
    S.paymentSlipPhoto = markDriveUploadFailed({
      previewUrl: compressed,
      folder: 'main',
      purpose: 'payment',
      category: 'Payment',
      subCategory: 'Slip',
      notionId: customer.notionId,
      jobId
    }, error);
    if (DrivePhoto.isRetryableError?.(error)) {
      await DrivePhoto.enqueue?.({
        queueKey,
        jobId,
        notionId: customer.notionId,
        customerName: customer.customerName,
        customerFolderId: customer.customerFolderId,
        tapIndex: null,
        taskKey: 'payment',
        previewId: 'slip-preview',
        purpose: 'payment',
        category: 'Payment',
        subCategory: 'Slip',
        folder: 'main',
        isSlip: true,
        dataUrl: compressed,
        lastError: error.message
      });
    }
    setPhotoUploadUi('slip-preview', 'failed');
    saveActiveJobState?.();
    showToast(
      error.message
      || (typeof t === 'function' ? t('photo.uploadFailed') : 'Photo saved locally — Drive upload failed')
    );
    return S.paymentSlipPhoto;
  }
}

let _driveFlushBusy = false;

async function flushPendingDriveUploads() {
  if (_driveFlushBusy || typeof DrivePhoto === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  _driveFlushBusy = true;
  try {
    const queue = (await DrivePhoto.readQueue?.()) || [];
    for (const item of queue) {
      if (!item?.dataUrl) {
        await DrivePhoto.dequeue?.(item.queueKey);
        continue;
      }
      try {
        if (item.isSlip || item.purpose === 'payment') {
          if (DrivePhoto.isUploaded(S.paymentSlipPhoto) || S.paymentSlipPhoto?.uploading) {
            if (DrivePhoto.isUploaded(S.paymentSlipPhoto)) await DrivePhoto.dequeue?.(item.queueKey);
            continue;
          }
          await uploadSlipPhotoToDrive(item.dataUrl);
        } else if (item.taskKey) {
          const tapIndex = Number.isFinite(item.tapIndex) ? item.tapIndex : S.activeTap;
          const priorTap = S.activeTap;
          if (Number.isFinite(tapIndex)) S.activeTap = tapIndex;
          ensureTapData();
          const existing = S.tapData[tapIndex]?.photos?.[item.taskKey];
          if (DrivePhoto.isUploaded(existing) || existing?.uploading) {
            if (DrivePhoto.isUploaded(existing)) await DrivePhoto.dequeue?.(item.queueKey);
            S.activeTap = priorTap;
            continue;
          }
          const previewId = item.previewId
            || Object.entries(PHOTO_ID_TASKS).find(([, key]) => key === item.taskKey)?.[0];
          await uploadTaskPhotoToDrive(item.taskKey, previewId, item.dataUrl);
          S.activeTap = priorTap;
        }
      } catch (error) {
        console.warn('Auto Drive retry failed', error);
      }
    }

    // Also pick up pending flags on the active job that may not be in the queue index.
    if (S.activeJob && Array.isArray(S.tapData)) {
      for (let i = 0; i < S.tapData.length; i += 1) {
        const photos = S.tapData[i]?.photos || {};
        for (const [taskKey, photo] of Object.entries(photos)) {
          if (!photo || photo.fileId || photo.uploading || !photo.pendingAutoRetry || !photo.previewUrl) continue;
          const priorTap = S.activeTap;
          S.activeTap = i;
          const previewId = Object.entries(PHOTO_ID_TASKS).find(([, key]) => key === taskKey)?.[0];
          try {
            await uploadTaskPhotoToDrive(taskKey, previewId, photo.previewUrl);
          } catch (error) {
            console.warn('Pending photo auto-retry failed', error);
          }
          S.activeTap = priorTap;
        }
      }
    }
    if (
      S.paymentSlipPhoto?.pendingAutoRetry
      && S.paymentSlipPhoto?.previewUrl
      && !S.paymentSlipPhoto.fileId
      && !S.paymentSlipPhoto.uploading
    ) {
      try {
        await uploadSlipPhotoToDrive(S.paymentSlipPhoto.previewUrl);
      } catch (error) {
        console.warn('Pending slip auto-retry failed', error);
      }
    }
  } finally {
    _driveFlushBusy = false;
  }
}

function initDriveUploadQueue() {
  if (typeof window === 'undefined' || window.__wmDriveQueueInit) return;
  window.__wmDriveQueueInit = true;
  window.addEventListener('online', () => {
    flushPendingDriveUploads();
  });
  // Delayed startup flush after session restore.
  setTimeout(() => flushPendingDriveUploads(), 1200);
}

function retryDrivePhotoUpload(previewId) {
  if (previewId === 'slip-preview') {
    const dataUrl = resolveCaptureDataUrl(S.paymentSlipPhoto);
    if (!dataUrl) {
      showToast(typeof t === 'function' ? t('photo.retryUnavailable') : 'Nothing to retry — capture again');
      return;
    }
    uploadSlipPhotoToDrive(dataUrl);
    return;
  }

  const taskKey = PHOTO_ID_TASKS[previewId];
  if (!taskKey) return;
  ensureTapData();
  const photo = S.tapData[S.activeTap]?.photos?.[taskKey];
  const dataUrl = resolveCaptureDataUrl(photo);
  if (!dataUrl) {
    showToast(typeof t === 'function' ? t('photo.retryUnavailable') : 'Nothing to retry — capture again');
    return;
  }
  uploadTaskPhotoToDrive(taskKey, previewId, dataUrl);
}

function setPhotoPreview(previewId, src, options = {}) {
  const img = document.getElementById(previewId);
  if (!img) return;
  console.debug('[photo] setPhotoPreview', previewId, typeof src === 'string' ? src.slice(0,40) : src && src.previewUrl ? src.previewUrl.slice(0,40) : Object.keys(src || {}));

  const isMeta = typeof DrivePhoto !== 'undefined' && DrivePhoto.isMeta(src);
  const displaySrc = typeof DrivePhoto !== 'undefined'
    ? DrivePhoto.previewSrc(src)
    : (typeof src === 'string' ? src : '');

  if (displaySrc) {
    img.src = displaySrc;
    img.style.display = 'block';
    img.classList.add('preview');
  } else if (isMeta && (src.fileId || src.contentUrl)) {
    img.classList.add('preview');
    img.style.display = 'block';
    applyDriveContentSrc(img, src, src.previewUrl || '');
  }

  const box = img.closest('.photo-box');
  const slipCard = img.closest('.slip-upload-card');
  const hasVisual = Boolean(displaySrc || (isMeta && (src.fileId || src.previewUrl)));
  if (box && hasVisual) {
    box.classList.add('has-photo');
    box.querySelector('.pb-icon')?.classList.add('hidden');
    box.querySelector('.pb-label')?.classList.add('hidden');
    box.querySelector('.photo-status')?.classList.remove('hidden');
  }
  if (slipCard && hasVisual) {
    slipCard.classList.add('has-photo');
    slipCard.querySelector('.slip-cam-icon')?.classList.add('hidden');
  }
  if (previewId === 'slip-preview' && hasVisual) {
    const sub = document.getElementById('slip-sub');
    if (sub) sub.textContent = typeof t === 'function' ? t('pay.uploaded') : 'Photo attached';
  }

  const taskKey = PHOTO_ID_TASKS[previewId];
  const skipUpload = Boolean(options.skipUpload || options.silent);
  const dataUrl = typeof src === 'string' && src.startsWith('data:') ? src : resolveCaptureDataUrl(src);

  if (taskKey) {
    ensureTapData();
    if (isMeta) {
      S.tapData[S.activeTap].photos[taskKey] = src;
      setPhotoUploadUi(
        previewId,
        src.uploadError || src.pendingAutoRetry ? 'failed' : (src.uploading ? 'uploading' : 'ok')
      );
    } else if (dataUrl) {
      // Preview only — uploadTaskPhotoToDrive owns the uploading flag.
      // Setting uploading:true here caused a race that skipped the Drive POST.
      if (!skipUpload) {
        S.tapData[S.activeTap].photos[taskKey] = {
          previewUrl: dataUrl,
          folder: 'main',
          purpose: taskKey,
          jobId: S.activeJob?.notionId || S.activeJob?.id || null
        };
      } else if (!DrivePhoto?.isUploaded(S.tapData[S.activeTap].photos[taskKey])) {
        S.tapData[S.activeTap].photos[taskKey] = dataUrl;
      }
    }
    if (!options.silent) saveActiveJobState?.();
    renderAssessList();
  }

  if (previewId === 'slip-preview' && isMeta) {
    S.paymentSlipPhoto = src;
    setPhotoUploadUi(
      previewId,
      src.uploadError || src.pendingAutoRetry ? 'failed' : (src.uploading ? 'uploading' : 'ok')
    );
  }

  // OCR still runs on the local data URL (not Drive download).
  const ocrSource = dataUrl || (typeof src === 'string' ? src : '');
  if (!options.silent && ocrSource) {
    if (previewId === 'meter-photo-preview' && window.MeterReadingCapture?.processPhoto) {
      MeterReadingCapture.processPhoto(ocrSource);
    } else if (previewId === 'cl-photo-preview') {
      processAssessmentPhoto('cl-photo-preview', ocrSource).catch(error => {
        console.error(error);
        showToast(typeof t === 'function' ? t('meter.toastError') : 'Could not read image');
      });
    }
  }

  if (!skipUpload && dataUrl && taskKey) {
    uploadTaskPhotoToDrive(taskKey, previewId, dataUrl);
  }
}

function handleSlipUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  readImageFile(file, src => {
    // Preview only — uploadSlipPhotoToDrive sets uploading to avoid skip-race.
    S.paymentSlipPhoto = { previewUrl: src, folder: 'main', purpose: 'payment' };
    S.paymentSlipSource = typeof t === 'function' ? t('pay.uploaded') : 'Photo attached';
    setPhotoPreview('slip-preview', S.paymentSlipPhoto, { skipUpload: true });
    closeCameraCapture();
    showToast(typeof t === 'function' ? t('pay.uploaded') : 'Photo attached');
    uploadSlipPhotoToDrive(src);
  });
}

function handleSlipCapture(dataUrl) {
  S.paymentSlipPhoto = { previewUrl: dataUrl, folder: 'main', purpose: 'payment' };
  S.paymentSlipSource = typeof t === 'function' ? t('pay.uploaded') : 'Photo attached';
  setPhotoPreview('slip-preview', S.paymentSlipPhoto, { skipUpload: true });
  showToast(typeof t === 'function' ? t('pay.uploaded') : 'Photo attached');
  uploadSlipPhotoToDrive(dataUrl);
}
