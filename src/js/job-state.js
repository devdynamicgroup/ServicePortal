const JOB_FIELD_IDS = [
  'ci-fname', 'ci-lname', 'ci-phone', 'ci-line', 'ci-email',
  'ci-contact', 'ci-contact-ph', 'ci-city', 'ci-postal', 'ci-addr', 'ci-maps',
  'ci-proptype', 'ci-propage', 'ci-filter', 'ci-source', 'ci-consent',
  'm-ph', 'm-tds', 'm-ec', 'm-temp', 'm-turb', 'm-orp', 'm-do', 'm-free-cl', 'm-total-cl',
  'fb-comment', 'fb-consent'
];

const DEFAULT_TAPS = ['Kitchen', 'Master bath', 'Shower', 'Laundry', 'Guest'];

function defaultJobDraft(job) {
  return {
    pkg: job?.pkg || 'essential',
    stepsDone: { preassess: false, assess: false, score: false, payment: false, feedback: false },
    payMethod: 'cash',
    rating: 3,
    scoreVal: null,
    scoreTapFilter: 'all',
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
  if (!el || value === undefined) return;
  if (el.type === 'checkbox') el.checked = !!value;
  else el.value = value;
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
  const fname = (draft.fields['ci-fname'] || '').trim();
  const lname = (draft.fields['ci-lname'] || '').trim();
  if (fname && lname) job.name = `${fname} ${lname.charAt(0).toUpperCase()}.`;
  else if (fname) job.name = fname;
  else if (lname) job.name = `${lname.charAt(0).toUpperCase()}.`;

  const addr = (draft.fields['ci-addr'] || '').trim();
  if (addr) job.addr = addr;

  job.pkg = draft.pkg;

  const proptype = draft.fields['ci-proptype'];
  const propage = draft.fields['ci-propage'];
  const ownerLabel = draft.owner === 'yes' ? 'Owner–present' : 'Owner–away';
  const parts = [proptype, propage, ownerLabel].filter(p => p && p !== 'Please select');
  if (parts.length) job.meta = parts.join(' · ');

  const contact = (draft.fields['ci-contact'] || '').trim();
  if (contact && draft.owner !== 'yes') job.contact = contact;
  else delete job.contact;

  const started = Object.values(draft.stepsDone).some(Boolean);
  if (started && job.status === 'new') job.status = 'in_progress';
}

function saveActiveJobState() {
  if (!S.activeJob) return;
  const draft = getJobDraft(S.activeJob);

  draft.pkg = S.pkg;
  draft.stepsDone = { ...S.stepsDone };
  draft.payMethod = S.payMethod;
  draft.rating = S.rating;
  draft.scoreVal = S.scoreVal;
  draft.scoreTapFilter = S.scoreTapFilter;
  draft.scoreBaseReadings = S.scoreBaseReadings ? { ...S.scoreBaseReadings } : null;
  draft.paymentSlipPhoto = S.paymentSlipPhoto;
  draft.paymentSlipSource = S.paymentSlipSource;
  draft.taps = [...(S.taps || DEFAULT_TAPS)];
  draft.activeTap = S.activeTap || 0;
  draft.tapData = JSON.parse(JSON.stringify(S.tapData || []));

  draft.fields = {};
  JOB_FIELD_IDS.forEach(id => {
    const v = readField(id);
    if (v !== undefined) draft.fields[id] = v;
  });

  const owner = document.querySelector('#owner-radios input:checked');
  draft.owner = owner?.value || 'yes';
  draft.msMembers = readMsValues('ms-members');
  draft.msConcerns = readMsValues('ms-concerns');

  syncJobMetaFromDraft(S.activeJob, draft);
  persistJobs();
}

function restoreSlipPreview() {
  const card = document.getElementById('slip-upload-card');
  const sub = document.getElementById('slip-sub');
  const preview = document.getElementById('slip-preview');
  if (!preview) return;

  if (S.paymentSlipPhoto) {
    if (typeof setPhotoPreview === 'function') setPhotoPreview('slip-preview', S.paymentSlipPhoto);
    if (sub) sub.textContent = S.paymentSlipSource || 'Slip attached';
    return;
  }

  preview.removeAttribute('src');
  preview.style.display = 'none';
  card?.classList.remove('has-photo');
  card?.querySelector('.slip-cam-icon')?.classList.remove('hidden');
  if (sub && !S.paymentSlipPhoto) sub.textContent = typeof t === 'function' ? t('pay.uploadSub') : 'Photo of transfer confirmation or cash receipt';
}

function loadJobState(job) {
  const draft = getJobDraft(job);

  S.pkg = draft.pkg;
  S.stepsDone = { ...draft.stepsDone };
  S.payMethod = draft.payMethod || 'cash';
  S.rating = draft.rating ?? 3;
  S.scoreVal = draft.scoreVal;
  S.scoreTapFilter = draft.scoreTapFilter || 'all';
  S.scoreBaseReadings = draft.scoreBaseReadings ? { ...draft.scoreBaseReadings } : null;
  S.paymentSlipPhoto = draft.paymentSlipPhoto;
  S.paymentSlipSource = draft.paymentSlipSource;
  S.taps = draft.taps?.length ? [...draft.taps] : [...DEFAULT_TAPS];
  S.activeTap = draft.activeTap || 0;
  S.tapData = draft.tapData?.length
    ? JSON.parse(JSON.stringify(draft.tapData))
    : S.taps.map(() => ({ tasks: {}, photos: {} }));

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

  if (typeof selPkg === 'function') selPkg(S.pkg);
  if (typeof updatePreassessBtn === 'function') updatePreassessBtn();
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

function loadJobsFromStorage() {
  try {
    const raw = localStorage.getItem('wm-jobs');
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved) || !saved.length) return false;
    JOBS.splice(0, JOBS.length, ...saved);
    return true;
  } catch {
    return false;
  }
}

function ensureJobDraft(job) {
  getJobDraft(job);
}
