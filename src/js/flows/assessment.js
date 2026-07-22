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
  if (previewId === 'meter-photo-preview') {
    if (window.MeterReadingCapture) MeterReadingCapture.init();
    return;
  }
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
  if (key === 'meter') {
    syncMeterThumbFromSession(S.tapData[S.activeTap]);
    return;
  }
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
    let photo = data.photos[key];
    if (key === 'meter') {
      ensureMeterImages(data);
      if (data.meterImages?.length) {
        photo = data.meterImages[data.meterImages.length - 1].photo;
      }
    }
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
  do: 'm-do',
  doPercent: 'm-do-percent'
};

function getAssessmentSessionId() {
  return S.activeJob?.notionId || S.activeJob?.id || 'session';
}

function newMeterImageId() {
  return `meter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureMeterImages(tap) {
  if (!tap) return [];
  if (!Array.isArray(tap.meterImages)) tap.meterImages = [];
  if (
    tap.meterImages.length === 0
    && tap.photos?.meter
    && tap.meterReadings
    && Object.keys(tap.meterReadings).some(k => tap.meterReadings[k] !== '' && tap.meterReadings[k] != null)
  ) {
    tap.meterImages.push({
      id: 'legacy',
      photo: tap.photos.meter,
      uploadedAt: (typeof tap.photos.meter === 'object' && tap.photos.meter.uploadedAt)
        ? tap.photos.meter.uploadedAt
        : new Date().toISOString(),
      sessionId: getAssessmentSessionId(),
      detected: { ...tap.meterReadings }
    });
  }
  return tap.meterImages;
}

function meterPhotoPreviewSrc(photo) {
  if (typeof DrivePhoto !== 'undefined' && DrivePhoto.previewSrc) {
    return DrivePhoto.previewSrc(photo);
  }
  return typeof photo === 'string' ? photo : (photo?.previewUrl || photo?.contentUrl || '');
}

function syncMeterThumbFromSession(tap) {
  if (!tap) return;
  tap.photos = tap.photos || {};
  const images = ensureMeterImages(tap);
  if (images.length) {
    tap.photos.meter = images[images.length - 1].photo;
  } else {
    // No images left (e.g. the last one was just deleted) — clear the stale
    // pointer so ensureMeterImages() doesn't resurrect it as a "legacy" entry.
    delete tap.photos.meter;
  }
}

function mergeMeterReadings(existing = {}, detected = {}) {
  const out = { ...(existing || {}) };
  Object.entries(detected || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    out[key] = value;
  });
  return out;
}

function pickMeterReadingFields(readings = {}) {
  return Object.fromEntries(
    Object.keys(METER_READING_FIELDS).map(key => [key, readings[key]])
  );
}

/** Map OCR service payload → meter form keys. Only keep non-empty detected values. */
function mapOcrDataToMeterReadings(data = {}) {
  const mapped = {
    ph: data.ph,
    tds: data.tds,
    ec: data.ec,
    temp: data.temp ?? data.temperature,
    turbidity: data.turbidity,
    // ORP is its own reading — never fill it from `mv` (the pH electrode's raw
    // millivolt/slope value). Same physical unit, different quantity; conflating
    // them put the pH probe's mV reading into the ORP field on partial Hanna pages.
    orp: data.orp,
    // DO mg/L and DO % are physically different quantities — never conflate them
    // into one field (a %-saturation reading like 89.4 is not 89.4 mg/L).
    do: data.do_mg_l ?? data.do,
    doPercent: data.do_percent
  };
  const out = {};
  Object.entries(mapped).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    out[key] = String(value);
  });
  return out;
}

const OCR_USER_ERROR_CODES = new Set([
  'ENGINE_UNAVAILABLE',
  'OCR_OFFLINE',
  'OCR_TIMEOUT',
  'OCR_INTERNAL_ERROR',
  'OCR_MISCONFIGURED'
]);

/**
 * Read meter values from the image via OCR.
 * Returns only fields actually present in the OCR response — never invents values.
 * Throws with code ENGINE_UNAVAILABLE / OCR_OFFLINE / OCR_TIMEOUT when OCR cannot run.
 */
async function detectMeterReadingsFromImage(photoSrc) {
  const imageUrl = typeof photoSrc === 'string'
    ? photoSrc
    : resolveCaptureDataUrl(photoSrc);
  if (!imageUrl) {
    console.warn('[OCR FLOW] missing imageSrc — aborting detectMeterReadingsFromImage', {
      photoSrcType: typeof photoSrc,
      isString: typeof photoSrc === 'string',
      stringPrefix: typeof photoSrc === 'string' ? photoSrc.slice(0, 32) : null
    });
    return {};
  }

  try {
    console.warn('[OCR] request started', {
      endpoint: '/api/ocr/read-meter',
      meter_type: 'ph',
      imageUrlLen: imageUrl.length,
      imageUrlPrefix: imageUrl.slice(0, 48)
    });
    const response = await fetch('/api/ocr/read-meter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      cache: 'no-store',
      body: JSON.stringify({
        image_url: imageUrl,
        // Multiparameter LCD profiles (e.g. HANNA) are keyed under ph.
        meter_type: 'ph'
      })
    });
    const body = await response.json().catch(() => ({}));
    // TEMP debug — remove after OCR fill investigation
    console.warn('[OCR] response received', {
      httpStatus: response.status,
      success: body?.success,
      error: body?.error || null,
      message: body?.message || null,
      dataKeys: body?.data && typeof body.data === 'object' ? Object.keys(body.data) : []
    });
    console.warn('[OCR] detected data:', body?.data && typeof body.data === 'object' ? body.data : null);
    if (body && body.success === false && OCR_USER_ERROR_CODES.has(body.error)) {
      const err = new Error(body.message || 'OCR is not available');
      err.code = body.error;
      throw err;
    }
    if (!body || body.success === false || !body.data || typeof body.data !== 'object') {
      console.warn('[OCR] mapped readings:', {});
      return {};
    }
    const mapped = mapOcrDataToMeterReadings(body.data);
    console.warn('[OCR] mapped readings:', mapped);
    return mapped;
  } catch (error) {
    if (OCR_USER_ERROR_CODES.has(error?.code)) throw error;
    const message = String(error?.message || '');
    if (error?.name === 'TypeError' || /failed to fetch|networkerror|load failed/i.test(message)) {
      const offline = new Error('OCR service is not available');
      offline.code = 'OCR_OFFLINE';
      throw offline;
    }
    console.warn('Meter OCR request failed', error);
    console.warn('[OCR] response received', {
      failed: true,
      message,
      code: error?.code || null
    });
    return {};
  }
}

function resetMeterCapturePreview() {
  const img = document.getElementById('meter-photo-preview');
  const box = img?.closest('.photo-box');
  if (img) {
    img.removeAttribute('src');
    img.style.display = 'none';
    img.classList.remove('preview');
  }
  if (box) {
    box.classList.remove('has-photo', 'is-uploading', 'upload-failed');
    box.querySelector('.pb-icon')?.classList.remove('hidden');
    box.querySelector('.pb-label')?.classList.remove('hidden');
    box.querySelector('.photo-status')?.classList.add('hidden');
  }
}

const meterImageViewer = { index: 0, bound: false };

function getMeterViewerImages() {
  return ensureMeterImages(getActiveTapRecord());
}

function updateMeterImageViewerUi() {
  const images = getMeterViewerImages();
  const overlay = document.getElementById('meter-viewer-overlay');
  const img = document.getElementById('meter-viewer-img');
  const counter = document.getElementById('meter-viewer-counter');
  const prevBtn = document.getElementById('meter-viewer-prev');
  const nextBtn = document.getElementById('meter-viewer-next');
  if (!overlay || !img || !counter) return;

  if (!images.length) {
    closeMeterImageViewer();
    return;
  }

  const index = Math.max(0, Math.min(meterImageViewer.index, images.length - 1));
  meterImageViewer.index = index;
  const entry = images[index];
  const src = meterPhotoPreviewSrc(entry?.photo);

  counter.textContent = `${index + 1} / ${images.length}`;
  if (src) {
    img.src = src;
    img.alt = `Meter image ${index + 1}`;
    img.classList.remove('hidden');
  } else {
    img.removeAttribute('src');
    img.alt = '';
  }

  const multi = images.length > 1;
  if (prevBtn) {
    prevBtn.disabled = index <= 0;
    prevBtn.classList.toggle('hidden', !multi);
  }
  if (nextBtn) {
    nextBtn.disabled = index >= images.length - 1;
    nextBtn.classList.toggle('hidden', !multi);
  }
}

function openMeterImageViewer(index = 0) {
  const images = getMeterViewerImages();
  if (!images.length) return;
  meterImageViewer.index = Math.max(0, Math.min(Number(index) || 0, images.length - 1));
  bindMeterImageViewer();
  document.getElementById('meter-viewer-overlay')?.classList.remove('hidden');
  updateMeterImageViewerUi();
}

function closeMeterImageViewer() {
  document.getElementById('meter-viewer-overlay')?.classList.add('hidden');
  const img = document.getElementById('meter-viewer-img');
  if (img) img.removeAttribute('src');
}

function meterViewerStep(delta) {
  const images = getMeterViewerImages();
  if (!images.length) return;
  meterImageViewer.index = Math.max(0, Math.min(meterImageViewer.index + delta, images.length - 1));
  updateMeterImageViewerUi();
}

function bindMeterImageViewer() {
  if (meterImageViewer.bound) return;
  const stage = document.getElementById('meter-viewer-stage');
  const overlay = document.getElementById('meter-viewer-overlay');
  if (!stage || !overlay) return;
  meterImageViewer.bound = true;

  let touchStartX = 0;
  let touchStartY = 0;
  stage.addEventListener('touchstart', event => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }, { passive: true });

  stage.addEventListener('touchend', event => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    meterViewerStep(dx < 0 ? 1 : -1);
  }, { passive: true });

  document.addEventListener('keydown', event => {
    if (overlay.classList.contains('hidden')) return;
    if (event.key === 'Escape') closeMeterImageViewer();
    else if (event.key === 'ArrowLeft') meterViewerStep(-1);
    else if (event.key === 'ArrowRight') meterViewerStep(1);
  });
}

function renderMeterThumbnailRow() {
  const section = document.getElementById('meter-thumb-section');
  const row = document.getElementById('meter-thumb-row');
  if (!section || !row) return;

  const tap = getActiveTapRecord();
  const images = ensureMeterImages(tap);
  if (!images.length) {
    row.innerHTML = '';
    section.classList.add('hidden');
    closeMeterImageViewer();
    return;
  }

  section.classList.remove('hidden');
  row.innerHTML = images.map((entry, index) => {
    const src = meterPhotoPreviewSrc(entry.photo);
    const visual = src
      ? `<img src="${src.replace(/"/g, '&quot;')}" alt="Meter image ${index + 1}">`
      : `<span class="meter-thumb-placeholder" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </span>`;
    return `
      <div class="meter-thumb-wrap">
        <button type="button" class="meter-thumb-item" onclick="openMeterImageViewer(${index})" aria-label="View meter image ${index + 1}">
          <div class="meter-thumb-box">${visual}</div>
          <div class="meter-thumb-index">${index + 1}</div>
        </button>
        <button type="button" class="meter-thumb-delete" onclick="event.stopPropagation(); removeMeterSessionImage(${index})" aria-label="Remove meter image ${index + 1}">×</button>
      </div>
    `;
  }).join('');

  if (!document.getElementById('meter-viewer-overlay')?.classList.contains('hidden')) {
    updateMeterImageViewerUi();
  }
}

