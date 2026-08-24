const JOB_FIELD_IDS = [
  'ci-fname', 'ci-lname', 'ci-phone', 'ci-line', 'ci-email',
  'ci-contact', 'ci-contact-ph', 'ci-city', 'ci-postal', 'ci-addr', 'ci-maps',
  'ci-proptype', 'ci-propage', 'ci-filter', 'ci-source', 'ci-consent',
  'm-ph', 'm-tds', 'm-ec', 'm-temp', 'm-turb', 'm-orp', 'm-do', 'm-free-cl', 'm-total-cl',
  'fb-comment', 'fb-consent'
];

const DEFAULT_TAPS = ['Kitchen', 'Master bath', 'Shower', 'Laundry', 'Guest'];

/**
 * Deep-clone tapData (which can carry several base64 photo blobs per tap)
 * without JSON.stringify/parse's string-serialization overhead — this runs
 * on every Save Draft and every case open, so it was a measurable source of
 * UI jank on photo-heavy Cases (2026-08-18 fix). structuredClone is a plain
 * value clone like JSON round-tripping, just implemented natively instead of
 * via a string; falls back to the JSON approach on engines without it.
 */
function fastDeepClone(value) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* fall through to JSON clone below */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

/** Durable pointer to the Case the operator was working on (survives reload). */
const ACTIVE_CASE_REF_KEY = 'wm-active-case-ref';

function persistActiveCaseRef(job) {
  if (!job) return;
  const ref = {
    id: job.id != null ? String(job.id) : null,
    notionId: job.notionId ? String(job.notionId) : null,
    date: job.date || null
  };
  if (!ref.id && !ref.notionId) return;
  try {
    localStorage.setItem(ACTIVE_CASE_REF_KEY, JSON.stringify(ref));
  } catch (error) {
    console.warn('[Service Portal] could not persist active case ref', error);
  }
}

function clearActiveCaseRef() {
  try {
    localStorage.removeItem(ACTIVE_CASE_REF_KEY);
  } catch {
    /* ignore */
  }
}

function readActiveCaseRef() {
  try {
    const raw = localStorage.getItem(ACTIVE_CASE_REF_KEY);
    if (!raw) return null;
    const ref = JSON.parse(raw);
    if (!ref || (typeof ref !== 'object')) return null;
    if (!ref.id && !ref.notionId) return null;
    return ref;
  } catch {
    return null;
  }
}

function findJobByCaseRef(ref, jobs = JOBS) {
  if (!ref || !Array.isArray(jobs)) return null;
  const refId = ref.id != null ? String(ref.id) : '';
  const refNotion = ref.notionId != null ? String(ref.notionId) : '';
  const refCompact = refNotion.replace(/-/g, '');
  return jobs.find(job =>
    (refId && String(job.id) === refId)
    || (refNotion && String(job.notionId || '') === refNotion)
    || (refCompact && String(job.id) === refCompact)
  ) || null;
}

/** Focus dashboard calendar on the Case date without changing HTML/CSS. */
function focusCalendarOnJobDate(job) {
  const iso = String(job?.date || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!iso) return;
  if (typeof getMonday !== 'function') return;
  const picked = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  if (Number.isNaN(picked.getTime())) return;
  if (typeof weekBase !== 'undefined') {
    weekBase = getMonday(picked);
  }
  S.selDay = (picked.getDay() + 6) % 7;
}

/**
 * After Notion/list reload, restore the operator's Case from durable identity.
 * Does not create Cases. Returns the restored job or null.
 */
function restoreActiveCaseFromPersistence() {
  const ref = readActiveCaseRef();
  if (!ref) return null;
  const job = findJobByCaseRef(ref, JOBS);
  if (!job) return null;
  S.activeJob = job;
  // Hydrate session taps from the Case draft immediately so initTaps /
  // incidental saveActiveJobState cannot clobber measurements with empty
  // DEFAULT_TAPS (UJ-06 cold-reload wipe).
  if (job.draft?.taps?.length) {
    S.taps = [...job.draft.taps];
    S.activeTap = job.draft.activeTap || 0;
    S.tapData = fastDeepClone(job.draft.tapData || S.taps.map(() => ({ tasks: {}, photos: {} })));
    S.pkg = job.draft.pkg || job.pkg || S.pkg;
  }
  // Only pull the calendar off today for a Case the operator is genuinely
  // mid-assessment on. Otherwise a stale ref (e.g. a Case merely opened once,
  // days ago) would silently strand a fresh page load on an old date instead
  // of today — see the 2026-08-10/11 production incident this guard fixes.
  if (job.status === 'in_progress') {
    focusCalendarOnJobDate(job);
  }
  return job;
}

function defaultJobDraft(job) {
  return {
    pkg: job?.pkg || 'essential',
    stepsDone: { preassess: false, assess: false, score: false, payment: false, feedback: false },
    payMethod: 'cash',
    rating: 3,
    scoreVal: null,
    scoreTapFilter: 'all',
    scoreStandardKey: 'thailand',
    scoreBaseReadings: null,
    paymentSlipPhoto: null,
    paymentSlipSource: null,
    taps: [...DEFAULT_TAPS],
    activeTap: 0,
    tapData: DEFAULT_TAPS.map(() => ({ tasks: {}, photos: {} })),
    owner: 'yes',
    msMembers: [],
    msConcerns: [],
    fields: {}
  };
}

function getJobDraft(job) {
  if (!job) return null;
  if (!job.draft) job.draft = defaultJobDraft(job);
  return job.draft;
}

function readField(id) {
  const el = document.getElementById(id);
  if (!el) return undefined;
  if (el.type === 'checkbox') return el.checked;
  return el.value;
}

