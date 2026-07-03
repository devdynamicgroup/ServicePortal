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
  const photo = key ? S.tapData[S.activeTap]?.photos?.[key] : null;
  if (photo) setPhotoPreview(previewId, photo, { silent: true });
}

function restoreCurrentPhotoScreen(screenId) {
  const map = {
    's-photo': 'tap-photo-preview',
    's-visual': 'vis-photo-preview',
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
  const img = document.getElementById(previewId);
  if (img?.src && img.style.display !== 'none') {
    ensureTapData();
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
    if (photo) {
      thumbEl.innerHTML = `<img src="${photo}" alt="">`;
      thumbEl.classList.add('has-photo');
    } else {
      thumbEl.innerHTML = '';
      thumbEl.classList.remove('has-photo');
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

const METER_READING_FIELDS = {
  ph: 'm-ph',
  tds: 'm-tds',
  ec: 'm-ec',
  temp: 'm-temp',
  turbidity: 'm-turb',
  orp: 'm-orp',
  do: 'm-do'
};

const MOCK_METER_READING_RESULT = {
  ph: '7.2',
  tds: '450',
  ec: '690',
  temp: '28',
  turbidity: '1.2',
  orp: '320',
  do: '6.8'
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
  async analyzePhoto() {
    await new Promise(resolve => setTimeout(resolve, 650));
    return {
      source: 'mock-ocr',
      confidence: 0.92,
      photo: MOCK_METER_PHOTO,
      readings: { ...MOCK_METER_READING_RESULT }
    };
  }
};

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

function hasStoredMeterReadings(readings) {
  if (!readings || typeof readings !== 'object') return false;
  return Object.values(readings).some(value => String(value).trim() !== '');
}

window.MeterReadingCapture = {
  provider: MeterReadingOcrProvider,
  _state: { mode: 'start', source: null, photo: null },

  init() {
    const tap = getActiveTapRecord();
    const hasReadings = hasStoredMeterReadings(tap.meterReadings) || !!tap.tasks?.meter;
    writeMeterReadingFields(tap.meterReadings || {});
    this.bindFieldPersistence();
    this.setMode(hasReadings ? 'review' : 'start', {
      photo: tap.photos?.meter,
      source: tap.meterSource || (hasReadings ? 'manual' : null)
    });
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

  setMode(mode, detail = {}) {
    this._state = {
      mode,
      source: detail.source ?? this._state.source,
      photo: detail.photo ?? this._state.photo
    };

    document.getElementById('meter-start')?.classList.toggle('hidden', mode !== 'start');
    document.getElementById('meter-processing')?.classList.toggle('hidden', mode !== 'processing');
    document.getElementById('meter-review')?.classList.toggle('hidden', mode !== 'review');
    document.getElementById('meter-form-label')?.classList.toggle('hidden', mode !== 'review');
    document.getElementById('meter-form')?.classList.toggle('hidden', mode !== 'review');
    const saveBtn = document.getElementById('btn-meter-save');
    if (saveBtn) saveBtn.disabled = mode !== 'review';

    const preview = document.getElementById('meter-photo-preview');
    const photo = this._state.photo;
    if (preview && photo) preview.style.backgroundImage = `url("${photo}")`;
    else if (preview) preview.style.backgroundImage = '';

    this.updateReviewSub();
  },

  updateReviewSub() {
    const sub = document.getElementById('meter-review-sub');
    if (!sub) return;
    sub.textContent = this._state.source === 'manual' ? t('meter.reviewSubManual') : t('meter.reviewSubOcr');
  },

  refreshI18n() {
    if (this._state.mode === 'review') this.updateReviewSub();
  },

  async takePhoto() {
    this.setMode('processing');
    try {
      const result = await this.provider.analyzePhoto();
      const tap = getActiveTapRecord();
      tap.meterReadings = result.readings;
      tap.meterSource = result.source;
      tap.photos.meter = result.photo;
      writeMeterReadingFields(result.readings);
      this.setMode('review', { photo: result.photo, source: result.source });
      renderAssessList();
      saveActiveJobState?.();
      showToast(t('meter.toastFilled'));
    } catch (error) {
      console.error(error);
      this.setMode('start');
      showToast(t('meter.toastError'));
    }
  },

  fillManually() {
    const tap = getActiveTapRecord();
    tap.meterSource = 'manual';
    tap.meterReadings = tap.meterReadings || readMeterReadingFields();
    this.setMode('review', { photo: tap.photos?.meter, source: 'manual' });
    saveActiveJobState?.();
  },

  save() {
    persistMeterReadings();
    completeSub('meter-check','s-assess');
    saveActiveJobState?.();
  }
};

function openPhotoStudio(inputId, previewId) {
  if (!inputId) return;
  openCameraCapture(inputId, previewId || null);
}

function readImageFile(file, onLoad) {
  const reader = new FileReader();
  reader.onload = () => onLoad(reader.result);
  reader.readAsDataURL(file);
}

function handlePhotoFile(input, previewId) {
  const file = input.files?.[0];
  if (!file || !previewId) return;
  readImageFile(file, src => {
    setPhotoPreview(previewId, src);
    closeCameraCapture();
    showToast('Photo uploaded');
  });
}

function openPhotoCapture(inputId) {
  closeCameraCapture?.();
  const input = document.getElementById(inputId);
  if (!input) return;

  input.accept = 'image/*';
  input.removeAttribute('capture');
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
  previewId: null
};

async function openCameraCapture(inputId, previewId) {
  CameraCapture.inputId = inputId;
  CameraCapture.previewId = previewId || null;

  const overlay = document.getElementById('camera-overlay');
  const video = document.getElementById('camera-video');
  const error = document.getElementById('camera-error');
  if (!overlay || !video) {
    if (inputId) openPhotoCapture(inputId);
    else showToast('Camera not available on this device');
    return;
  }

  closeTransientOverlays?.();
  error?.classList.add('hidden');
  overlay.classList.remove('hidden');
  stopCameraStream();

  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable');
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
    error?.classList.remove('hidden');
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
    setPhotoPreview(previewId, src);
    showToast('Photo uploaded');
  });
}

function setPhotoPreview(previewId, src, options = {}) {
  const img = document.getElementById(previewId);
  if (!img) return;
  img.src = src;
  img.style.display = 'block';
  img.classList.add('preview');
  const box = img.closest('.photo-box');
  const slipCard = img.closest('.slip-upload-card');
  if (box) {
    box.classList.add('has-photo');
    box.querySelector('.pb-icon')?.classList.add('hidden');
    box.querySelector('.pb-label')?.classList.add('hidden');
    box.querySelector('.photo-status')?.classList.remove('hidden');
  }
  if (slipCard) {
    slipCard.classList.add('has-photo');
    slipCard.querySelector('.slip-cam-icon')?.classList.add('hidden');
    const sub = slipCard.querySelector('#slip-sub');
    if (sub) sub.textContent = typeof t === 'function' ? t('pay.uploaded') : 'Photo attached';
  }
  const taskKey = PHOTO_ID_TASKS[previewId];
  if (taskKey) {
    ensureTapData();
    S.tapData[S.activeTap].photos[taskKey] = src;
    if (!options.silent) saveActiveJobState?.();
    renderAssessList();
  }
}

function handleSlipUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  readImageFile(file, src => {
    S.paymentSlipPhoto = src;
    S.paymentSlipSource = typeof t === 'function' ? t('pay.uploaded') : 'Photo attached';
    setPhotoPreview('slip-preview', src);
    closeCameraCapture();
    showToast(typeof t === 'function' ? t('pay.uploaded') : 'Photo attached');
  });
}

function handleSlipCapture(dataUrl) {
  S.paymentSlipPhoto = dataUrl;
  S.paymentSlipSource = typeof t === 'function' ? t('pay.uploaded') : 'Photo attached';
  setPhotoPreview('slip-preview', dataUrl);
  showToast(typeof t === 'function' ? t('pay.uploaded') : 'Photo attached');
}