/** Remove one captured meter image. Does not recalculate readings or change manual values. */
function removeMeterSessionImage(index) {
  const tap = getActiveTapRecord();
  const images = ensureMeterImages(tap);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= images.length) return;

  images.splice(i, 1);
  syncMeterThumbFromSession(tap);
  saveActiveJobState?.();
  renderMeterThumbnailRow();
  renderAssessList?.();
}

async function uploadMeterSessionImage(tapIndex, imageId, dataUrl) {
  if (!dataUrl || typeof DrivePhoto === 'undefined') return null;
  ensureTapData();
  const tap = S.tapData[tapIndex];
  if (!tap) return null;
  const images = ensureMeterImages(tap);
  const entry = images.find(img => img.id === imageId);
  if (!entry) return null;

  const customer = typeof DrivePhoto.resolveActiveCustomerContext === 'function'
    ? DrivePhoto.resolveActiveCustomerContext()
    : {
        notionId: S.activeJob?.notionId || S.activeJob?.id || null,
        customerName: S.activeJob?.name || null,
        jobId: S.activeJob?.notionId || S.activeJob?.id || null,
        customerFolderId: S.activeJob?.drive?.folderId || null
      };
  const jobId = customer.jobId;
  const queueKey = `${driveQueueKey('meter', tapIndex)}:${imageId}`;
  const existing = entry.photo;

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
  const latestEntry = images.find(img => img.id === imageId);
  const latest = latestEntry?.photo;
  if (DrivePhoto.isUploaded(latest) && resolveCaptureDataUrl(latest) === compressed) {
    await DrivePhoto.dequeue?.(queueKey);
    return latest;
  }
  if (latest?.uploading && resolveCaptureDataUrl(latest) === compressed) {
    return latest;
  }
  if (!latestEntry) return null;

  const category = typeof DrivePhoto.resolveClientCategory === 'function'
    ? DrivePhoto.resolveClientCategory('meter', 'image/jpeg')
    : 'Site Inspection';

  latestEntry.photo = {
    uploading: true,
    previewUrl: compressed,
    folder: 'main',
    purpose: 'meter',
    category,
    subCategory: imageId,
    notionId: customer.notionId,
    uploadedAt: null,
    jobId,
    pendingAutoRetry: false
  };
  syncMeterThumbFromSession(tap);
  saveActiveJobState?.();

  try {
    const meta = await DrivePhoto.uploadOnce({
      dataUrl: compressed,
      purpose: 'meter',
      folder: 'main',
      category,
      subCategory: imageId,
      uploadType: imageId,
      contentType: 'image/jpeg',
      inflightKey: `main:meter:${tapIndex}:${imageId}`,
      jobId,
      notionId: customer.notionId,
      customerName: customer.customerName,
      customerFolderId: customer.customerFolderId
    });
    latestEntry.photo = buildStoredDrivePhotoMeta(meta, { purpose: 'meter', previewUrl: compressed });
    syncMeterThumbFromSession(tap);
    await DrivePhoto.dequeue?.(queueKey);
    saveActiveJobState?.();
    renderAssessList();
    renderMeterThumbnailRow();
    return latestEntry.photo;
  } catch (error) {
    if (error?.code === 'UPLOAD_IN_FLIGHT') return latestEntry.photo;
    console.warn('Meter session Drive upload failed', error);
    latestEntry.photo = markDriveUploadFailed({
      previewUrl: compressed,
      folder: 'main',
      purpose: 'meter',
      category,
      subCategory: imageId,
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
        tapIndex,
        meterImageId: imageId,
        purpose: 'meter',
        folder: 'main',
        dataUrl: compressed,
        lastError: error.message
      });
    }
    syncMeterThumbFromSession(tap);
    saveActiveJobState?.();
    renderMeterThumbnailRow();
    return latestEntry.photo;
  }
}