function writeField(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const empty = value === undefined || value === null || value === '';
  if (el.type === 'checkbox') {
    el.checked = empty ? false : !!value;
    return;
  }
  if (el.tagName === 'SELECT') {
    const next = empty ? '' : String(value);
    let matched = false;
    [...el.options].forEach(option => {
      const hit = option.value === next || (!option.value && !next) || option.textContent === next;
      option.selected = hit;
      if (hit) matched = true;
    });
    el.value = matched ? (el.options[el.selectedIndex]?.value ?? next) : '';
    return;
  }
  el.value = empty ? '' : value;
}

function readMsValues(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return [];
  return [...wrap.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
}

function writeMsValues(wrapId, values) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const set = new Set(values || []);
  wrap.querySelectorAll('input[type=checkbox]').forEach(cb => { cb.checked = set.has(cb.value); });
  if (typeof updateMsDisplay === 'function') updateMsDisplay(wrapId);
}

function syncJobMetaFromDraft(job, draft) {
  if (!job || !draft) return;
  const fields = draft.fields || {};
  const fname = (fields['ci-fname'] || '').trim();
  const lname = (fields['ci-lname'] || '').trim();
  if (fname && lname) job.name = `${fname} ${lname.charAt(0).toUpperCase()}.`;
  else if (fname) job.name = fname;
  else if (lname) job.name = `${lname.charAt(0).toUpperCase()}.`;

  const addr = (fields['ci-addr'] || '').trim();
  if (addr) job.addr = addr;

  job.pkg = draft.pkg;

  const proptype = fields['ci-proptype'];
  const propage = fields['ci-propage'];
  const ownerLabel = draft.owner === 'yes' ? 'Owner–present' : 'Owner–away';
  const parts = [proptype, propage, ownerLabel].filter(p => p && p !== 'Please select');
  if (parts.length) job.meta = parts.join(' · ');

  const contact = (fields['ci-contact'] || '').trim();
  if (contact && draft.owner !== 'yes') job.contact = contact;
  else delete job.contact;

  if (S.activeJob && String(S.activeJob.id) === String(job.id) && job.status !== 'done') job.status = 'in_progress';
}

function saveActiveJobState() {
  if (!S.activeJob) return;
  const draft = getJobDraft(S.activeJob);

  // 2026-08-18 (PO-approved): client-only "last locally edited" timestamp,
  // stamped on every local save — distinct from assessmentUpdatedAt, which
  // only advances once a Notion sync actually confirms (see scheduleAssessmentSync
  // below / job-state.js:343). Closes a race where a just-typed-but-not-yet-synced
  // edit and a reload landing in that window could both carry the SAME (stale,
  // last-confirmed-sync) assessmentUpdatedAt, so AssessmentSnapshot.preferDraft()
  // couldn't tell the fresher local edit apart from the older remote snapshot
  // and could discard it. Never sent to the API — local-merge signal only.
  draft.localEditedAt = new Date().toISOString();

  draft.pkg = S.pkg;
  draft.stepsDone = { ...S.stepsDone };
  draft.payMethod = S.payMethod;
  draft.rating = S.rating;
  draft.scoreVal = S.scoreVal;
  draft.scoreTapFilter = S.scoreTapFilter;
  // Selected Country Score standard (product decision, 2026-08-14): persisted
  // per Case, same durable draft object as scoreTapFilter, so it survives
  // reload/reopen instead of silently resetting to the 'thailand' default.
  draft.scoreStandardKey = S.scoreStandardKey;
  draft.scoreBaseReadings = S.scoreBaseReadings ? { ...S.scoreBaseReadings } : null;
  draft.paymentSlipPhoto = S.paymentSlipPhoto;
  draft.paymentSlipSource = S.paymentSlipSource;

  // UJ-06: After cold reload, restoreActiveCaseFromPersistence sets S.activeJob
  // but initTaps may install empty DEFAULT tapData before loadJobState runs.
  // Never overwrite a draft that already has measurements with an empty session.
  const liveTapData = Array.isArray(S.tapData) ? S.tapData : [];
  const liveHasMeasurements = liveTapData.some(tap => Boolean(
    Object.keys(tap?.meterReadings || {}).length
    || Object.keys(tap?.chlorineReadings || {}).length
    || Object.keys(tap?.standardMeasurement || {}).length
  ));
  const draftHasMeasurements = (typeof AssessmentSnapshot !== 'undefined' && AssessmentSnapshot.draftHasMeasurements)
    ? AssessmentSnapshot.draftHasMeasurements(draft)
    : false;
  if (liveHasMeasurements || !draftHasMeasurements) {
    draft.taps = [...(S.taps || DEFAULT_TAPS)];
    draft.activeTap = S.activeTap || 0;
    draft.tapData = fastDeepClone(liveTapData);
  }

  draft.fields = {};
  JOB_FIELD_IDS.forEach(id => {
    const v = readField(id);
    if (v !== undefined) draft.fields[id] = v;
  });

  const owner = document.querySelector('#owner-radios input:checked');
  draft.owner = owner?.value || 'yes';
  draft.msMembers = readMsValues('ms-members');
  draft.msConcerns = readMsValues('ms-concerns');

  // Mark local measurement persistence before any network sync.
  if (typeof AssessmentSnapshot !== 'undefined' && AssessmentSnapshot.draftHasMeasurements(draft)) {
    if (draft.assessmentSyncStatus !== 'SYNCING') {
      draft.assessmentSyncStatus = 'LOCAL_SAVED';
    }
  }

  syncJobMetaFromDraft(S.activeJob, draft);
  persistJobs();
  scheduleAssessmentSync(S.activeJob);
}

function buildAssessmentSnapshot(job = S.activeJob) {
  if (typeof AssessmentSnapshot === 'undefined' || !AssessmentSnapshot?.buildSnapshot) {
    throw new Error('AssessmentSnapshot module is not loaded');
  }
  const draft = getJobDraft(job);
  const nextRevision = Math.max(1, (Number(draft.assessmentRevision) || 0) + 1);
  return AssessmentSnapshot.buildSnapshot({
    taps: draft.taps || S.taps || [],
    tapData: draft.tapData || S.tapData || [],
    revision: nextRevision,
    updatedAt: new Date().toISOString()
  });
}

