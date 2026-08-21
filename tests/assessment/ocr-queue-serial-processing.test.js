/**
 * OCR meter-capture serial queue — forensic coverage gap closure.
 * Loads the REAL src/js/flows/assessment.js (unmodified) via vm and drives
 * window.MeterReadingCapture.processPhoto()/_drainMeterOcrQueue() directly,
 * with a controllable fetch mock standing in for the OCR HTTP endpoint.
 *
 * IMPORTANT — corrects an assumption in the QA mission that requested this
 * test: there is no automatic "retry the same failed image" mechanism
 * anywhere in this code. `entry.ocrStatus` is set to 'failed' and never read
 * again by any queue/UI logic (grep-verified: 'ocrStatus' is only ever
 * assigned, never branched on except the 'pending' spinner badge). What
 * DOES exist and is proven here is: (1) strict serial processing — never
 * two images processing concurrently, (2) one image's OCR failure does not
 * block subsequently-queued different images from being processed, and
 * (3) a later image's success is recorded correctly even after an earlier
 * failure. This test proves the REAL behavior rather than an assumed one.
 *
 * Run: node tests/assessment/ocr-queue-serial-processing.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function fakeEl() {
  return {
    value: '', checked: false, style: {}, className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {}, textContent: '', innerHTML: '', tagName: 'DIV', options: [],
    querySelectorAll: () => [], querySelector: () => null,
    removeAttribute() {}, setAttribute() {}, addEventListener() {}, appendChild() {},
    closest() { return null; }, getAttribute() { return null; }
  };
}

const domStub = {
  getElementById: () => fakeEl(),
  addEventListener: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => fakeEl()
};

const sandbox = {
  console,
  window: {},
  document: domStub,
  navigator: { userAgent: 'node' },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  S: { activeJob: { draft: {} }, tapData: [{ tasks: {}, photos: {} }], taps: ['Kitchen'], activeTap: 0, pkg: 'essential', screen: 's-meter' },
  t: (k) => k,
  showToast: () => {},
  saveActiveJobState: () => {}
};
sandbox.window = sandbox;
vm.createContext(sandbox);

// Controllable OCR HTTP boundary. Call sequence maps 1:1 to processMeterSessionOcr
// invocations, in the order the queue actually drains them.
let fetchCallLog = [];
let fetchBehavior = []; // array of 'fail' | 'success', consumed in order
sandbox.fetch = async (url, opts) => {
  fetchCallLog.push({ url });
  const behavior = fetchBehavior.shift() || 'success';
  if (behavior === 'fail') {
    // Simulate a real network/server failure the client-side wraps in an Error.
    throw new Error('simulated OCR transport failure');
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ readings: { ph: '7.29' }, rawMeasurement: {}, metadata: {} })
  };
};

const noisyWarn = console.warn;
console.warn = () => {}; // silence [OCR FLOW] debug noise for readable output
const code = fs.readFileSync(path.join('D:/Service Portal', 'src', 'js', 'flows', 'assessment.js'), 'utf8');
vm.runInContext(code, sandbox, { filename: 'assessment.js' });
console.warn = noisyWarn;

async function main() {
  const capture = sandbox.window.MeterReadingCapture;

  // --- Test 1: two images queued back-to-back (no await between pushes)
  // must never process concurrently -- exactly one fetch in flight at a time.
  let concurrentFetchesObserved = 0;
  let inFlight = 0;
  const originalFetch = sandbox.fetch;
  sandbox.fetch = async (...args) => {
    inFlight += 1;
    if (inFlight > 1) concurrentFetchesObserved += 1;
    try {
      return await originalFetch(...args);
    } finally {
      inFlight -= 1;
    }
  };
  fetchBehavior = ['success', 'success'];
  const p1 = capture.processPhoto('data:image/png;base64,AAAAfirstphoto');
  const p2 = capture.processPhoto('data:image/png;base64,BBBBsecondphoto');
  await Promise.all([p1, p2]);
  check(concurrentFetchesObserved === 0, `no two OCR calls ever ran concurrently (observed ${concurrentFetchesObserved} overlaps)`);
  check(capture._queue.length === 0, 'queue is fully drained after both photos processed');
  check(capture._processing === false, 'processing flag correctly reset to false after drain');

  // --- Test 2: first image's OCR call fails; second (different) image queued
  // right after must still be processed -- one failure must not stall the queue.
  //
  // CORRECTION vs. the QA mission's assumption: detectMeterReadingsFromImage()
  // (assessment.js:709-786) pre-classifies EVERY thrown error into one of two
  // outcomes before it ever reaches processMeterSessionOcr(): (a) a recognized
  // OCR_USER_ERROR_CODES error (ENGINE_UNAVAILABLE/OCR_OFFLINE/OCR_TIMEOUT/
  // OCR_INTERNAL_ERROR/OCR_MISCONFIGURED) is re-thrown and becomes
  // ocrStatus:'unavailable', or (b) anything else is silently absorbed and
  // returned as an empty-readings success shape, becoming ocrStatus:'done'.
  // The catch-all at processMeterSessionOcr:1352 that sets ocrStatus:'failed'
  // is therefore structurally unreachable through this call path with the
  // current detectMeterReadingsFromImage contract -- confirmed by code read,
  // not merely assumed. This test proves the REAL, reachable failure path
  // (OCR_OFFLINE, matching what a genuine fetch() network failure produces
  // in a real browser) rather than the never-reached 'failed' status.
  fetchBehavior = ['fail', 'success'];
  sandbox.fetch = async (...args) => {
    const behavior = fetchBehavior.shift() || 'success';
    if (behavior === 'fail') {
      const err = new TypeError('Failed to fetch');
      throw err;
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: { ph: '7.29' } }) };
  };
  const tap = sandbox.S.tapData[sandbox.S.activeTap];
  tap.meterReadings = {}; // reset from test 1
  const entryBefore = sandbox.stageMeterSessionPhoto('data:image/png;base64,CCCCwillfail');
  const entryOk = sandbox.stageMeterSessionPhoto('data:image/png;base64,DDDDwillsucceed');
  capture._queue.push(entryBefore.id, entryOk.id);
  await capture._drainMeterOcrQueue();

  check(entryBefore.ocrStatus === 'unavailable', `the failing image's entry.ocrStatus is 'unavailable' (real OCR_OFFLINE path), not 'failed' (got '${entryBefore.ocrStatus}')`);
  check(entryOk.ocrStatus === 'done', `the SECOND (different) image still processed successfully despite the first one's OCR-offline failure (got '${entryOk.ocrStatus}')`);
  check(tap.meterReadings.ph === '7.29', 'the successful second image\'s reading (ph=7.29) reached tap.meterReadings, proving the queue continued past the failure');
  check(capture._queue.length === 0, 'queue is empty after processing both entries (offline-failure + success)');

  // --- Test 3 (documents actual behavior, not an assumption): the
  // OCR-unavailable entry is never automatically re-attempted. Draining
  // again with no new items does nothing to entryBefore -- there is no
  // retry-of-same-image path anywhere in this queue.
  const statusBeforeSecondDrain = entryBefore.ocrStatus;
  await capture._drainMeterOcrQueue();
  check(entryBefore.ocrStatus === statusBeforeSecondDrain, 'confirmed: an OCR-unavailable entry is not automatically retried by the queue (status unchanged after a no-op drain) -- this app has no auto-retry-of-same-image feature, only continue-to-next-image. The ocrStatus:"failed" branch (assessment.js:1352) is defensive dead code under the current detectMeterReadingsFromImage contract.');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  process.exit(1);
});