/**
 * One meter capture: save → OCR → merge/write fields → Drive upload.
 * OCR always runs when imageSrc exists. Drive upload does not skip or replace OCR.
 */
async function appendMeterSessionPhoto(photoSrc) {
  const imageSrc = typeof photoSrc === 'string'
    ? photoSrc
    : resolveCaptureDataUrl(photoSrc);

  if (!imageSrc) {
    console.warn('[OCR FLOW] missing imageSrc — aborting (no silent continue)', {
      photoSrcType: typeof photoSrc,
      hasPhotoSrc: Boolean(photoSrc)
    });
    return null;
  }

  const tapIndex = S.activeTap;
  const tap = getActiveTapRecord();
  const images = ensureMeterImages(tap);
  const meterImageId = newMeterImageId();
  const readingsBefore = { ...(tap.meterReadings || {}) };

  // 1) Save meterImages entry first (detected filled after OCR).
  const entry = {
    id: meterImageId,
    photo: imageSrc,
    uploadedAt: new Date().toISOString(),
    sessionId: getAssessmentSessionId(),
    detected: {}
  };
  images.push(entry);
  syncMeterThumbFromSession(tap);
  saveActiveJobState?.();
  renderMeterThumbnailRow();
  resetMeterCapturePreview();
  renderAssessList();

  showToast(typeof t === 'function' ? t('meter.processingTitle') : 'Reading image...');

  // 2) Always run OCR for this image (never skip because Drive/busy).
  let detected = {};
  let ocrUnavailable = false;
  console.warn('[OCR FLOW] starting detection', {
    imageLength: imageSrc.length,
    imageType: typeof imageSrc === 'string' ? imageSrc.slice(0, 40) : typeof imageSrc,
    meterImageId
  });
  try {
    detected = await detectMeterReadingsFromImage(imageSrc);
  } catch (error) {
    if (OCR_USER_ERROR_CODES.has(error?.code)) {
      ocrUnavailable = true;
      detected = {};
      console.warn('[OCR FLOW] detection unavailable', {
        meterImageId,
        code: error.code,
        message: error.message
      });
    } else {
      throw error;
    }
  }
  console.warn('[OCR FLOW] detected result', { meterImageId, detected, ocrUnavailable });

  // 3) Merge + write form fields from OCR result only (no mock/fallback values).
  entry.detected = detected;
  tap.meterReadings = mergeMeterReadings(tap.meterReadings, detected);
  if (Object.keys(detected).length) tap.meterSource = 'ocr';
  syncMeterThumbFromSession(tap);
  writeMeterReadingFields(tap.meterReadings);
  S.scoreBaseReadings = null;
  S.scoreVal = null;
  if (S.activeJob?.draft) {
    S.activeJob.draft.scoreBaseReadings = null;
    S.activeJob.draft.scoreVal = null;
  }
  saveActiveJobState?.();
  renderAssessList();
  renderMeterThumbnailRow();

  const fieldsUpdated = Object.keys(detected).some(
    key => String(detected[key]) !== '' && String(readingsBefore[key] ?? '') !== String(tap.meterReadings[key] ?? '')
  );
  if (ocrUnavailable) {
    showToast(typeof t === 'function' ? t('meter.toastOcrUnavailable') : 'OCR is not ready. Enter readings manually.');
  } else if (fieldsUpdated) {
    showToast(typeof t === 'function' ? t('meter.toastFilled') : 'Readings filled');
  } else {
    showToast(typeof t === 'function' ? t('meter.toastNoValues') : 'No values detected. Enter readings manually.');
  }

  // 4) Drive upload after OCR completes (success or empty) — does not hide OCR outcome.
  console.warn('[OCR FLOW] uploading image', { meterImageId, tapIndex });
  uploadMeterSessionImage(tapIndex, entry.id, imageSrc).catch(error => {
    console.warn('Meter session upload failed', error);
  });
  return entry;
}

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
      tap.meterReadings = mergeMeterReadings(tap.meterReadings, readings);
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
  // Meter session uses the dedicated OCR queue — never the chlorine mock busy lock.
  if (previewId === 'meter-photo-preview') {
    if (window.MeterReadingCapture?.processPhoto) {
      return MeterReadingCapture.processPhoto(photoSrc);
    }
    return appendMeterSessionPhoto(photoSrc);
  }

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
  tap.meterReadings = mergeMeterReadings(tap.meterReadings, readMeterReadingFields());
  saveActiveJobState?.();
}

