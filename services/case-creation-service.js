const { createClient, updateClient, getAllClients } = require('./notion/clients');
const { generateFeedbackToken, generateReportToken } = require('./case-tokens');
const { isCancelledJob, invalidateOfferCache } = require('./water-check-offer-service');
const { buildReportUrl, buildFeedbackUrl, resolveReviewUrl } = require('./url-builder');
const { validateCustomerInput } = require('./booking-validation');
const { newCorrelationId, logEvent } = require('./observability');
const { dualWriteAfterCaseSuccess } = require('./migration/dual-write');

const DEFAULT_LAUNCH_CAMPAIGN_OFFER = process.env.WATER_CHECK_CAMPAIGN_OFFER || 'Launch Offer 2026';

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
  'appointmentEnd',
  'campaignOffer',
  'calBookingId'
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

function pickCustomerInput(payload = {}) {
  const input = {};
  CUSTOMER_INPUT_FIELDS.forEach((key) => {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') {
      input[key] = payload[key];
    }
  });
  return input;
}

function buildSystemDefaults({ feedbackToken, reportToken, reviewUrl } = {}) {
  return {
    feedbackToken,
    publicReportToken: reportToken,
    reportUrl: buildReportUrl(reportToken),
    feedbackUrl: buildFeedbackUrl(feedbackToken),
    lineLinked: false,
    caseWorkflowStatus: 'scheduled',
    notificationStatus: 'not_sent',
    feedbackStatus: 'not_sent',
    reviewStatus: 'not_requested',
    reviewUrl: resolveReviewUrl(reviewUrl),
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
    appointmentEnd: body.appointmentEnd || fields.appointmentEnd || '',
    campaignOffer: body.campaignOffer || fields.campaignOffer || ''
  });
}

async function resolveCreatedJob(notionId) {
  const jobs = await getAllClients();
  return jobs.find(job => job.notionId === notionId) || null;
}

function resolveCampaignOffer(customer = {}, customerPayload = {}, options = {}) {
  if (customer.campaignOffer) return customer.campaignOffer;
  if (customerPayload.campaignOffer) return customerPayload.campaignOffer;
  if (options.campaignOffer) return options.campaignOffer;
  // Launch-offer booking flow (Framer / free water check) defaults to the
  // active campaign so the public counter can distinguish these cases.
  if (options.launchOffer) return DEFAULT_LAUNCH_CAMPAIGN_OFFER;
  return '';
}

async function createCase(customerPayload = {}, options = {}) {
  const correlationId = options.correlationId || newCorrelationId('booking');
  const customer = options.skipMap
    ? pickCustomerInput(customerPayload)
    : mapPreassessmentPayload(customerPayload);
  validateCustomerInput(customer);

  const campaignOffer = resolveCampaignOffer(customer, customerPayload, options);
  if (campaignOffer) customer.campaignOffer = campaignOffer;

  const feedbackToken = await generateFeedbackToken();
  const reportToken = await generateReportToken();
  const notionPayload = {
    ...customer,
    ...buildSystemDefaults({ feedbackToken, reportToken, reviewUrl: options.reviewUrl })
  };
  if (options.startOnSite) {
    notionPayload.caseWorkflowStatus = 'in_progress';
    notionPayload.serviceStartedAt = customerPayload.serviceStartedAt || new Date().toISOString();
  }

  const created = await createClient(notionPayload);
  const job = await resolveCreatedJob(created.notionId) || created;

  if (campaignOffer) invalidateOfferCache();

  // M8.3: additive Customer dual-write (non-blocking; flags default OFF)
  await dualWriteAfterCaseSuccess({
    job,
    source: 'createCase',
    correlationId,
    identityOverrides: {
      name: customer.fullName || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || ''
    }
  });

  logEvent('info', 'booking_created', {
    correlationId,
    notionId: job.notionId,
    campaignOffer: campaignOffer || null
  });

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
  validateCustomerInput(customer);

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

async function cancelAppointment(caseId) {
  const { resolveJob } = require('./workflow-service');
  const { getDataSourceSchema } = require('./notion/client');
  const { findPropertyKey } = require('./notion/props');
  const { FIELD_ALIASES } = require('./notion/mapper');

  const job = await resolveJob(caseId);
  if (!job?.notionId) {
    const error = new Error('Case not found');
    error.statusCode = 404;
    throw error;
  }

  if (isCancelledJob(job)) {
    return { ok: true, idempotent: true, case: job };
  }

  const now = new Date().toISOString();
  const payload = {
    caseWorkflowStatus: 'cancelled',
    closedAt: now
  };

  // Only write Status when the select already has a cancelled option.
  try {
    const { properties } = await getDataSourceSchema();
    const statusKey = findPropertyKey(properties, FIELD_ALIASES.status);
    const options = properties[statusKey]?.select?.options || [];
    const hasCancelled = options.some(opt =>
      ['cancelled', 'canceled'].includes(String(opt?.name || '').toLowerCase())
    );
    if (hasCancelled) payload.status = 'cancelled';
  } catch (error) {
    console.warn('[cancelAppointment] could not inspect Status options', error.message);
  }

  const updated = await updateClient(job.notionId, payload);

  if (job.campaignOffer) invalidateOfferCache();

  logEvent('info', 'booking_cancelled', {
    correlationId: newCorrelationId('cancel'),
    notionId: job.notionId
  });

  return {
    ok: true,
    case: updated,
    cancelledAt: now
  };
}

module.exports = {
  CUSTOMER_INPUT_FIELDS,
  SYSTEM_GENERATED_FIELDS,
  DEFAULT_LAUNCH_CAMPAIGN_OFFER,
  mapPreassessmentPayload,
  buildSystemDefaults,
  createCase,
  submitCustomerPreassessment,
  createTestCase,
  cancelAppointment
};
