/**
 * Cal.com BOOKING_CREATED adapter — durable dedupe forensic coverage gap closure.
 * Proves the REAL adapter logic (processBookingCreated, unmodified) using an
 * injected in-memory Case store + createCase spy via the DI seam added in
 * cal-booking-adapter.js (setCalBookingAdapterDependencies). No production
 * Notion record, no real Case, no live Cal.com webhook involved.
 * Run: node tests/cal/booking-adapter-duplicate.test.js
 */
'use strict';
const assert = require('assert');
const {
  processBookingCreated,
  setCalBookingAdapterDependencies,
  resetCalBookingAdapterDependencies
} = require('../../services/cal-booking-adapter');
const { verifyCalSignature } = require('../../services/cal-webhook');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok  ${name}`); }
function fail(name, detail) { failed += 1; console.error(`  FAIL  ${name}: ${detail}`); }

function bookingPayload(uid, overrides = {}) {
  return {
    triggerEvent: 'BOOKING_CREATED',
    payload: {
      uid,
      attendees: [{ name: 'Test Attendee', email: 't@example.com' }],
      startTime: '2026-09-01T03:00:00.000Z',
      endTime: '2026-09-01T04:00:00.000Z',
      eventTypeId: 1,
      ...overrides
    }
  };
}

/** In-memory Case store standing in for Notion — durable within this test only. */
function makeMemoryCaseStore() {
  const byBookingId = new Map();
  let createCaseCalls = 0;
  const findClientByCalBookingId = async (calBookingId) => byBookingId.get(calBookingId) || null;
  const createCase = async (customerPayload) => {
    createCaseCalls += 1;
    const notionId = `mem-notion-${createCaseCalls}`;
    const job = { notionId, id: notionId, name: customerPayload.fullName, calBookingId: customerPayload.calBookingId };
    byBookingId.set(customerPayload.calBookingId, job);
    return { case: job };
  };
  return {
    findClientByCalBookingId,
    createCase,
    getCreateCaseCallCount: () => createCaseCalls,
    getCaseCount: () => byBookingId.size
  };
}

async function testA() {
  const store = makeMemoryCaseStore();
  setCalBookingAdapterDependencies({
    findClientByCalBookingId: store.findClientByCalBookingId,
    createCase: store.createCase
  });
  try {
    const result = await processBookingCreated(bookingPayload('uid-A'), 'cid-A');
    assert.strictEqual(result.idempotent, false, 'first delivery must not be idempotent');
    assert.strictEqual(store.getCreateCaseCallCount(), 1, 'createCase called exactly once');
    assert.strictEqual(store.getCaseCount(), 1, 'exactly one Case exists');
    ok('Test A: first delivery (uid-A) creates exactly one Case, createCase called once');
  } catch (e) {
    fail('Test A', e.message);
  } finally {
    resetCalBookingAdapterDependencies();
  }
}

async function testB() {
  const store = makeMemoryCaseStore();
  setCalBookingAdapterDependencies({
    findClientByCalBookingId: store.findClientByCalBookingId,
    createCase: store.createCase
  });
  try {
    const first = await processBookingCreated(bookingPayload('uid-B'), 'cid-B1');
    const second = await processBookingCreated(bookingPayload('uid-B'), 'cid-B2');
    assert.strictEqual(second.idempotent, true, 'second identical-uid delivery must be idempotent');
    assert.strictEqual(second.case.notionId, first.case.notionId, 'second delivery returns the SAME Case, not a new one');
    assert.strictEqual(store.getCreateCaseCallCount(), 1, 'createCase must NOT be called a second time');
    assert.strictEqual(store.getCaseCount(), 1, 'still exactly one Case exists after the duplicate delivery');
    ok('Test B: second identical delivery (uid-B) is idempotent, createCase NOT called again');
  } catch (e) {
    fail('Test B', e.message);
  } finally {
    resetCalBookingAdapterDependencies();
  }
}

async function testC() {
  const store = makeMemoryCaseStore();
  setCalBookingAdapterDependencies({
    findClientByCalBookingId: store.findClientByCalBookingId,
    createCase: store.createCase
  });
  try {
    // Fire 5 "concurrent" deliveries for the SAME booking uid without awaiting
    // between them — this is exactly the race withCaseLock exists to prevent
    // (two webhook retries/duplicate deliveries landing near-simultaneously).
    const deliveries = Array.from({ length: 5 }, (_, i) =>
      processBookingCreated(bookingPayload('uid-C'), `cid-C${i}`));
    const results = await Promise.all(deliveries);
    assert.strictEqual(store.getCreateCaseCallCount(), 1, 'exactly one createCase call across 5 concurrent identical deliveries');
    assert.strictEqual(store.getCaseCount(), 1, 'exactly one Case exists after concurrent duplicate deliveries');
    const idempotentCount = results.filter(r => r.idempotent).length;
    assert.strictEqual(idempotentCount, 4, '4 of the 5 concurrent deliveries must resolve as idempotent (only the first creates)');
    const notionIds = new Set(results.map(r => r.case.notionId));
    assert.strictEqual(notionIds.size, 1, 'all 5 concurrent deliveries resolve to the SAME Case identity');
    ok('Test C: 5 concurrent identical deliveries (uid-C) -> exactly 1 Case, withCaseLock serializes correctly');
  } catch (e) {
    fail('Test C', e.message);
  } finally {
    resetCalBookingAdapterDependencies();
  }
}

async function testD() {
  const store = makeMemoryCaseStore();
  setCalBookingAdapterDependencies({
    findClientByCalBookingId: store.findClientByCalBookingId,
    createCase: store.createCase
  });
  try {
    await processBookingCreated(bookingPayload('uid-X'), 'cid-X');
    await processBookingCreated(bookingPayload('uid-Y'), 'cid-Y');
    assert.strictEqual(store.getCreateCaseCallCount(), 2, 'two DIFFERENT booking uids create two separate createCase calls');
    assert.strictEqual(store.getCaseCount(), 2, 'two distinct Cases exist for two distinct booking uids');
    ok('Test D: different booking uid (uid-Y) creates a separate Case from uid-X, no cross-suppression');
  } catch (e) {
    fail('Test D', e.message);
  } finally {
    resetCalBookingAdapterDependencies();
  }
}

async function testE() {
  const store = makeMemoryCaseStore();
  setCalBookingAdapterDependencies({
    findClientByCalBookingId: store.findClientByCalBookingId,
    createCase: store.createCase
  });
  try {
    // E1: malformed — missing uid entirely. Caller (api/cal-routes.js) is
    // responsible for signature verification before this is ever invoked, so
    // this proves the adapter's OWN input-validation gate, independent of
    // the HTTP-layer signature check proven separately in E2 below.
    await assert.rejects(
      () => processBookingCreated({ triggerEvent: 'BOOKING_CREATED', payload: {
        attendees: [{ name: 'X' }], startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T01:00:00Z'
      } }, 'cid-E1'),
      /Missing Cal booking identifier/,
      'missing uid must reject'
    );
    assert.strictEqual(store.getCreateCaseCallCount(), 0, 'malformed event must not call createCase');
    assert.strictEqual(store.getCaseCount(), 0, 'malformed event must not create any Case (no mutation)');
    ok('Test E1: malformed event (missing uid) rejected before createCase, zero mutation');

    // E2: invalid signature — proves the real HMAC verification used by the
    // route handler (services/cal-webhook.js), independent of the adapter.
    const secret = 'e2e-test-secret';
    const body = Buffer.from(JSON.stringify(bookingPayload('uid-E2')), 'utf8');
    const crypto = require('crypto');
    const validSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    process.env.CAL_WEBHOOK_SECRET = secret;
    assert.strictEqual(verifyCalSignature(body, 'not-the-real-signature'), false, 'invalid signature must be rejected');
    assert.strictEqual(verifyCalSignature(body, validSig), true, 'valid signature for the same body must be accepted (sanity check)');
    process.env.CAL_WEBHOOK_SECRET = '';
    ok('Test E2: invalid Cal.com signature rejected by verifyCalSignature (real HMAC-SHA256), valid one accepted as control');
  } catch (e) {
    fail('Test E', e.message);
  } finally {
    resetCalBookingAdapterDependencies();
  }
}

async function main() {
  await testA();
  await testB();
  await testC();
  await testD();
  await testE();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
