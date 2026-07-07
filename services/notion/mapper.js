const { getPropertyValue } = require('./props');

const FIELD_ALIASES = {
  fullName: ['Full Name', 'Name', 'Client Name', 'fullName'],
  address: ['Address', 'address', 'Property Address'],
  phone: ['Phone', 'phone', 'Mobile'],
  email: ['Email', 'email'],
  lineId: ['LINE ID', 'LINE', 'Line ID', 'lineId'],
  consentSigned: ['Consent Signed', 'Consent', 'consentSigned'],
  packageHistory: ['Package History', 'Package', 'packageHistory'],
  propertyType: ['Property Type', 'propertyType'],
  propertyAge: ['Property Age (yr)', 'Property Age', 'propertyAge'],
  source: ['Source', 'source'],
  currentFilter: ['Current Filter', 'currentFilter'],
  waterConcerns: ['Water Concerns', 'waterConcerns'],
  stage: ['Stage', 'stage'],
  status: ['Status', 'status'],
  appointmentDate: ['Appointment Date', 'Next Follow-up', 'Scheduled Date', 'appointmentDate'],
  createdDate: ['Created', 'Created 1', 'created_time'],
  appointmentStart: ['Appointment Start', 'Time Start', 'Start Time', 'appointmentStart'],
  appointmentEnd: ['Appointment End', 'Time End', 'End Time', 'appointmentEnd']
};

function splitClientName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { fname: '', lname: '' };
  return { fname: parts[0], lname: parts.slice(1).join(' ') };
}

function mapPackage(value) {
  const text = String(value || '').toLowerCase();
  return text.includes('premium') || text.includes('full') ? 'full' : 'essential';
}

function mapPropertyType(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('condo') || text.includes('คอนโด')) return 'Condominium';
  if (text.includes('town')) return 'Townhome';
  if (text.includes('apartment')) return 'Apartment';
  if (text.includes('twin')) return 'Twin House';
  return 'Single House';
}

function mapPropertyAge(value) {
  const years = parseInt(value, 10);
  if (Number.isNaN(years)) {
    const text = String(value || '').toLowerCase();
    if (text.includes('0-5')) return '0-5 yrs';
    if (text.includes('5-10')) return '5-10 yrs';
    if (text.includes('10-20')) return '10-20 yrs';
    if (text.includes('20')) return '20+ yrs';
    return 'Not sure';
  }
  if (years <= 5) return '0-5 yrs';
  if (years <= 10) return '5-10 yrs';
  if (years <= 20) return '10-20 yrs';
  return '20+ yrs';
}

function mapFilter(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('loyal') || text.includes('vip') || text.includes('premium')) return 'Whole-house filter';
  if (text.includes('lead') || text.includes('follow')) return 'Not sure';
  if (text.includes('ro')) return 'RO system';
  if (text.includes('whole')) return 'Whole-house filter';
  if (text.includes('drinking')) return 'Drinking water filter';
  return 'None';
}

function mapJobStatus(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'active' || text === 'in_progress' || text === 'in progress') return 'in_progress';
  if (text === 'done' || text === 'completed') return 'done';
  if (text === 'cancelled' || text === 'canceled') return 'cancelled';
  if (text === 'overdue') return 'overdue';
  return 'new';
}

function formatTimeLabel(value, fallback) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (/^\d{1,2}:\d{2}$/.test(text)) {
    const [hour, minute] = text.split(':').map(Number);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return minute ? `${hour12}:${String(minute).padStart(2, '0')}${suffix}` : `${hour12}:00${suffix}`;
  }
  return text;
}

function scheduleFromIndex(index) {
  const day = index % 7;
  const slot = Math.floor(index / 7);
  const hour = Math.min(17, 9 + slot);
  return {
    day,
    timeStart: `${String(hour).padStart(2, '0')}:00`,
    timeEnd: `${String(Math.min(18, hour + 1)).padStart(2, '0')}:00`
  };
}