let _assessmentSyncTimer = null;
let _assessmentSyncQueue = Promise.resolve();
let _assessmentSyncSeq = 0;

function scheduleAssessmentSync(job = S.activeJob) {
  if (!job?.notionId || job.manualPending) return;
  const draft = getJobDraft(job);
  if (typeof AssessmentSnapshot === 'undefined' || !AssessmentSnapshot.draftHasMeasurements(draft)) {
    return;
  }
  clearTimeout(_assessmentSyncTimer);
  _assessmentSyncTimer = setTimeout(() => {
    syncJobAssessmentToNotion(job).catch(() => {});
  }, 700);
}

/**
 * Sync measurement snapshot to Notion Case.
 * Local data is never rolled back on failure.
 */
async function syncJobAssessmentToNotion(job = S.activeJob) {
  if (!job?.notionId || job.manualPending) {
    return { ok: false, reason: 'not_ready' };
  }
  if (typeof AssessmentSnapshot === 'undefined') {
    return { ok: false, reason: 'module_missing' };
  }

  const draft = getJobDraft(job);
  if (!AssessmentSnapshot.draftHasMeasurements(draft)) {
    return { ok: false, reason: 'no_measurements' };
  }

  const seq = ++_assessmentSyncSeq;
  draft.assessmentSyncStatus = 'SYNCING';
  persistJobs();

  const run = async () => {
    // Drop superseded queued syncs.
    if (seq !== _assessmentSyncSeq) {
      return { ok: false, reason: 'superseded' };
    }

    let snapshot;
    try {
      snapshot = buildAssessmentSnapshot(job);
    } catch (error) {
      draft.assessmentSyncStatus = 'SYNC_FAILED';
      draft.assessmentSyncError = error.message || 'build_failed';
      persistJobs();
      return { ok: false, error: draft.assessmentSyncError };
    }

    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(job.notionId)}/assessment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ snapshot })
      });
      const payload = await response.json().catch(() => ({}));
      if (seq !== _assessmentSyncSeq) {
        return { ok: false, reason: 'superseded' };
      }
      if (!response.ok || payload.ok === false) {
        draft.assessmentSyncStatus = 'SYNC_FAILED';
        draft.assessmentSyncError = payload.error || `http_${response.status}`;
        persistJobs();
        return { ok: false, error: draft.assessmentSyncError, status: response.status };
      }

      const saved = payload.snapshot || snapshot;
      draft.assessmentRevision = Number(saved.revision) || snapshot.revision;
      draft.assessmentUpdatedAt = saved.updatedAt || snapshot.updatedAt;
      draft.assessmentSyncStatus = 'SYNCED';
      draft.assessmentSyncError = null;
      persistJobs();

      if (payload.case && typeof mergeApiCaseIntoJob === 'function') {
        // Preserve local draft measurements; only refresh Notion metadata.
        mergeApiCaseIntoJob(job, payload.case);
      }
      return { ok: true, skipped: Boolean(payload.skipped), snapshot: saved };
    } catch (error) {
      draft.assessmentSyncStatus = 'SYNC_FAILED';
      draft.assessmentSyncError = error.message || 'network_error';
      persistJobs();
      console.warn('[syncJobAssessmentToNotion] failed', error);
      return { ok: false, error: draft.assessmentSyncError };
    }
  };

  _assessmentSyncQueue = _assessmentSyncQueue.then(run, run);
  return _assessmentSyncQueue;
}

function restoreSlipPreview() {
  const card = document.getElementById('slip-upload-card');
  const box = card?.querySelector('.photo-box') || document.querySelector('#slip-preview')?.closest('.photo-box');
  const sub = document.getElementById('slip-sub');
  const preview = document.getElementById('slip-preview');
  if (!preview) return;

  if (S.paymentSlipPhoto) {
    if (typeof normalizeInterruptedPhoto === 'function') {
      S.paymentSlipPhoto = normalizeInterruptedPhoto(S.paymentSlipPhoto);
    } else if (
      S.paymentSlipPhoto
      && typeof S.paymentSlipPhoto === 'object'
      && S.paymentSlipPhoto.uploading
      && !S.paymentSlipPhoto.fileId
      && S.paymentSlipPhoto.previewUrl
    ) {
      S.paymentSlipPhoto = {
        ...S.paymentSlipPhoto,
        uploading: false,
        uploadError: S.paymentSlipPhoto.uploadError || 'Upload interrupted'
      };
    }
    if (typeof setPhotoPreview === 'function') {
      setPhotoPreview('slip-preview', S.paymentSlipPhoto, { silent: true, skipUpload: true });
    } else {
      const src = typeof DrivePhoto !== 'undefined'
        ? DrivePhoto.previewSrc(S.paymentSlipPhoto)
        : (typeof S.paymentSlipPhoto === 'string' ? S.paymentSlipPhoto : '');
      if (src) {
        preview.src = src;
        preview.style.display = 'block';
        preview.classList.add('preview');
        box?.classList.add('has-photo');
        box?.querySelector('.pb-icon')?.classList.add('hidden');
        box?.querySelector('.pb-label')?.classList.add('hidden');
        box?.querySelector('.photo-status')?.classList.remove('hidden');
      }
    }
    if (sub) sub.textContent = typeof t === 'function' ? t('pay.uploaded') : 'Photo attached';
    return;
  }

  preview.removeAttribute('src');
  preview.style.display = 'none';
  preview.classList.remove('preview');
  box?.classList.remove('has-photo');
  box?.querySelector('.pb-icon')?.classList.remove('hidden');
  box?.querySelector('.pb-label')?.classList.remove('hidden');
  box?.querySelector('.photo-status')?.classList.add('hidden');
  if (sub && !S.paymentSlipPhoto) sub.textContent = typeof t === 'function' ? t('pay.uploadSub') : 'Photo of transfer confirmation or cash receipt';
}

