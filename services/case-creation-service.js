const { createClient, updateClient, getAllClients } = require('./notion/clients');
const { generateFeedbackToken, generateReportToken } = require('./case-tokens');

const DEFAULT_REVIEW_URL = process.env.GOOGLE_REVIEW_URL || 'https://g.page/r/Ce0EFhVtUyRpEBM/review';

const CUSTOMER_INPUT_FIELDS = Object.freeze([
  'fullName',
  'address',
  'phone',
  'email',
  'lineId',
  'waterConcerns',
  'propertyType',
  'propertyAge',
  'source',
  'currentFilter',
  'packageHistory',
  'consentSigned',
  'appointmentDate',
  'appointmentStart',
  'appointmentEnd'
]);

const SYSTEM_GENERATED_FIELDS = Object.freeze([
  'feedbackToken',
  'publicReportToken',
  'reportUrl',
  'feedbackUrl',
  'lineLinked',
  'lineUserId',
  'lineDisplayName',
  'lineLinkedAt',
  'caseWorkflowStatus',
  'notificationStatus',
  'resultSentAt',
  'lineMessageId',
  'lastNotificationError',
  'feedbackStatus',
  'reviewStatus',
  'reviewUrl'
]);

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://serviceportal.onrender.com').replace(/\/$/, '');
}

function pickCustomerInput(payload = {}) {
  const input = {};
  CUSTOMER_INPUT_FIELDS.forEach((key) => {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') {
      input[key] = payload[key];
    }
  });
  return input;
}

function buildSystemDefaults({ feedbackToken, reportToken, reviewUrl = DEFAULT_REVIEW_URL } = {}) {
  const base = publicBaseUrl();
  return {
    feedbackToken,
    publicReportToken: reportToken,
    reportUrl: `${base}/r/${reportToken}`,
    feedbackUrl: `${base}/f/${feedbackToken}`,
    lineLinked: false,
    caseWorkflowStatus: 'scheduled',
    notificationStatus: 'not_sent',
    feedbackStatus: 'not_sent',
    reviewStatus: 'not_requested',
    reviewUrl,
    status: 'scheduled'
  };
}

function mapPreassessmentPayload(body = {}) {
  const fields = body.fields && typeof body.fields === 'object' ? body.fields : body;
  const fname = String(fields['ci-fname'] || fields.fname || '').trim();
  const lname = String(fields['ci-lname'] || fields.lname || '').trim();
  const city = String(fields['ci-city'] || fields.city || '').trim();
  const postal = String(fields['ci-postal'] || fields.postal || '').trim();
  const addr = String(fields['ci-addr'] || fields.address || '').trim();
  const addressParts = [addr, city, postal].filter(Boolean);

  const concerns = Array.isArray(body.msConcerns)
    ? body.msConcerns
    : Array.isArray(fields.msConcerns)
      ? fields.msConcerns
      : [];
  const concernText = concerns.length
    ? concerns.join(', ')
    : String(fields.waterConcerns || fields['ci-concerns'] || '').trim();

  return pickCustomerInput({
    fullName: [fname, lname].filter(Boolean).join(' ') || String(body.fullName || '').trim(),
    address: addressParts.join(', '),
    phone: fields['ci-phone'] || fields.phone || '',
    email: fields['ci-email'] || fields.email || '',
    lineId: fields['ci-line'] || fields.lineId || '',
    waterConcerns: concernText,
    propertyType: fields['ci-proptype'] || fields.propertyType || '',
    propertyAge: fields['ci-propage'] || fields.propertyAge || '',
    source: fields['ci-source'] || fields.source || '',
    currentFilter: fields['ci-filter'] || fields.currentFilter || '',
    packageHistory: body.package || body.pkg || fields.package || '',
    consentSigned: Boolean(fields['ci-consent'] || body.consentSigned),
    appointmentDate: body.appointmentDate || fields.appointmentDate || '',
    appointmentStart: body.appointmentStart || fields.appointmentStart || '',
    appointmentEnd: body.appointmentEnd || fields.appointmentEnd || ''
  });
}

async function resolveCreatedJob(notionId) {
  const jobs = await getAllClients();
  return jobs.find(job => job.notionId === notionId) || null;
}

async function createCase(customerPayload = {}, options = {}) {
  const customer = options.skipMap ? pickCustomerInput(customerPayload) : mapPreassessmentPayload(customerPayload);
  if (!customer.fullName) {
    const error = new Error('Full Name is required');
    error.statusCode = 400;
    throw error;
  }

  const feedbackToken = await generateFeedbackToken();
  const reportToken = await generateReportToken();
  const notionPayload = {
    ...customer,
    ...buildSystemDefaults({ feedbackToken, reportToken, reviewUrl: options.reviewUrl })
  };

  const created = await createClient(notionPayload);
  const job = await resolveCreatedJob(created.notionId) || created;

  return {
    ok: true,
    case: job,
    tokens: {
      feedbackToken,
      reportToken,
      reportUrl: notionPayload.reportUrl,
      feedbackUrl: notionPayload.feedbackUrl
    },
    systemDefaults: buildSystemDefaults({ feedbackToken, reportToken })
  };
}

async function submitCustomerPreassessment(caseId, customerPayload = {}) {
  const { resolveJob } = require('./workflow-service');
  const job = await resolveJob(caseId);
  if (!job?.notionId) {
    const error = new Error('Case not found');
    error.statusCode = 404;
    throw error;
  }

  const customer = mapPreassessmentPayload(customerPayload);
  if (!customer.fullName) {
    const error = new Error('Full Name is required');
    error.statusCode = 400;
    throw error;
  }

  const updated = await updateClient(job.notionId, {
    ...customer,
    consentSigned: customer.consentSigned
  });
  const resolved = await resolveCreatedJob(updated.notionId) || updated;

  return {
    ok: true,
    case: resolved,
    updatedFields: Object.keys(customer)
  };
}

async function createTestCase(overrides = {}) {
  const suffix = String(Date.now()).slice(-4);
  return createCase({
    fullName: overrides.fullName || `Test Customer ${suffix}`,
    address: overrides.address || '123 Test Street, Bangkok 10110',
    phone: overrides.phone || '0812345678',
    email: overrides.email || `test${suffix}@watermotion.example`,
    lineId: overrides.lineId || '',
    propertyType: overrides.propertyType || 'Condominium',
    propertyAge: overrides.propertyAge || '0-5 yrs',
    waterConcerns: overrides.waterConcerns || 'general water quality',
    source: overrides.source || 'LINE',
    currentFilter: overrides.currentFilter || 'None',
    consentSigned: true,
    ...overrides
  }, { skipMap: true, reviewUrl: overrides.reviewUrl });
}

module.exports = {
  CUSTOMER_INPUT_FIELDS,
  SYSTEM_GENERATED_FIELDS,
  mapPreassessmentPayload,
  buildSystemDefaults,
  createCase,
  submitCustomerPreassessment,
  createTestCase
};
