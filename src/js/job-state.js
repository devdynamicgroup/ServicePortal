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

  if (S.activeJob && String(S.activeJob.id) === String(job.id) && job.status !== 'done') job.status = 'in_progress';
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
        card?.classList.add('has-photo');
      }
    }
    if (sub) sub.textContent = typeof t === 'function' ? t('pay.uploaded') : 'Photo attached';
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
  S.scoreBaseReadings = draft.scoreBaseReadings ? { ...draft.scoreBaseReadings } : null;
  S.paymentSlipPhoto = draft.paymentSlipPhoto;
  S.paymentSlipSource = draft.paymentSlipSource;
  S.taps = draft.taps?.length ? [...draft.taps] : [...DEFAULT_TAPS];
  S.activeTap = draft.activeTap || 0;
  S.tapData = draft.tapData?.length
    ? JSON.parse(JSON.stringify(draft.tapData))
    : S.taps.map(() => ({ tasks: {}, photos: {} }));

  // Normalize abandoned in-flight uploads so previews + retry work after reload.
  if (typeof normalizeInterruptedPhoto === 'function') {
    S.tapData.forEach(tap => {
      if (!tap?.photos) return;
      Object.keys(tap.photos).forEach(key => {
        tap.photos[key] = normalizeInterruptedPhoto(tap.photos[key]);
      });
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

  const job = {
    id,
    name: lname ? `${fname} ${lname.charAt(0).toUpperCase()}.` : fname || `CSV Client ${index + 1}`,
    addr: record.Address || 'Address to confirm',
    timeStart: `${String(hour).padStart(2, '0')}:00`,
    timeEnd: `${String(Math.min(18, hour + 1)).padStart(2, '0')}:00`,
    day,
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

async function loadJobsFromApi() {
  try {
    const response = await fetch('/api/clients', { cache: 'no-store' });
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

    console.info('[Service Portal] GET /api/clients ok', {
      status: response.status,
      count: jobs.length
    });

    // Notion is authoritative: replace (never merge) so CSV rows cannot mix in.
    const locallyInProgress = new Set(
      JOBS
        .filter(job => job.status === 'in_progress')
        .map(job => String(job.id))
    );
    const normalizedJobs = jobs.map(job => {
      if (locallyInProgress.has(String(job.id)) && !['done', 'cancelled'].includes(job.status)) {
        return { ...job, status: 'in_progress' };
      }
      return job;
    });
    JOBS.splice(0, JOBS.length, ...normalizedJobs);
    persistJobs();
    setDataSource('notion', {
      count: jobs.length,
      dates: jobs.map(j => ({ name: j.name, date: j.date || '(none)', day: j.day })).slice(0, 5)
    });
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
