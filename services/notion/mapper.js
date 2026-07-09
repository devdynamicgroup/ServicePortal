const { getPropertyValue } = require('./props');

const FIELD_ALIASES = {
  fullName: ['Full Name', 'Name', 'Client Name', 'fullName'],
  address: ['Address', 'address', 'Property Address'],
  phone: ['Phone', 'phone', 'Mobile'],
  email: ['Email', 'email'],
  lineId: ['LINE ID', 'LINE', 'Line ID', 'lineId'],
  lineDisplayName: ['LINE Display Name', 'Line Display Name', 'LINE Name', 'lineDisplayName'],
  lineUserId: ['LINE User ID', 'Line User ID', 'LINE UID', 'lineUserId'],
  lineLinked: ['LINE Linked', 'Line Linked', 'lineLinked'],
  lineLinkedAt: ['LINE Linked At', 'Line Linked At', 'lineLinkedAt'],
  consentSigned: ['Consent Signed', 'Consent', 'consentSigned'],
  packageHistory: ['Package History', 'Package', 'packageHistory'],
  propertyType: ['Property Type', 'propertyType'],
  propertyAge: ['Property Age (yr)', 'Property Age', 'propertyAge'],
  source: ['Source', 'source'],
  currentFilter: ['Current Filter', 'currentFilter'],
  waterConcerns: ['Water Concerns', 'waterConcerns'],
  stage: ['Stage', 'stage'],
  status: ['Status', 'status'],
  caseWorkflowStatus: ['Case Workflow Status', 'Workflow Status', 'Case Status', 'caseWorkflowStatus'],
  serviceStartedAt: ['Service Started At', 'serviceStartedAt'],
  serviceCompletedAt: ['Service Completed At', 'serviceCompletedAt'],
  closedAt: ['Closed At', 'closedAt'],
  completedBy: ['Completed By', 'completedBy'],
  latestWaterScore: ['Latest Water Score', 'Water Score', 'latestWaterScore'],
  resultSummary: ['Result Summary', 'resultSummary'],
  recommendations: ['Recommendations', 'recommendations'],
  reportUrl: ['Report URL', 'Report Url', 'reportUrl'],
  publicReportToken: ['Public Report Token', 'Report Token', 'publicReportToken'],
  feedbackToken: ['Feedback Token', 'feedbackToken'],
  feedbackUrl: ['Feedback URL', 'Feedback Url', 'feedbackUrl'],
  feedbackStatus: ['Feedback Status', 'feedbackStatus'],
  feedbackRating: ['Feedback Rating', 'feedbackRating'],
  feedbackComment: ['Feedback Comment', 'feedbackComment'],
  feedbackSubmittedAt: ['Feedback Submitted At', 'feedbackSubmittedAt'],
  reviewUrl: ['Review URL', 'Google Review URL', 'reviewUrl'],
  reviewRequestedAt: ['Review Requested At', 'reviewRequestedAt'],
  reviewStatus: ['Review Status', 'reviewStatus'],
  resultSentAt: ['Result Sent At', 'resultSentAt'],
  notificationStatus: ['Notification Status', 'notificationStatus'],
  lineMessageId: ['LINE Message ID', 'Line Message ID', 'lineMessageId'],
  lastNotificationError: ['Last Notification Error', 'lastNotificationError'],
  // Appointment date priority: the team's custom "Created 1" field is the real
  // appointment date and must win. "Created" (Notion's auto created_time) is
  // intentionally NOT listed here so it can never be used as the appointment.
  appointmentDate: ['Created 1', 'Next Follow-up', 'Appointment Date', 'Scheduled Date', 'appointmentDate'],
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

// Business status (Active/Pending/Lead/...) is NOT the same as the workflow
// state. `in_progress` is a workflow state set only when a specialist opens a
// job, so we never derive it from the Notion status here.
function mapJobStatus(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'done' || text === 'completed') return 'done';
  if (text === 'cancelled' || text === 'canceled') return 'cancelled';
  if (text === 'overdue') return 'overdue';
  return 'new';
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value || '').trim().toLowerCase();
  return ['true', 'yes', 'y', '1', 'linked'].includes(text);
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