function scheduleFromDate(dateValue, index) {
  const fallback = scheduleFromIndex(index);
  if (!dateValue) return fallback;

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return fallback;

  const jsDay = date.getDay();
  const day = jsDay === 0 ? 6 : jsDay - 1;
  return { day, timeStart: fallback.timeStart, timeEnd: fallback.timeEnd };
}

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
    taps: ['Kitchen', 'Master bath', 'Shower', 'Laundry', 'Guest'],
    activeTap: 0,
    tapData: ['Kitchen', 'Master bath', 'Shower', 'Laundry', 'Guest'].map(() => ({ tasks: {}, photos: {} })),
    owner: 'yes',
    msMembers: [],
    msConcerns: [],
    fields: {}
  };
}

function notionPageToJob(page, index) {
  const properties = page.properties || {};
  const fullName = getPropertyValue(properties, FIELD_ALIASES.fullName);
  const { fname, lname } = splitClientName(fullName);
  const address = getPropertyValue(properties, FIELD_ALIASES.address);
  const pkg = mapPackage(getPropertyValue(properties, FIELD_ALIASES.packageHistory));
  const propertyType = mapPropertyType(getPropertyValue(properties, FIELD_ALIASES.propertyType));
  const propertyAge = mapPropertyAge(getPropertyValue(properties, FIELD_ALIASES.propertyAge));
  const source = getPropertyValue(properties, FIELD_ALIASES.source);
  const stage = getPropertyValue(properties, FIELD_ALIASES.stage);
  const status = mapJobStatus(getPropertyValue(properties, FIELD_ALIASES.status));
  const concern = getPropertyValue(properties, FIELD_ALIASES.waterConcerns);
  const appointmentDate = getPropertyValue(properties, FIELD_ALIASES.appointmentDate);
  const createdDate = getPropertyValue(properties, FIELD_ALIASES.createdDate, page.created_time);
  const schedule = scheduleFromDate(appointmentDate || createdDate, index);
  const timeStart = formatTimeLabel(
    getPropertyValue(properties, FIELD_ALIASES.appointmentStart),
    schedule.timeStart
  );
  const timeEnd = formatTimeLabel(
    getPropertyValue(properties, FIELD_ALIASES.appointmentEnd),
    schedule.timeEnd
  );

  const job = {
    id: 1000 + index + 1,
    notionId: page.id,
    name: lname ? `${fname} ${lname.charAt(0).toUpperCase()}.` : fname || `Client ${index + 1}`,
    addr: address || 'Address to confirm',
    timeStart,
    timeEnd,
    day: schedule.day,
    pkg,
    status,
    meta: [propertyType, propertyAge, stage || 'Notion'].filter(Boolean).join(' - '),
    notionSource: true
  };

  job.draft = defaultJobDraft(job);
  job.draft.fields = {
    'ci-fname': fname,
    'ci-lname': lname,
    'ci-phone': String(getPropertyValue(properties, FIELD_ALIASES.phone) || ''),
    'ci-line': getPropertyValue(properties, FIELD_ALIASES.lineId),
    'ci-email': getPropertyValue(properties, FIELD_ALIASES.email),
    'ci-city': 'Bangkok',
    'ci-postal': '',
    'ci-addr': address,
    'ci-proptype': propertyType,
    'ci-propage': propertyAge,
    'ci-filter': mapFilter(getPropertyValue(properties, FIELD_ALIASES.currentFilter)),
    'ci-source': source,
    'ci-consent': Boolean(getPropertyValue(properties, FIELD_ALIASES.consentSigned, false))
  };
  job.draft.msConcerns = concern ? [concern] : [];
  job.draft.pkg = pkg;

  return job;
}

module.exports = {
  FIELD_ALIASES,
  notionPageToJob,
  splitClientName,
  mapPackage,
  mapPropertyType,
  mapPropertyAge,
  mapFilter,
  mapJobStatus
};