function loadJobState(job) {
  const draft = getJobDraft(job);

  // Ensure Drive customer folder cache from Notion (if properties exist) is available to uploads.
  if (job.drive?.folderId && draft && !draft.driveFolderId) {
    draft.driveFolderId = job.drive.folderId;
    draft.driveFolderUrl = job.drive.folderUrl || null;
  }

  S.pkg = draft.pkg;
  S.stepsDone = { ...draft.stepsDone };
  S.payMethod = draft.payMethod || 'cash';
  S.rating = draft.rating ?? 3;
  S.scoreVal = draft.scoreVal;
  S.scoreTapFilter = draft.scoreTapFilter || 'all';
  // Restore this Case's own selected Country Score standard (falls back to
  // the same 'thailand' default a brand-new Case would use). Must happen
  // before any renderWaterScore()/Hero calculation for this Case.
  S.scoreStandardKey = draft.scoreStandardKey || 'thailand';
  S.scoreBaseReadings = draft.scoreBaseReadings ? { ...draft.scoreBaseReadings } : null;
  // Case switch must not keep prior Case Hero / comparison objects alive.
  // Score screen recomputes from the newly loaded Case via renderWaterScore.
  S.currentScoreResult = null;
  S.comparisonScoreResult = null;
  S.displayedScore = null;
  // Score Architecture V2 (2026-08-17, PO-approved): S.publicScoreView was
  // the one score-related global excluded from this reset block (architecture
  // audit finding). loadJobState() only ever runs in the operator app (the
  // standalone public-report page calls mountPublicWaterScore() directly,
  // never loadJobState()), so opening/switching a Case here must never leave
  // a stale publicView=true from a previous render.
  S.publicScoreView = false;
  const gaugeEl = typeof document !== 'undefined' ? document.getElementById('gauge-val') : null;
  if (gaugeEl) gaugeEl.textContent = '—';
  S.paymentSlipPhoto = draft.paymentSlipPhoto;
  S.paymentSlipSource = draft.paymentSlipSource;
  S.taps = draft.taps?.length ? [...draft.taps] : [...DEFAULT_TAPS];
  S.activeTap = draft.activeTap || 0;
  S.tapData = draft.tapData?.length
    ? fastDeepClone(draft.tapData)
    : S.taps.map(() => ({ tasks: {}, photos: {} }));

  // Normalize abandoned in-flight uploads so previews + retry work after reload.
  if (typeof normalizeInterruptedPhoto === 'function') {
    S.tapData.forEach(tap => {
      if (tap?.photos) {
        Object.keys(tap.photos).forEach(key => {
          tap.photos[key] = normalizeInterruptedPhoto(tap.photos[key]);
        });
      }
      if (Array.isArray(tap?.meterImages)) {
        tap.meterImages.forEach(entry => {
          if (entry?.photo && typeof entry.photo === 'object') {
            entry.photo = normalizeInterruptedPhoto(entry.photo);
          }
        });
        if (typeof syncMeterThumbFromSession === 'function') syncMeterThumbFromSession(tap);
      }
    });
    if (S.paymentSlipPhoto && typeof S.paymentSlipPhoto === 'object') {
      S.paymentSlipPhoto = normalizeInterruptedPhoto(S.paymentSlipPhoto);
    }
  }

  JOB_FIELD_IDS.forEach(id => writeField(id, draft.fields[id]));

  const ownerVal = draft.owner || 'yes';
  document.querySelectorAll('#owner-radios .radio-item').forEach(el => {
    const sel = el.dataset.val === ownerVal;
    el.classList.toggle('sel', sel);
    const input = el.querySelector('input');
    if (input) input.checked = sel;
  });
  document.getElementById('contact-person-wrap')?.classList.toggle('hidden', ownerVal === 'yes');

  writeMsValues('ms-members', draft.msMembers);
  writeMsValues('ms-concerns', draft.msConcerns);

  if (typeof setProvinceValue === 'function') {
    setProvinceValue(draft.fields['ci-city'] || 'Bangkok');
  }
  if (typeof setPostalForProvince === 'function') {
    const city = draft.fields['ci-city'] || 'Bangkok';
    if (!draft.fields['ci-postal']) setPostalForProvince(city, true);
  }
  if (typeof updateProvinceOptions === 'function') updateProvinceOptions();
  if (typeof updatePreassessmentOptionText === 'function') updatePreassessmentOptionText();
  if (typeof updatePreassessmentCompletionState === 'function') updatePreassessmentCompletionState();
  if (typeof selPkg === 'function') selPkg(S.pkg);
  else if (typeof updatePackageVisibility === 'function') updatePackageVisibility();
  if (typeof setRating === 'function') setRating(S.rating);
  if (typeof selPayMethod === 'function') selPayMethod(S.payMethod);
  restoreSlipPreview();
}

function updateJobHeader(job) {
  const nameEl = document.getElementById('job-client-name');
  const timeEl = document.getElementById('job-time-range');
  const pkgEl = document.getElementById('job-pkg-tag');
  if (nameEl) nameEl.textContent = job.name;
  if (timeEl) timeEl.textContent = `${job.timeStart} – ${job.timeEnd}`;
  if (pkgEl) pkgEl.textContent = S.pkg === 'full' ? t('dash.pkg.full') : t('dash.pkg.essential');
}

function persistJobs() {
  try {
    localStorage.setItem('wm-jobs', JSON.stringify(JOBS));
  } catch (error) {
    console.warn('Could not persist jobs', error);
  }
}

function isKnownScoreStandardKey(value) {
  return ['thailand', 'japan', 'eu', 'who', 'usEpa'].includes(String(value || ''));
}

/**
 * Persist only the Case-owned Country Score preference. This intentionally
 * does not schedule an assessment sync or rewrite Case measurements.
 */
