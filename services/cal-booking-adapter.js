/**
 * Phase 4 — Cal.com BOOKING_CREATED Adapter.
 *
 * Scope: BOOKING_CREATED only. Does not handle BOOKING_CANCELLED or
 * BOOKING_RESCHEDULED — those are out of scope by design (future work).
 *
 * Responsibility (closed decisions, not reopened here):
 *  1. Normalize the real Cal.com payload shape (frozen from
 *     docs/CALCOM_G01_RUNTIME_CAPTURE.md — real production evidence, no
 *     guessed field paths).
 *  2. Extract required fields; reject safely if the identity/booking fields
 *     this contract depends on are missing.
 *  3. Map to createCase() input (CAL-G03 mechanism only — see
 *     ./cal-offer-mapping.js).
 *  4. Durable dedupe: look up an existing Case by calBookingId before ever
 *     creating one (CAL-G04 closed design).
 *  5. Lifecycle protection: serialize concurrent deliveries for the same
 *     calBookingId via the existing withCaseLock() primitive (reused, not
 *     reinvented).
 *  6. Call the existing, unmodified createCase() — this file never writes
 *     Notion directly and never owns Case/Offer/Workflow/Notification logic.
 */

const { createCase } = require('./case-creation-service');
const { findClientByCalBookingId } = require('./notion/clients');
const { withCaseLock } = require('./workflow-service');
const { resolveCampaignAttribution } = require('./cal-offer-mapping');
const { logEvent } = require('./observability');

// Test-only DI seam (mirrors score-publication-service.js's
// setPublicationCaseAdapter/resetPublicationDependencies pattern). Defaults to
// the real implementations above — production call sites never override
// these, so runtime behavior is unchanged. Exists solely so the durable
// dedupe (findClientByCalBookingId before createCase) can be proven with an
// in-memory adapter instead of real Notion/production data.
let deps = { createCase, findClientByCalBookingId, withCaseLock };

function setCalBookingAdapterDependencies(overrides = {}) {
  deps = { ...deps, ...overrides };
}

function resetCalBookingAdapterDependencies() {
  deps = { createCase, findClientByCalBookingId, withCaseLock };
}

function rejectPayload(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

/** Shifts an ISO UTC instant by utcOffsetMinutes and reads back Y-M-D / H:M
 * wall-clock components — no timezone library needed since the payload
 * already supplies an explicit numeric offset. */
function toLocalDateTimeParts(isoUtc, utcOffsetMinutes) {
  const instant = new Date(isoUtc);
  if (Number.isNaN(instant.getTime())) return null;
  const offsetMinutes = Number.isFinite(utcOffsetMinutes) ? utcOffsetMinutes : 420; // Asia/Bangkok fallback
  const shifted = new Date(instant.getTime() + offsetMinutes * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  };
}

/**
 * Field paths below are taken verbatim from the real, captured
 * BOOKING_CREATED payload (docs/CALCOM_G01_RUNTIME_CAPTURE.md) — not from
 * public Cal.com documentation and not guessed.
 */
function extractBookingCreatedFields(rawPayload) {
  const inner = rawPayload && typeof rawPayload.payload === 'object' ? rawPayload.payload : {};
  const attendee = Array.isArray(inner.attendees) ? inner.attendees[0] : null;
  const responses = inner.responses && typeof inner.responses === 'object' ? inner.responses : {};

  const calBookingId = String(inner.uid || '').trim();
  const fullName = String(attendee?.name || responses.name?.value || '').trim();
  const email = String(attendee?.email || responses.email?.value || '').trim();
  const phone = String(attendee?.phoneNumber || responses.attendeePhoneNumber?.value || '').trim();
  const lineId = String(responses['Line-ID']?.value || '').trim();

  // "Home address" response is a nested { value, optionValue } shape, not a
  // flat string — confirmed structurally in the CAL-G01 capture.
  const addressRaw = responses.location?.value;
  const address = addressRaw && typeof addressRaw === 'object'
    ? String(addressRaw.optionValue || '').trim()
    : String(addressRaw || '').trim();

  const eventTypeId = Number(inner.eventTypeId);
  const startTime = String(inner.startTime || '').trim();
  const endTime = String(inner.endTime || '').trim();
  const utcOffset = Number(attendee?.utcOffset ?? inner.organizer?.utcOffset);

  return { calBookingId, fullName, email, phone, lineId, address, eventTypeId, startTime, endTime, utcOffset };
}

function buildCreateCaseInput(fields, correlationId) {
  const startParts = toLocalDateTimeParts(fields.startTime, fields.utcOffset);
  const endParts = toLocalDateTimeParts(fields.endTime, fields.utcOffset);
  const attribution = resolveCampaignAttribution(fields.eventTypeId);

  const customerPayload = {
    fullName: fields.fullName,
    email: fields.email || undefined,
    phone: fields.phone || undefined,
    lineId: fields.lineId || undefined,
    address: fields.address || undefined,
    appointmentDate: startParts?.date,
    appointmentStart: startParts?.time,
    appointmentEnd: endParts?.time,
    source: 'cal.com',
    calBookingId: fields.calBookingId
  };

  const options = {
    skipMap: true,
    correlationId,
    launchOffer: attribution.launchOffer === true
  };
  if (attribution.campaignOffer) options.campaignOffer = attribution.campaignOffer;

  return { customerPayload, options };
}

/**
 * Entry point. `rawPayload` is the full parsed webhook JSON body
 * ({ triggerEvent, createdAt, payload }). Caller (api/cal-routes.js) is
 * responsible for signature verification before this is ever invoked.
 */
async function processBookingCreated(rawPayload, correlationId) {
  const fields = extractBookingCreatedFields(rawPayload);

  if (!fields.calBookingId) throw rejectPayload('Missing Cal booking identifier (uid)');
  if (!fields.fullName) throw rejectPayload('Missing attendee name');
  if (!fields.startTime || !fields.endTime) throw rejectPayload('Missing appointment start/end time');

  return deps.withCaseLock(`cal-booking:${fields.calBookingId}`, async () => {
    const existing = await deps.findClientByCalBookingId(fields.calBookingId);
    if (existing) {
      logEvent('info', 'cal_adapter_duplicate', {
        correlationId,
        calBookingId: fields.calBookingId,
        caseId: existing.notionId
      });
      return { ok: true, idempotent: true, case: existing, calBookingId: fields.calBookingId };
    }

    const { customerPayload, options } = buildCreateCaseInput(fields, correlationId);
    const result = await deps.createCase(customerPayload, options);

    logEvent('info', 'cal_adapter_case_created', {
      correlationId,
      calBookingId: fields.calBookingId,
      caseId: result.case.notionId,
      launchOffer: options.launchOffer
    });

    return { ok: true, idempotent: false, case: result.case, calBookingId: fields.calBookingId };
  });
}

module.exports = {
  extractBookingCreatedFields,
  buildCreateCaseInput,
  toLocalDateTimeParts,
  processBookingCreated,
  setCalBookingAdapterDependencies,
  resetCalBookingAdapterDependencies
};
