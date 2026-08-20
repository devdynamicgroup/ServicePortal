/**
 * Regression suite for the score runtime data-lineage defects (BUG-01..BUG-08)
 * found in the Independent Score vs Displayed UI QA pass.
 *
 * Loads the REAL browser source files (assessment-snapshot.js, conversion/engine.js,
 * flows/assessment.js, flows/score.js) — assessment.js/score.js via `vm` with minimal
 * DOM stubs, since they are plain (non-module) browser scripts — and exercises the
 * actual functions directly. No reimplementations, no Score-engine/formula changes
 * are exercised or asserted here (arithmetic is out of scope for this suite).
 *
 * Run: node scripts/test-score-lineage-regression.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function loadScriptIntoContext(relPath, extraSandbox = {}) {
  const domStub = {
    getElementById: () => null,
    addEventListener: () => {},
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {} } })
  };
  const sandbox = Object.assign({
    console,
    window: {},
    document: domStub,
    navigator: { userAgent: 'node' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    S: { activeJob: null, tapData: [], taps: [] },
    t: (k) => k
  }, extraSandbox);
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  // Silence the module's own [TEMP TRACE]/debug console.warn noise for readable output.
  const originalWarn = console.warn;
  vm.runInContext(code, sandbox, { filename: path.basename(relPath) });
  return sandbox;
}

const AssessmentSnapshot = require(path.join(__dirname, '..', 'src', 'js', 'assessment-snapshot.js'));
const ConversionEngine = require(path.join(__dirname, '..', 'src', 'js', 'conversion', 'engine.js'));

const asmCtx = loadScriptIntoContext(path.join('src', 'js', 'flows', 'assessment.js'));
asmCtx.ConversionEngine = ConversionEngine;
const scoreCtx = loadScriptIntoContext(path.join('src', 'js', 'flows', 'score.js'));

const noisy = console.warn;
console.warn = () => {}; // mute [TEMP TRACE]/[OCR FLOW] debug logging from assessment.js

console.log('=== BUG-05: whitespace must not coerce to 0 (missing != numeric zero) ===');
assert(AssessmentSnapshot.asMeasurementNumber(' ') === undefined, "asMeasurementNumber(' ') is missing");
assert(AssessmentSnapshot.asMeasurementNumber('  ') === undefined, "asMeasurementNumber('  ') is missing");
assert(AssessmentSnapshot.asMeasurementNumber('') === undefined, "asMeasurementNumber('') is missing");
assert(AssessmentSnapshot.asMeasurementNumber(null) === undefined, "asMeasurementNumber(null) is missing");
assert(AssessmentSnapshot.asMeasurementNumber(undefined) === undefined, "asMeasurementNumber(undefined) is missing");
assert(AssessmentSnapshot.asMeasurementNumber(0) === 0, 'asMeasurementNumber(0) is numeric zero, not dropped');
assert(AssessmentSnapshot.asMeasurementNumber('0') === 0, "asMeasurementNumber('0') is numeric zero");
assert(AssessmentSnapshot.asMeasurementNumber(' 7.2 ') === 7.2, "asMeasurementNumber(' 7.2 ') trims to 7.2");
{
  const out = ConversionEngine.toStandardMeasurement({ ph: ' ', orp: 0 });
  assert(out.standardMeasurement.ph === undefined, 'ConversionEngine: whitespace ph does not become 0');
  assert(out.standardMeasurement.orp === 0, 'ConversionEngine: real zero (orp=0) is preserved, not rejected');
}

console.log('\n=== BUG-01: clearing a field must actually clear it in the same session (no reload) ===');
{
  const tap = { meterReadings: { tds: 80, ph: 7.2 }, tasks: {}, photos: {} };
  const clearedFieldRead = { ph: '7.2', tds: '', ec: '', temp: '', turbidity: '', orp: '', do: '', doPercent: '' };
  const merged = asmCtx.mergeMeterReadings(tap.meterReadings, clearedFieldRead);
  assert(merged.tds == null, `cleared TDS must not remain 80 (got ${JSON.stringify(merged.tds)})`);
  assert(merged.ph === '7.2', 'untouched field (ph) survives the same merge unchanged');
}

console.log('\n=== BUG-02: clear -> persist -> server merge -> reload must not resurrect the old value ===');
{
  const localTap = { meterReadings: { tds: null, ph: 7.2 }, tasks: {}, photos: {} };
  const outgoing = AssessmentSnapshot.buildSnapshot({ taps: ['Tap 1'], tapData: [localTap], revision: 2 });
  const existingOnServer = AssessmentSnapshot.buildSnapshot({
    taps: ['Tap 1'], tapData: [{ meterReadings: { tds: 80, ph: 7.2 } }], revision: 1
  });
  const merged = AssessmentSnapshot.mergeSnapshots(existingOnServer, outgoing);
  assert(merged.taps[0].meterReadings?.tds === undefined,
    `server merge must delete tds on explicit clear (got ${JSON.stringify(merged.taps[0].meterReadings?.tds)})`);
  const draftAfterReload = AssessmentSnapshot.applySnapshotToDraft({}, merged);
  assert(draftAfterReload.tapData[0].meterReadings?.tds === undefined,
    `after reload, tds must stay missing (got ${JSON.stringify(draftAfterReload.tapData[0].meterReadings?.tds)})`);
  assert(draftAfterReload.tapData[0].meterReadings?.ph === 7.2, 'untouched ph survives clear+reload unchanged');
}

console.log('\n=== BUG-02b: OCR chlorine cleared by user must not resurrect after reload ===');
{
  const tap = { chlorineReadings: {}, standardMeasurement: {}, tasks: {}, photos: {} };
  // OCR fills chlorine.
  Object.assign(tap.chlorineReadings, { freeChlorine: '1.9' });
  // User clears it via the chlorine field handler.
  asmCtx.document.getElementById = (id) => (id === 'm-free-cl' ? { value: '' } : { value: tap.chlorineReadings.totalChlorine || '' });
  const before = { ...tap.chlorineReadings };
  const next = { ...before };
  Object.entries({ freeChlorine: 'm-free-cl', totalChlorine: 'm-total-cl' }).forEach(([key, id]) => {
    const el = asmCtx.document.getElementById(id);
    const raw = el.value;
    next[key] = raw === '' || raw == null ? null : raw;
  });
  tap.chlorineReadings = next;
  asmCtx.invalidateStaleStandardMeasurement(tap, before, next, { freeChlorine: 'chlorine' });

  const outgoing = AssessmentSnapshot.buildSnapshot({ taps: ['Tap 1'], tapData: [tap], revision: 2 });
  const existingOnServer = AssessmentSnapshot.buildSnapshot({
    taps: ['Tap 1'], tapData: [{ chlorineReadings: { freeChlorine: 1.9 }, standardMeasurement: { chlorine: 1.9 } }], revision: 1
  });
  const merged = AssessmentSnapshot.mergeSnapshots(existingOnServer, outgoing);
  const reloaded = AssessmentSnapshot.applySnapshotToDraft({}, merged);
  assert(reloaded.tapData[0].chlorineReadings?.freeChlorine === undefined,
    `OCR chlorine=1.9 must not resurrect after clear+reload (got ${JSON.stringify(reloaded.tapData[0].chlorineReadings?.freeChlorine)})`);
  assert(reloaded.tapData[0].standardMeasurement?.chlorine === undefined,
    `standardMeasurement.chlorine must not resurrect either (got ${JSON.stringify(reloaded.tapData[0].standardMeasurement?.chlorine)})`);
}

console.log('\n=== BUG-03/04: user correction of an OCR-filled field must win over stale Layer-2 standardMeasurement ===');
{
  const tap = { meterReadings: {}, standardMeasurement: {}, tasks: {}, photos: {} };
  asmCtx.storeRawAndStandardMeasurements(tap, { rawMeasurement: { ph: 8.9 }, metadata: {} });
  tap.meterReadings = asmCtx.mergeMeterReadings(tap.meterReadings, { ph: '8.9' });
  assert(tap.standardMeasurement.ph === 8.9, 'sanity: OCR wrote standardMeasurement.ph = 8.9 (Layer 2)');

  asmCtx.document.getElementById = (id) => (id === 'm-ph' ? { value: '7.2' } : { value: '' });
  const before = { ...(tap.meterReadings || {}) };
  tap.meterReadings = asmCtx.mergeMeterReadings(tap.meterReadings, asmCtx.readMeterReadingFields());
  asmCtx.invalidateStaleStandardMeasurement(tap, before, tap.meterReadings);

  assert(tap.meterReadings.ph === '7.2', 'sanity: manual edit wrote meterReadings.ph = 7.2 (Layer 1)');
  assert(tap.standardMeasurement.ph === undefined,
    `manual override must invalidate stale standardMeasurement.ph (got ${JSON.stringify(tap.standardMeasurement.ph)})`);

  // Now resolve via the REAL precedence function used for scoring (Hero).
  const heroReadings = scoreCtx.readingsFromTapData([tap]);
  assert(heroReadings.ph === 7.2, `Hero/score input must resolve to the user's 7.2, not stale 8.9 (got ${heroReadings.ph})`);

  // And via the REAL per-room "All Locations" resolution function.
  const allLocationsReadings = scoreCtx.readingsFromSingleTap(tap, {});
  assert(allLocationsReadings.ph === 7.2,
    `All Locations display must also resolve to 7.2, not stale 8.9 (got ${allLocationsReadings.ph})`);
}

console.log('\n=== BUG-06/07: Hero (score input) and All Locations must read the same resolved value ===');
{
  const tap = {
    meterReadings: { ph: 7.2, tds: 80 },
    standardMeasurement: {},
    tasks: {}, photos: {}
  };
  const hero = scoreCtx.readingsFromTapData([tap]);
  const allLocations = scoreCtx.readingsFromSingleTap(tap, {});
  assert(hero.ph === 7.2 && allLocations.ph === 7.2, `pH must agree between Hero (${hero.ph}) and All Locations (${allLocations.ph})`);
  assert(hero.tds === 80 && allLocations.tds === 80, `TDS must agree between Hero (${hero.tds}) and All Locations (${allLocations.tds})`);
}

console.log('\n=== BUG-08 (traced to BUG-01/02): a legitimately-filled required field must survive a full reload round trip ===');
{
  const fullTap = {
    meterReadings: { ph: 7.2, tds: 80, turbidity: 1, orp: 200, do: 6 },
    chlorineReadings: { freeChlorine: 0.5 },
    tasks: { tapphoto: true, meter: true, visual: true, chlorine: true },
    photos: {}
  };
  const snapshotV1 = AssessmentSnapshot.buildSnapshot({ taps: ['Tap 1'], tapData: [fullTap], revision: 1 });
  // Reload merge against itself (server round trip with nothing new to merge).
  const merged = AssessmentSnapshot.mergeSnapshots(snapshotV1, snapshotV1);
  const reloadedDraft = AssessmentSnapshot.applySnapshotToDraft({}, merged);
  const reloadedReadings = scoreCtx.readingsFromTapData(reloadedDraft.tapData);
  const requiredKeys = ['ph', 'tds', 'turbidity', 'orp', 'do', 'chlorine'];
  const missing = requiredKeys.filter((k) => reloadedReadings[k] === undefined);
  assert(missing.length === 0, `all required fields must survive an unrelated reload (missing: ${JSON.stringify(missing)})`);
}

console.log('\n=== UJ-05: clear TDS must not resurrect via field fallback or Hero base ===');
{
  const tap = { meterReadings: { tds: null, ph: 7.2, turbidity: 0.1, orp: 400, do: 8 }, chlorineReadings: { freeChlorine: 0.35 }, standardMeasurement: {}, tasks: {}, photos: {} };
  const fromTaps = scoreCtx.readingsFromTapData([tap]);
  assert(fromTaps.tds === undefined, `cleared TDS must be missing in readingsFromTapData (got ${fromTaps.tds})`);
  assert(fromTaps.__explicitClears && typeof fromTaps.__explicitClears.has === 'function' && fromTaps.__explicitClears.has('tds'),
    'explicit clear set must include tds');

  // Simulate stale draft.fields still holding the old value (pre-fix resurrection path).
  const job = {
    draft: {
      tapData: [tap],
      fields: { 'm-tds': '80', 'm-ph': '7.2' }
    }
  };
  scoreCtx.S.activeJob = job;
  const present = scoreCtx.resolveScoreReadingsPresent(job);
  assert(present.tds === undefined, `resolveScoreReadingsPresent must not resurrect TDS from fields (got ${present.tds})`);
  assert(present.ph === 7.2, 'uncleared ph still resolves');
}

console.log('\n=== UJ-07: All Locations must not synthesize values for empty rooms ===');
{
  scoreCtx.S.taps = ['Kitchen', 'Master bath', 'Shower'];
  scoreCtx.S.activeJob = {
    draft: {
      tapData: [
        { meterReadings: { ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, do: 8 }, chlorineReadings: { freeChlorine: 0.35 }, tasks: {}, photos: {} },
        { meterReadings: {}, chlorineReadings: {}, tasks: {}, photos: {} },
        { meterReadings: {}, chlorineReadings: {}, tasks: {}, photos: {} }
      ]
    }
  };
  scoreCtx.S.scoreBaseReadings = { ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, do: 8, chlorine: 0.35, temp: 25 };
  const all = scoreCtx.getRoomReadings('all', { readings: scoreCtx.S.scoreBaseReadings });
  assert(all.ph === 7.2, `All Locations ph must equal measured Kitchen only (got ${all.ph})`);
  assert(all.tds === 80, `All Locations tds must equal measured Kitchen only (got ${all.tds})`);
  // Pre-fix synthetic used delta*42 on tds across empty rooms → not 80.
  assert(Math.abs(all.tds - 80) < 0.001, 'All Locations must not invent per-room TDS offsets');
}

console.log(`\n${passed} passed, ${failed} failed`);
console.warn = noisy;
process.exitCode = failed > 0 ? 1 : 0;