async function persistActiveCaseScoreStandard(standardKey = S.scoreStandardKey) {
  const key = isKnownScoreStandardKey(standardKey) ? standardKey : 'thailand';
  const job = S.activeJob;
  if (!job) return { ok: false, reason: 'no_active_case' };

  const draft = getJobDraft(job);
  draft.scoreStandardKey = key;
  S.scoreStandardKey = key;
  persistJobs();

  if (!job.notionId || job.manualPending) {
    return { ok: true, localOnly: true, scoreStandardKey: key };
  }

  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(job.notionId)}/score-standard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ scoreStandardKey: key })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || `http_${response.status}`);
    }
    if (payload.case) mergeApiCaseIntoJob(job, payload.case);
    return { ok: true, scoreStandardKey: key };
  } catch (error) {
    console.warn('[persistActiveCaseScoreStandard] failed', error);
    return { ok: false, scoreStandardKey: key, error: error.message || 'network_error' };
  }
}

function mergeApiCaseIntoJob(localJob, apiCase) {
  if (!localJob || !apiCase) return localJob;
  const preservedDraft = localJob.draft || getJobDraft(localJob);
  const remoteDraft = apiCase.draft || null;
  const preferredDraft = (typeof AssessmentSnapshot !== 'undefined' && AssessmentSnapshot.preferDraft)
    ? (AssessmentSnapshot.preferDraft(preservedDraft, remoteDraft) || preservedDraft)
    : preservedDraft;
  const remoteScoreStandard = remoteDraft?.scoreStandardKey;
  const localScoreStandard = preservedDraft?.scoreStandardKey;
  const mergedDraft = {
    ...preferredDraft,
    ...(isKnownScoreStandardKey(remoteScoreStandard)
      ? { scoreStandardKey: remoteScoreStandard }
      : (isKnownScoreStandardKey(localScoreStandard) ? { scoreStandardKey: localScoreStandard } : {}))
  };
  const keepInProgress = localJob.status === 'in_progress';
  Object.assign(localJob, apiCase, {
    draft: mergedDraft,
    status: keepInProgress ? 'in_progress' : (apiCase.status || localJob.status),
    manual: localJob.manual,
    startedAt: localJob.startedAt || apiCase.workflow?.serviceStartedAt || null
  });
  if (apiCase.notionId) {
    localJob.notionId = apiCase.notionId;
    localJob.notionSource = true;
    delete localJob.manualPending;
  }
  syncJobMetaFromDraft(localJob, mergedDraft);
  return localJob;
}

async function createManualCaseInNotion(job = S.activeJob) {
  if (!job?.manual) return { ok: false, reason: 'not_manual' };
  if (job.notionId) return { ok: true, case: job, idempotent: true };

  // Prevent double-submit from creating two Notion pages for one user action.
  if (job._durableCreateInFlight) return job._durableCreateInFlight;

  const draft = getJobDraft(job);
  const fields = draft?.fields || {};
  const fullName = [fields['ci-fname'], fields['ci-lname']].filter(Boolean).join(' ').trim()
    || String(job.name || '').trim()
    || 'New Client';

  job._durableCreateInFlight = (async () => {
    try {
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          skipMap: true,
          startOnSite: true,
          fullName,
          address: fields['ci-addr'] || job.addr || '',
          appointmentDate: job.date || '',
          appointmentStart: job.timeStart || '',
          appointmentEnd: job.timeEnd || '',
          packageHistory: draft?.pkg || job.pkg || 'essential',
          serviceStartedAt: job.startedAt || new Date().toISOString()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        console.warn('[createManualCaseInNotion] create failed', payload.error || response.status);
        return { ok: false, error: payload.error || 'create_failed' };
      }
      if (!payload.case?.notionId && !payload.case?.id) {
        console.warn('[createManualCaseInNotion] create returned no durable identity');
        return { ok: false, error: 'missing_durable_identity' };
      }
      if (payload.case) mergeApiCaseIntoJob(job, payload.case);
      if (!job.notionId) {
        return { ok: false, error: 'missing_notion_id' };
      }
      delete job.manualPending;
      persistJobs();
      persistActiveCaseRef(job);
      if (typeof OperatorNotificationBridge?.emitCaseCreatedFromJob === 'function') {
        OperatorNotificationBridge.emitCaseCreatedFromJob(job);
      }
      return { ok: true, case: job };
    } catch (error) {
      console.warn('[createManualCaseInNotion] error', error);
      return { ok: false, error: error.message || 'network_error' };
    } finally {
      delete job._durableCreateInFlight;
    }
  })();

  return job._durableCreateInFlight;
}

function nextPortalCaseLocalId() {
  return JOBS.reduce((m, j) => {
    const legacy = Number(j.legacyNumericId);
    const numeric = Number(j.id);
    const candidate = Number.isFinite(legacy) ? legacy : (Number.isFinite(numeric) ? numeric : 0);
    return Math.max(m, candidate);
  }, 1000) + 1;
}

/**
 * Single durable Case creation contract for portal entry points.
 * Local state is updated only after Notion returns a durable identity.
 * Failed persistence must not leave a "successfully created" Case in JOBS.
 */
function todayIsoLocal() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function createDurablePortalCase(seed = {}) {
  const now = new Date();
  const localId = seed.id != null ? seed.id : nextPortalCaseLocalId();
  const job = {
    id: localId,
    name: seed.name || `New Client ${localId}`,
    addr: seed.addr || 'Address to confirm',
    timeStart: seed.timeStart || '',
    timeEnd: seed.timeEnd || '',
    day: seed.day != null ? seed.day : ((now.getDay() + 6) % 7),
    // Durable Cases must be calendar-addressable (UJ-01/03/11).
    date: seed.date || todayIsoLocal(),
    pkg: seed.pkg || 'essential',
    status: seed.status || 'new',
    startedAt: seed.startedAt || null,
    manual: true,
    manualPending: true,
    meta: seed.meta || 'Portal case'
  };
  ensureJobDraft(job);
  if (seed.draftFields && job.draft) {
    job.draft.fields = { ...(job.draft.fields || {}), ...seed.draftFields };
  }

  const synced = await createManualCaseInNotion(job);
  if (!synced?.ok || !job.notionId) {
    return {
      ok: false,
      error: synced?.error || synced?.reason || 'create_failed',
      case: null
    };
  }

  const already = JOBS.some(existing =>
    String(existing.id) === String(job.id)
    || String(existing.notionId || '') === String(job.notionId)
    || String(existing.id) === String(job.notionId).replace(/-/g, '')
  );
  if (!already) JOBS.push(job);
  persistJobs();
  persistActiveCaseRef(job);
  return { ok: true, case: job };
}