window.MeterReadingCapture = {
  provider: MeterReadingOcrProvider,
  _processing: false,
  /** Serial queue so image 2/3 still get OCR while image 1 is in flight. */
  _queue: [],

  init() {
    const tap = getActiveTapRecord();
    ensureMeterImages(tap);
    writeMeterReadingFields(tap.meterReadings || {});
    this.bindFieldPersistence();
    renderMeterThumbnailRow();
    if (tap.photos?.meter) {
      setPhotoPreview('meter-photo-preview', tap.photos.meter, { silent: true, skipUpload: true });
    } else {
      resetMeterCapturePreview();
    }
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
    const imageSrc = typeof photoSrc === 'string'
      ? photoSrc
      : resolveCaptureDataUrl(photoSrc);

    console.warn('[METERRAW] image captured', {
      hasPhoto: Boolean(imageSrc),
      photoSrcType: typeof photoSrc,
      imageLength: typeof imageSrc === 'string' ? imageSrc.length : null,
      queueLength: this._queue.length,
      alreadyProcessing: Boolean(this._processing)
    });

    if (!imageSrc) {
      console.warn('[OCR FLOW] missing imageSrc — aborting (no silent continue)', {
        photoSrcType: typeof photoSrc
      });
      return;
    }

    this._queue.push(imageSrc);
    if (this._processing) {
      console.warn('[OCR FLOW] queued for OCR after current image', {
        queueLength: this._queue.length
      });
      return;
    }

    await this._drainMeterOcrQueue();
  },

  async _drainMeterOcrQueue() {
    if (this._processing) return;
    this._processing = true;
    try {
      while (this._queue.length) {
        const nextSrc = this._queue.shift();
        await appendMeterSessionPhoto(nextSrc);
      }
    } catch (error) {
      console.error(error);
      showToast(typeof t === 'function' ? t('meter.toastError') : 'Could not read image');
    } finally {
      this._processing = false;
    }
    // Catch enqueues that arrived after the while-loop emptied but before unlock.
    if (this._queue.length) {
      await this._drainMeterOcrQueue();
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
  const inputId = CameraCapture.inputId;
  const previewId = CameraCapture.previewId;

  // Return to the source screen first; preview/OCR/upload work may take time.
  closeCameraCapture();
  if (inputId === 'slip-input') {
    handleSlipCapture(dataUrl);
  } else if (previewId) {
    setPhotoPreview(previewId, dataUrl);
  }
}

document.addEventListener('change', event => {
  const input = event.target;
  if (!input?.matches?.('input[type="file"][accept^="image"]')) return;

  // A native file picker can suspend browser painting. Hide the camera again
  // as soon as selection returns, before reading or processing the image.
  closeCameraCapture();
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
        } else if (item.meterImageId) {
          const tapIndex = Number.isFinite(item.tapIndex) ? item.tapIndex : S.activeTap;
          ensureTapData();
          const entry = S.tapData[tapIndex]?.meterImages?.find(img => img.id === item.meterImageId);
          const existing = entry?.photo;
          if (DrivePhoto.isUploaded(existing) || existing?.uploading) {
            if (DrivePhoto.isUploaded(existing)) await DrivePhoto.dequeue?.(item.queueKey);
            continue;
          }
          await uploadMeterSessionImage(tapIndex, item.meterImageId, item.dataUrl);
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
        const hasMeterSession = Array.isArray(S.tapData[i]?.meterImages) && S.tapData[i].meterImages.length > 0;
        for (const [taskKey, photo] of Object.entries(photos)) {
          // Session meter images own retry via meterImages[] — do not rewrite photos.meter alone.
          if (taskKey === 'meter' && hasMeterSession) continue;
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

        const meterImages = S.tapData[i]?.meterImages || [];
        for (const entry of meterImages) {
          const photo = entry?.photo;
          if (!entry?.id || !photo || photo.fileId || photo.uploading || !photo.pendingAutoRetry || !photo.previewUrl) {
            continue;
          }
          try {
            await uploadMeterSessionImage(i, entry.id, photo.previewUrl);
          } catch (error) {
            console.warn('Pending meter image auto-retry failed', error);
          }
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
  const isMeterSession = previewId === 'meter-photo-preview';

  if (taskKey && !isMeterSession) {
    ensureTapData();
    if (isMeta) {
      S.tapData[S.activeTap].photos[taskKey] = src;
      setPhotoUploadUi(
        previewId,
        src.uploadError || src.pendingAutoRetry ? 'failed' : (src.uploading ? 'uploading' : 'ok')
      );
    } else if (dataUrl) {
      // Preview only — uploadTaskPhotoToDrive owns the uploading flag.
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
    if (isMeterSession && window.MeterReadingCapture?.processPhoto) {
      // TEMP debug — remove after OCR fill investigation
      console.warn('[OCR] setPhotoPreview → processPhoto', {
        previewId,
        silent: Boolean(options.silent),
        ocrSourceLen: typeof ocrSource === 'string' ? ocrSource.length : null
      });
      MeterReadingCapture.processPhoto(ocrSource);
    } else if (isMeterSession) {
      console.warn('[OCR] setPhotoPreview meter path skipped — MeterReadingCapture missing');
    } else if (previewId === 'cl-photo-preview') {
      processAssessmentPhoto('cl-photo-preview', ocrSource).catch(error => {
        console.error(error);
        showToast(typeof t === 'function' ? t('meter.toastError') : 'Could not read image');
      });
    }
  } else if (isMeterSession) {
    console.warn('[OCR] setPhotoPreview did not start OCR', {
      silent: Boolean(options.silent),
      hasOcrSource: Boolean(ocrSource),
      skipUpload: Boolean(options.skipUpload)
    });
  }

  if (!skipUpload && dataUrl && taskKey && !isMeterSession) {
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