// Extract Y-M-D from a Notion date string ('2026-07-09' or full ISO) without
// letting the host timezone shift the calendar day.
function isoDateOnly(value) {
  const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

// Monday=0 ... Sunday=6, computed in UTC so it never drifts by timezone.
function weekdayIndex(isoDate) {
  if (!isoDate) return null;
  const [y, mo, d] = isoDate.split('-').map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(utc.getTime())) return null;
  const jsDay = utc.getUTCDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

function scheduleFromDate(dateValue, index) {
  const fallback = scheduleFromIndex(index);
  const iso = isoDateOnly(dateValue);
  const day = weekdayIndex(iso);
  if (day === null) return { ...fallback, date: '' };
  return { day, timeStart: fallback.timeStart, timeEnd: fallback.timeEnd, date: iso };
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
  const rawStatus = getPropertyValue(properties, FIELD_ALIASES.status);
  const status = mapJobStatus(rawStatus);
  const concern = getPropertyValue(properties, FIELD_ALIASES.waterConcerns);
  const lineDisplayName = getPropertyValue(properties, FIELD_ALIASES.lineDisplayName)
    || getPropertyValue(properties, FIELD_ALIASES.lineId);
  const lineUserId = getPropertyValue(properties, FIELD_ALIASES.lineUserId);
  const workflowStatus = getPropertyValue(properties, FIELD_ALIASES.caseWorkflowStatus) || status;
  const latestWaterScore = asNumber(getPropertyValue(properties, FIELD_ALIASES.latestWaterScore));
  const created1 = getPropertyValue(properties, ['Created 1'], null);
  // finalDate follows the appointment-date priority (Created 1 first). We never
  // fall back to Notion's created_time, so an unscheduled client stays null.
  const appointmentDate = getPropertyValue(properties, FIELD_ALIASES.appointmentDate, null);
  const schedule = scheduleFromDate(appointmentDate, index);
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
    date: schedule.date || null,
    createdTime: page.created_time || '',
    pkg,
    status,
    rawStatus: rawStatus || '',
    meta: [propertyType, propertyAge, stage || 'Notion'].filter(Boolean).join(' - '),
    notionSource: true,
    line: {
      displayName: lineDisplayName || '',
      userId: lineUserId || '',
      linked: asBoolean(getPropertyValue(properties, FIELD_ALIASES.lineLinked)) || Boolean(lineUserId),
      linkedAt: getPropertyValue(properties, FIELD_ALIASES.lineLinkedAt) || null,
      pushReady: Boolean(lineUserId)
    },
    workflow: {
      status: workflowStatus,
      serviceStartedAt: getPropertyValue(properties, FIELD_ALIASES.serviceStartedAt) || null,
      serviceCompletedAt: getPropertyValue(properties, FIELD_ALIASES.serviceCompletedAt) || null,
      closedAt: getPropertyValue(properties, FIELD_ALIASES.closedAt) || null,
      completedBy: getPropertyValue(properties, FIELD_ALIASES.completedBy) || ''
    },
    result: {
      waterScore: latestWaterScore,
      summary: getPropertyValue(properties, FIELD_ALIASES.resultSummary) || '',
      recommendations: getPropertyValue(properties, FIELD_ALIASES.recommendations) || '',
      reportUrl: getPropertyValue(properties, FIELD_ALIASES.reportUrl) || '',
      publicReportToken: getPropertyValue(properties, FIELD_ALIASES.publicReportToken) || ''
    },
    feedback: {
      token: getPropertyValue(properties, FIELD_ALIASES.feedbackToken) || '',
      url: getPropertyValue(properties, FIELD_ALIASES.feedbackUrl) || '',
      status: getPropertyValue(properties, FIELD_ALIASES.feedbackStatus) || 'not_sent',
      rating: asNumber(getPropertyValue(properties, FIELD_ALIASES.feedbackRating)),
      comment: getPropertyValue(properties, FIELD_ALIASES.feedbackComment) || '',
      submittedAt: getPropertyValue(properties, FIELD_ALIASES.feedbackSubmittedAt) || null
    },
    review: {
      url: getPropertyValue(properties, FIELD_ALIASES.reviewUrl) || '',
      requestedAt: getPropertyValue(properties, FIELD_ALIASES.reviewRequestedAt) || null,
      status: getPropertyValue(properties, FIELD_ALIASES.reviewStatus) || 'not_requested'
    },
    notification: {
      resultSentAt: getPropertyValue(properties, FIELD_ALIASES.resultSentAt) || null,
      status: getPropertyValue(properties, FIELD_ALIASES.notificationStatus) || 'not_sent',
      lineMessageId: getPropertyValue(properties, FIELD_ALIASES.lineMessageId) || '',
      lastError: getPropertyValue(properties, FIELD_ALIASES.lastNotificationError) || ''
    }
  };

  job.draft = defaultJobDraft(job);
  job.draft.fields = {
    'ci-fname': fname,
    'ci-lname': lname,
    'ci-phone': String(getPropertyValue(properties, FIELD_ALIASES.phone) || ''),
    'ci-line': lineDisplayName,
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

  // Temporary debug: confirm Created 1 is being used as the appointment date.
  if (process.env.NOTION_DEBUG_DATES !== 'off') {
    console.log('[notion:date]', JSON.stringify({ name: job.name, created1, finalDate: job.date }));
  }

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
