/**
 * Regression coverage for the OCR meter-reading stale-context race
 * (2026-10-05): photographing a meter starts an async OCR request; if the
 * operator switches Case and/or Tap before that request resolves, the
 * response used to land on whatever Case/Tap is on screen when it arrives
 * -- writeMeterReadingFields() writes to the global, shared meter-field DOM
 * inputs regardless of which Case they currently represent, and
 * saveActiveJobState() right after it commits those fields into whatever
 * S.activeJob is at that moment, not the Case the photo was actually taken
 * for. Fixed with a stale-context guard in
 * src/js/flows/assessment.js:processMeterSessionOcr() -- the originating
 * job/tap are captured before the OCR await, and the global DOM/save/toast
 * writeback only runs if they are still the ones on screen when the OCR
 * response lands. The originating tap's own in-memory object is always
 * updated regardless (the result is never lost -- only never misapplied).
 *
 * The whole src/js/flows/assessment.js file is run verbatim in a vm
 * context (not just one extracted function) -- processMeterSessionOcr()
 * calls many sibling helpers defined in the same file
 * (getActiveTapRecord, ensureMeterImages, mergeMeterReadings,
 * storeRawAndStandardMeasurements, syncMeterThumbFromSession,
 * writeMeterReadingFields, renderMeterThumbnailRow), so loading the whole
 * file and overriding only the handful of genuinely external identifiers
 * (detectMeterReadingsFromImage, uploadMeterSessionImage,
 * saveActiveJobState, showToast, renderAssessList, calcAndShowScore, t) is
 * the minimal-fixture way to exercise the real function end to end.
 *
 * Run: node scripts/test-meter-ocr-stale-context.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const ROOT = 'D:/Service Portal';
const src = fs.readFileSync(`${ROOT}/src/js/flows/assessment.js`, 'utf8');

assert(src.includes('const originatingJob = S.activeJob;'), 'processMeterSessionOcr() captures originatingJob before the OCR await (test in sync with the fix)');
assert(src.includes('const stillCurrentContext = S.activeJob === originatingJob && S.tapData[S.activeTap] === tap;'), 'stale-context guard compares both Case and Tap identity');

// ---- minimal DOM stub ----
function makeEl() {
  return {
    value: '',
    _classes: new Set(['hidden']),
    style: {},
    classList: {
      add: function (...c) { c.forEach(x => this._classes?.add?.(x)); }.bind({ _classes: new Set() }),
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    innerHTML: ''
  };
}

function buildSandbox() {
  const fieldEls = {};
  const METER_IDS = ['m-ph', 'm-tds', 'm-ec', 'm-temp', 'm-turb', 'm-orp', 'm-do', 'm-do-percent'];
  METER_IDS.forEach(id => { fieldEls[id] = makeEl(); });

  const document = {
    getElementById: (id) => fieldEls[id] || null,
    addEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => makeEl()
  };

  const S = { activeJob: null, activeTap: 0, taps: [], tapData: [], screen: 's-meter' };

  const calls = {
    saveActiveJobState: 0,
    renderAssessList: 0,
    renderMeterThumbnailRow: 0,
    showToastMsgs: [],
    uploadCalls: []
  };

  const sandbox = {
    console,
    document,
    window: {},
    S,
    String, Object, Array, Boolean, Number, Set, Promise, JSON, Math,
    t: (key) => key,
    showToast: (msg) => { calls.showToastMsgs.push(msg); },
    renderAssessList: () => { calls.renderAssessList += 1; },
    calcAndShowScore: () => {},
    saveActiveJobState: () => { calls.saveActiveJobState += 1; },
    // Overridden per-test via sandbox.detectMeterReadingsFromImage / uploadMeterSessionImage below
    fieldEls,
    _calls: calls
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  // Override the genuinely-external identifiers AFTER load (same vm global
  // object, so processMeterSessionOcr's free-variable lookups pick these up).
  sandbox.uploadMeterSessionImage = (tapIndex, imageId, dataUrl) => {
    calls.uploadCalls.push({ tapIndex, imageId });
    return Promise.resolve();
  };

  return { sandbox, document, S, calls, fieldEls };
}

function freshTap() { return { tasks: {}, photos: {}, meterReadings: {} }; }
function freshJob(id) { return { id, notionId: id, draft: { fields: {}, scoreVal: null, scoreBaseReadings: null } }; }

function stageEntry(sandbox, tap, id) {
  const entry = { id, photo: 'data:image/png;base64,AAAA', ocrStatus: 'staged', uploadedAt: new Date().toISOString() };
  tap.meterImages = tap.meterImages || [];
  tap.meterImages.push(entry);
  return entry;
}

(async () => {
  console.log('=== Test 1: Same Case / Same Tap -- OCR applies normally ===');
  {
    const { sandbox, S, calls, fieldEls } = buildSandbox();
    const jobA = freshJob('case-A');
    const tapA = freshTap();
    S.activeJob = jobA;
    S.taps = ['Tap 1'];
    S.tapData = [tapA];
    S.activeTap = 0;
    stageEntry(sandbox, tapA, 'entry-1');

    let resolveOcr;
    sandbox.detectMeterReadingsFromImage = () => new Promise(res => { resolveOcr = res; });

    const resultPromise = sandbox.processMeterSessionOcr('entry-1');
    resolveOcr({ readings: { ph: '7.2' }, rawMeasurement: {}, metadata: {} });
    await resultPromise;

    assert(fieldEls['m-ph'].value === '7.2', 'DOM field m-ph was written with the detected value');
    assert(calls.saveActiveJobState === 1, 'saveActiveJobState() was called once -- unchanged normal behavior');
    assert(calls.uploadCalls.length === 1 && calls.uploadCalls[0].imageId === 'entry-1', 'backup upload still runs normally');
  }

  console.log('\n=== Test 2: Case Switch while OCR in flight -- result must NOT leak into Case B ===');
  {
    const { sandbox, S, calls, fieldEls } = buildSandbox();
    const jobA = freshJob('case-A');
    const tapA = freshTap();
    S.activeJob = jobA;
    S.taps = ['Tap 1'];
    S.tapData = [tapA];
    S.activeTap = 0;
    stageEntry(sandbox, tapA, 'entry-A');

    let resolveOcr;
    sandbox.detectMeterReadingsFromImage = () => new Promise(res => { resolveOcr = res; });

    const resultPromise = sandbox.processMeterSessionOcr('entry-A');

    // Operator switches to Case B before OCR resolves (simulates openJob(B) + loadJobState(B)).
    const jobB = freshJob('case-B');
    const tapB = freshTap();
    S.activeJob = jobB;
    S.taps = ['Tap 1'];
    S.tapData = [tapB];
    S.activeTap = 0;
    fieldEls['m-ph'].value = ''; // simulates loadJobState() having cleared the DOM for B

    resolveOcr({ readings: { ph: '9.9' }, rawMeasurement: {}, metadata: {} });
    await resultPromise;

    assert(fieldEls['m-ph'].value === '', 'Case B\'s on-screen DOM field is unchanged -- Case A\'s stale OCR result never wrote into it');
    assert(calls.saveActiveJobState === 0, 'saveActiveJobState() was NOT called -- Case B\'s draft was never touched by Case A\'s result');
    assert(jobB.draft.fields['ci-line'] === undefined, 'Case B\'s draft object has no trace of the stale write');
    assert(tapA.meterReadings.ph === '9.9', 'Case A\'s own in-memory tap record still correctly received its own OCR result (not lost)');
    assert(calls.uploadCalls.length === 1, 'backup upload still runs regardless of staleness (unchanged normal behavior)');
  }

  console.log('\n=== Test 3: Tap Switch within the same Case -- result stays with the originating Tap ===');
  {
    const { sandbox, S, calls, fieldEls } = buildSandbox();
    const job = freshJob('case-A');
    const tap1 = freshTap();
    const tap2 = freshTap();
    S.activeJob = job;
    S.taps = ['Tap 1', 'Tap 2'];
    S.tapData = [tap1, tap2];
    S.activeTap = 0;
    stageEntry(sandbox, tap1, 'entry-tap1');

    let resolveOcr;
    sandbox.detectMeterReadingsFromImage = () => new Promise(res => { resolveOcr = res; });
    const resultPromise = sandbox.processMeterSessionOcr('entry-tap1');

    S.activeTap = 1; // operator switches to Tap 2, same Case
    fieldEls['m-ph'].value = '';

    resolveOcr({ readings: { ph: '6.5' }, rawMeasurement: {}, metadata: {} });
    await resultPromise;

    assert(tap1.meterReadings.ph === '6.5', 'Tap 1 (originating) received the result');
    assert(tap2.meterReadings.ph === undefined, 'Tap 2 (now on screen) is untouched');
    assert(fieldEls['m-ph'].value === '', 'on-screen DOM field for Tap 2 was not overwritten');
    assert(calls.saveActiveJobState === 0, 'saveActiveJobState() was NOT called for the mismatched tap');
  }

  console.log('\n=== Test 4: Case + Tap Switch together -- target Case/Tap receives nothing ===');
  {
    const { sandbox, S, calls, fieldEls } = buildSandbox();
    const jobA = freshJob('case-A');
    const tapA1 = freshTap();
    S.activeJob = jobA;
    S.taps = ['Tap 1'];
    S.tapData = [tapA1];
    S.activeTap = 0;
    stageEntry(sandbox, tapA1, 'entry-A1');

    let resolveOcr;
    sandbox.detectMeterReadingsFromImage = () => new Promise(res => { resolveOcr = res; });
    const resultPromise = sandbox.processMeterSessionOcr('entry-A1');

    const jobB = freshJob('case-B');
    const tapB2a = freshTap();
    const tapB2b = freshTap();
    S.activeJob = jobB;
    S.taps = ['Tap 1', 'Tap 2'];
    S.tapData = [tapB2a, tapB2b];
    S.activeTap = 1;
    fieldEls['m-ph'].value = '';

    resolveOcr({ readings: { ph: '5.0' }, rawMeasurement: {}, metadata: {} });
    await resultPromise;

    assert(tapB2b.meterReadings.ph === undefined, 'Case B / Tap 2 (on screen) received nothing from Case A');
    assert(fieldEls['m-ph'].value === '', 'DOM unaffected');
    assert(calls.saveActiveJobState === 0, 'no save triggered against Case B');
    assert(tapA1.meterReadings.ph === '5.0', 'Case A\'s own originating tap still holds its own result');
  }

  console.log('\n=== Test 5: Concurrent OCR requests each stay attached to their own Tap ===');
  {
    const { sandbox, S, calls, fieldEls } = buildSandbox();
    const job = freshJob('case-A');
    const tap1 = freshTap();
    const tap2 = freshTap();
    S.activeJob = job;
    S.taps = ['Tap 1', 'Tap 2'];
    S.tapData = [tap1, tap2];
    S.activeTap = 0;
    stageEntry(sandbox, tap1, 'entry-1');

    let resolve1;
    sandbox.detectMeterReadingsFromImage = () => new Promise(res => { resolve1 = res; });
    const p1 = sandbox.processMeterSessionOcr('entry-1');

    S.activeTap = 1;
    stageEntry(sandbox, tap2, 'entry-2');
    let resolve2;
    sandbox.detectMeterReadingsFromImage = () => new Promise(res => { resolve2 = res; });
    const p2 = sandbox.processMeterSessionOcr('entry-2');

    // Resolve out of order: Tap 2's request finishes first, then Tap 1's.
    resolve2({ readings: { ph: '2.2' }, rawMeasurement: {}, metadata: {} });
    await p2;
    resolve1({ readings: { ph: '1.1' }, rawMeasurement: {}, metadata: {} });
    await p1;

    assert(tap1.meterReadings.ph === '1.1', 'Tap 1 kept its own result');
    assert(tap2.meterReadings.ph === '2.2', 'Tap 2 kept its own result');
    assert(fieldEls['m-ph'].value === '2.2', 'DOM reflects Tap 2 (the tap on screen when its own request resolved, which was still current at that moment)');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