/** Ensure a local manual case exists in Notion (retry path if create-time sync failed). */
async function ensureCaseSyncedToNotion(job = S.activeJob) {
  if (!job) return { ok: false, reason: 'no_job' };
  if (job.notionId) return { ok: true, case: job };
  if (job.manual) return createManualCaseInNotion(job);
  return { ok: false, reason: 'no_notion_id' };
}

async function pushCaseOpenToNotion(job = S.activeJob) {
  if (!job) return { ok: false, reason: 'no_job' };

  try {
    // Unsynced manual shells must not open via /start — createDurablePortalCase owns create.
    if (job.manual && !job.notionId) {
      return { ok: false, deferred: true, reason: 'not_durable' };
    }

    const caseRef = job.notionId || job.id;
    if (!caseRef) return { ok: false, reason: 'no_case_ref' };

    const response = await fetch(`/api/cases/${encodeURIComponent(caseRef)}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: '{}'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      console.warn('[pushCaseOpenToNotion] start failed', payload.error || response.status);
      return { ok: false, error: payload.error || 'start_failed' };
    }
    if (payload.case) mergeApiCaseIntoJob(job, payload.case);
    persistJobs();
    persistActiveCaseRef(job);
    return { ok: true, case: job };
  } catch (error) {
    console.warn('[pushCaseOpenToNotion] error', error);
    return { ok: false, error: error.message || 'network_error' };
  }
}

function loadJobsFromStorage() {
  try {
    const raw = localStorage.getItem('wm-jobs');
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved) || !saved.length) return false;
    JOBS.splice(0, JOBS.length, ...saved);
    setDataSource(localStorage.getItem('wm-jobs-source') || 'localStorage', { count: saved.length });
    return true;
  } catch {
    return false;
  }
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && quoted && next === '"') {
      value += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(value);
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
      value = '';
    } else {
      value += ch;
    }
  }

  if (value || row.length) {
    row.push(value);
    if (row.some(cell => cell.trim())) rows.push(row);
  }

  const headers = rows.shift()?.map(h => h.trim()) || [];
  return rows.map(cells => headers.reduce((record, header, index) => {
    record[header] = (cells[index] || '').trim();
    return record;
  }, {}));
}

function splitClientName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { fname: '', lname: '' };
  return { fname: parts[0], lname: parts.slice(1).join(' ') };
}

function mapCsvPackage(value) {
  const text = (value || '').toLowerCase();
  return text.includes('premium') || text.includes('full') ? 'full' : 'essential';
}

function mapCsvPropertyType(value) {
  const text = (value || '').toLowerCase();
  if (text.includes('condo')) return 'Condominium';
  if (text.includes('town')) return 'Townhome';
  if (text.includes('apartment')) return 'Apartment';
  return 'Single House';
}

function mapCsvPropertyAge(value) {
  const years = parseInt(value, 10);
  if (Number.isNaN(years)) return 'Not sure';
  if (years <= 5) return '0-5 yrs';
  if (years <= 10) return '5-10 yrs';
  if (years <= 20) return '10-20 yrs';
  return '20+ yrs';
}

function mapCsvFilter(value) {
  const text = (value || '').toLowerCase();
  if (text.includes('loyal') || text.includes('vip') || text.includes('premium')) return 'Whole-house filter';
  if (text.includes('lead') || text.includes('follow')) return 'Not sure';
  return 'None';
}

/** YYYY-MM-DD for offline CSV seed so jobsOnDate can place the Case. */
function csvSeedDateIso(index, record = {}) {
  const raw = String(
    record['Created 1']
    || record['Next Follow-up']
    || record['Appointment Date']
    || record.Created
    || ''
  ).trim();
  const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (matched) return `${matched[1]}-${matched[2]}-${matched[3]}`;
  // No appointment column — pin to the current local week by weekday index
  // so offline demo Cases remain visible on the calendar (never silent).
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setDate(monday.getDate() + (index % 7));
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function jobFromClientRecord(record, index) {
  const { fname, lname } = splitClientName(record['Full Name']);
  const pkg = mapCsvPackage(record['Package History']);
  const day = index % 7;
  const slot = Math.floor(index / 7);
  const hour = Math.min(17, 9 + slot);
  const id = 1000 + index + 1;
  const rawStatus = (record.Status || '').toLowerCase();
  const status = rawStatus === 'done' || rawStatus === 'completed' ? 'done' : 'new';
  const propertyType = mapCsvPropertyType(record['Property Type']);
  const propertyAge = mapCsvPropertyAge(record['Property Age (yr)']);
  const source = record.Source || '';
  const concern = record['Water Concerns'] || '';
  const date = csvSeedDateIso(index, record);

  const job = {
    id,
    name: lname ? `${fname} ${lname.charAt(0).toUpperCase()}.` : fname || `CSV Client ${index + 1}`,
    addr: record.Address || 'Address to confirm',
    timeStart: `${String(hour).padStart(2, '0')}:00`,
    timeEnd: `${String(Math.min(18, hour + 1)).padStart(2, '0')}:00`,
    day,
    date,
    pkg,
    status,
    meta: [propertyType, propertyAge, record.Stage || 'CSV lead'].filter(Boolean).join(' - '),
    csvSource: true
  };

  job.draft = defaultJobDraft(job);
  job.draft.fields = {
    'ci-fname': fname,
    'ci-lname': lname,
    'ci-phone': record.Phone || '',
    'ci-line': record['LINE ID'] || '',
    'ci-email': record.Email || '',
    'ci-city': record.Address || 'Bangkok',
    'ci-postal': '',
    'ci-addr': record.Address || '',
    'ci-proptype': propertyType,
    'ci-propage': propertyAge,
    'ci-filter': mapCsvFilter(record['Current Filter']),
    'ci-source': source,
    'ci-consent': String(record['Consent Signed']).toLowerCase() === 'true'
  };
  job.draft.msConcerns = concern ? [concern] : [];
  job.draft.pkg = pkg;

  return job;
}

function setDataSource(source, detail) {
  window.__WM_DATA_SOURCE__ = source;
  try { localStorage.setItem('wm-jobs-source', source); } catch {}
  console.info(`[Service Portal] job data source = ${source}`, detail || '');
}

// Remove any cached jobs/CSV seed so the next boot re-fetches cleanly.
function clearJobsCache() {
  ['wm-jobs', 'wm-jobs-source', 'wm-csv-seed-version'].forEach(key => {
    try { localStorage.removeItem(key); } catch {}
  });
  console.info('[Service Portal] cleared cached jobs (wm-jobs, wm-jobs-source, wm-csv-seed-version)');
}
window.clearJobsCache = clearJobsCache;

/**
 * Clear this device's local Case cache for a sign-out — in-memory JOBS and
 * the localStorage snapshot, but deliberately NOT wm-csv-seed-version: that
 * flag means "this device has already run the one-time CSV import", a
 * device-level fact unrelated to which staff account is signed in, not
 * user-private data. (Unlike clearJobsCache() above, which is a manual
 * debug utility that intentionally forces a full reseed.) The app never
 * reloads the page on sign-out, so without this the next person to sign in
 * on the same device would still see the previous user's cached Cases in
 * memory until their first fresh sync overwrote it.
 */
function resetJobsCacheForLogout() {
  JOBS.length = 0;
  try {
    localStorage.removeItem('wm-jobs');
    localStorage.removeItem('wm-jobs-source');
  } catch { /* ignore */ }
}
window.resetJobsCacheForLogout = resetJobsCacheForLogout;

function jobDraftLookupKeys(job) {
  const keys = [];
  const push = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return;
    keys.push(raw);
    const compact = raw.replace(/-/g, '');
    if (compact && compact !== raw) keys.push(compact);
  };
  push(job?.id);
  push(job?.notionId);
  return keys;
}

/** Collect local drafts so Notion refresh does not wipe meterImages / tapData. */
function collectLocalJobDrafts() {
  const drafts = new Map();
  const ingest = (jobs) => {
    if (!Array.isArray(jobs)) return;
    jobs.forEach(job => {
      if (!job?.draft) return;
      jobDraftLookupKeys(job).forEach(key => {
        drafts.set(key, job.draft);
      });
    });
  };
  ingest(JOBS);
  try {
    const raw = localStorage.getItem('wm-jobs');
    if (raw) ingest(JSON.parse(raw));
  } catch {
    /* ignore corrupt cache */
  }
  return drafts;
}

/**
 * Local Cases that were shown on the dashboard but never received a Notion id
 * (legacy calendar "+" adds). Keep them across Notion refresh so reload/deploy
 * does not erase business data that only lived in wm-jobs.
 * Abandoned manualPending drafts (never saved) are intentionally excluded —
 * discardUnsavedManualCases owns that path.
 */
function collectLocalOnlyUnsyncedJobs() {
  const out = [];
  try {
    const raw = localStorage.getItem('wm-jobs');
    if (!raw) return out;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return out;
    saved.forEach(job => {
      if (!job || isJobCancelled(job)) return;
      if (job.notionId || job.notionSource) return;
      if (job.manualPending) return;
      // CSV mock seed is not a durable Case. Rehydrating it into a Notion
      // session pollutes Search/Calendar with dateless duplicates (UJ-01/02/11).
      if (job.csvSource) return;
      out.push(job);
    });
  } catch {
    /* ignore */
  }
  return out;
}

function findPreservedDraft(job, draftMap) {
  if (!job || !draftMap?.size) return null;
  for (const key of jobDraftLookupKeys(job)) {
    if (draftMap.has(key)) return draftMap.get(key);
  }
  return null;
}

/** Push local preassessment profile (name/address/etc.) to Notion so refresh keeps the latest name. */
async function syncJobProfileToNotion(job = S.activeJob) {
  if (!job?.notionId || job.manualPending) return { ok: false, reason: 'not_ready' };

  const draft = getJobDraft(job);
  const fields = draft?.fields || {};
  const fullName = [fields['ci-fname'], fields['ci-lname']].filter(Boolean).join(' ').trim()
    || String(job.name || '').trim();
  if (!fullName || /^New Client\b/i.test(fullName)) {
    return { ok: false, reason: 'no_real_name' };
  }

  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(job.notionId)}/preassessment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        fields: { ...fields },
        msConcerns: draft?.msConcerns || [],
        owner: draft?.owner || 'yes',
        package: draft?.pkg || job.pkg || 'essential',
        fullName
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      console.warn('[syncJobProfileToNotion] failed', payload.error || response.status);
      return { ok: false, error: payload.error || 'sync_failed' };
    }
    if (payload.case) mergeApiCaseIntoJob(job, payload.case);
    else syncJobMetaFromDraft(job, draft);
    persistJobs();
    return { ok: true, case: job };
  } catch (error) {
    console.warn('[syncJobProfileToNotion] error', error);
    return { ok: false, error: error.message || 'network_error' };
  }
}

function isJobCancelled(job) {
  const status = String(job?.status || '').toLowerCase();
  const workflow = String(job?.workflow?.status || '').toLowerCase();
  return ['cancelled', 'canceled'].includes(status)
    || ['cancelled', 'canceled'].includes(workflow);
}

async function loadJobsFromApi() {
  try {
    const response = await fetch('/api/clients', { cache: 'no-store', credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.ok === false) {
      console.warn('[Service Portal] GET /api/clients failed', {
        status: response.status,
        ok: payload.ok,
        error: payload.error || null
      });
      return false;
    }

    const jobs = Array.isArray(payload) ? payload : payload.jobs;
    if (!Array.isArray(jobs) || !jobs.length) {
      console.warn('[Service Portal] GET /api/clients returned no jobs', payload);
      return false;
    }

    // Cancelled cases stay in Notion but are never loaded into the dashboard list.
    const visibleJobs = jobs.filter(job => !isJobCancelled(job));

    console.info('[Service Portal] GET /api/clients ok', {
      status: response.status,
      count: jobs.length,
      visible: visibleJobs.length,
      cancelledSkipped: jobs.length - visibleJobs.length
    });

    // Notion is authoritative for the job list, but local drafts (meterImages,
    // photos, readings, steps, preassess name) must survive refresh.
    // Manual Create cases live only in the portal until synced elsewhere.
    const preservedDrafts = collectLocalJobDrafts();
    const preservedManualJobs = JOBS.filter(job =>
      job.manual
      && !isJobCancelled(job)
      && (!job.manualPending || job.notionId)
    );
    // Cold boot: JOBS is empty, but localStorage may still hold calendar-created
    // Cases that never reached Notion. Preserve those so reload does not erase them.
    collectLocalOnlyUnsyncedJobs().forEach(job => {
      const already = preservedManualJobs.some(existing =>
        String(existing.id) === String(job.id)
        || (job.notionId && String(existing.notionId || '') === String(job.notionId))
      );
      if (!already) preservedManualJobs.push(job);
    });
    const locallyInProgress = new Set(
      JOBS
        .filter(job => job.status === 'in_progress')
        .map(job => String(job.id))
    );
    const activeJobId = S.activeJob?.id != null ? String(S.activeJob.id) : null;
    const activeNotionId = S.activeJob?.notionId != null ? String(S.activeJob.notionId) : null;
    const normalizedJobs = visibleJobs.map(job => {
      const next = { ...job };
      if (
        (locallyInProgress.has(String(job.id)) || (job.notionId && locallyInProgress.has(String(job.notionId))))
        && !['done', 'cancelled'].includes(job.status)
      ) {
        next.status = 'in_progress';
      }
      const localDraft = findPreservedDraft(job, preservedDrafts);
      if (localDraft || job.draft) {
        const preferred = (typeof AssessmentSnapshot !== 'undefined' && AssessmentSnapshot.preferDraft)
          ? AssessmentSnapshot.preferDraft(localDraft, job.draft)
          : (localDraft || job.draft);
        if (preferred) {
          // Country selection is Case-owned and API-backed. A valid value
          // returned from the Case wins; local storage only fills legacy
          // Cases whose API draft predates this field.
          const remoteScoreStandard = job.draft?.scoreStandardKey;
          const localScoreStandard = localDraft?.scoreStandardKey;
          const draft = {
            ...preferred,
            ...(isKnownScoreStandardKey(remoteScoreStandard)
              ? { scoreStandardKey: remoteScoreStandard }
              : (isKnownScoreStandardKey(localScoreStandard) ? { scoreStandardKey: localScoreStandard } : {}))
          };
          next.draft = draft;
          syncJobMetaFromDraft(next, draft);
        }
      }
      return next;
    });
    JOBS.splice(0, JOBS.length, ...normalizedJobs);
    preservedManualJobs.forEach(job => {
      // Notion is authoritative when API load succeeds — never re-merge CSV seed.
      if (job.csvSource) return;
      const already = JOBS.some(existing =>
        String(existing.id) === String(job.id)
        || (job.notionId && String(existing.notionId || existing.id) === String(job.notionId))
        || (job.notionId && String(existing.id) === String(job.notionId).replace(/-/g, ''))
      );
      if (!already) JOBS.push(job);
    });
    if (activeJobId || activeNotionId) {
      const refreshed = JOBS.find(job =>
        String(job.id) === activeJobId
        || (activeNotionId && String(job.notionId || '') === activeNotionId)
        || (activeNotionId && String(job.id) === activeNotionId.replace(/-/g, ''))
      );
      if (refreshed) {
        S.activeJob = refreshed;
        persistActiveCaseRef(refreshed);
      } else if (S.activeJob && isJobCancelled(S.activeJob)) {
        S.activeJob = null;
        clearActiveCaseRef();
      }
    } else {
      // Cold reload / deploy: session memory is empty — restore from durable ref.
      restoreActiveCaseFromPersistence();
    }
    persistJobs();
    setDataSource('notion', {
      count: visibleJobs.length,
      dates: visibleJobs.map(j => ({ name: j.name, date: j.date || '(none)', day: j.day })).slice(0, 5)
    });
    if (typeof OperatorNotificationBridge?.syncFromJobs === 'function') {
      OperatorNotificationBridge.syncFromJobs(JOBS);
    } else if (typeof OperatorNotificationObserver?.syncFromJobs === 'function') {
      OperatorNotificationObserver.syncFromJobs(JOBS);
    }
    return true;
  } catch (error) {
    console.warn('[Service Portal] GET /api/clients error', error);
    return false;
  }
}

async function loadJobsFromCsv() {
  try {
    const response = await fetch('clients_30_mock_data.csv', { cache: 'no-store' });
    if (!response.ok) return false;
    const records = parseCsvRows(await response.text());
    const jobs = records.map(jobFromClientRecord);
    if (!jobs.length) return false;
    JOBS.splice(0, JOBS.length, ...jobs);
    persistJobs();
    setDataSource('csv', { count: jobs.length });
    return true;
  } catch (error) {
    console.warn('Could not load CSV jobs', error);
    return false;
  }
}

function ensureJobDraft(job) {
  getJobDraft(job);
}
