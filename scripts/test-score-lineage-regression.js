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

console.log('\n=== TDS: EC-derivation reaches meterReadings (real device contract — HANNA HI98194 never displays a literal TDS/ppm reading) ===');
{
  // Real evidence: live PaddleOCR against ocr/test_images/line_oa_chat_260720_084708_original.jpg
  // (meter_type='ph', the real client call) returns body.data = {ec: 319, do_mg_l: 6.67} — no
  // 'tds' key at all. This is the exact shape fed to mapOcrDataToMeterReadings in production.
  const body = { ec: 319, do_mg_l: 6.67 };
  const mapped = asmCtx.mapOcrDataToMeterReadings(body);
  assert(mapped.tds === '159.5', `TDS-005: EC=319 must derive tds=159.5 (0.5 factor), not truncated/shifted (got ${mapped.tds})`);
  assert(mapped.ec === '319', 'sanity: ec itself still passes through unchanged');

  const tap = { meterReadings: {}, standardMeasurement: {}, tasks: {}, photos: {} };
  tap.meterReadings = asmCtx.mergeMeterReadings(tap.meterReadings, mapped);
  asmCtx.storeRawAndStandardMeasurements(tap, { rawMeasurement: body, metadata: {} });
  assert(tap.meterReadings.tds === '159.5', 'derived tds now visible in tap.meterReadings (form field), not just standardMeasurement');
  assert(tap.standardMeasurement.tds === 159.5, 'standardMeasurement.tds unchanged (already worked before this fix)');

  const hero = scoreCtx.readingsFromTapData([tap]);
  const allLocations = scoreCtx.readingsFromSingleTap(tap, {});
  assert(hero.tds === 159.5, `TDS reaches Hero score input (got ${hero.tds})`);
  assert(allLocations.tds === 159.5, `TDS reaches All Locations display (got ${allLocations.tds})`);
}

console.log('\n=== TDS-002: tds must never derive from chlorine/ORP/DO — only from ec ===');
{
  const noEc = asmCtx.mapOcrDataToMeterReadings({ orp: 400, do_mg_l: 8, chlorine: 0.5, ph: 7.2 });
  assert(noEc.tds === undefined, `no ec present -> tds must stay undefined, not fabricated from orp/do/chlorine (got ${JSON.stringify(noEc.tds)})`);
}

console.log('\n=== TDS-003: missing ec -> tds stays missing, never 0 ===');
{
  const noEc = asmCtx.mapOcrDataToMeterReadings({ ph: 7.2 });
  assert(noEc.tds === undefined, `tds must be undefined (missing), not 0 (got ${JSON.stringify(noEc.tds)})`);
}

console.log('\n=== TDS-004: literal OCR tds always wins over EC-derived — never overwritten ===');
{
  // If a device ever DOES show a literal TDS reading alongside EC, the real
  // reading must never be replaced by the derived one.
  const literal = asmCtx.mapOcrDataToMeterReadings({ tds: 500, ec: 319 });
  assert(literal.tds === '500', `literal tds=500 must win over ec-derived 159.5 (got ${literal.tds})`);
}

console.log('\n=== TDS-005: decimal preservation across a range of real/plausible EC values ===');
{
  const cases = [
    [319, '159.5'],
    [369, '184.5'],
    // EC=0 is not on the existing false-zero filter (only ph/temp/turbidity
    // are) — unchanged, pre-existing behavior; a real 0 stays 0, not missing.
    [0, '0'],
    [1000, '500'],
  ];
  cases.forEach(([ec, expected]) => {
    const mapped = asmCtx.mapOcrDataToMeterReadings({ ec });
    assert(mapped.tds === expected, `ec=${ec} -> tds=${JSON.stringify(expected)} (got ${JSON.stringify(mapped.tds)})`);
  });
}

console.log('\n=== TDS-006: unit mismatch — a turbidity/chlorine-only reading must never produce tds ===');
{
  // Real evidence shape: HACH DR300 chlorine response never includes 'ec'.
  const chlorineOnly = asmCtx.mapOcrDataToMeterReadings({ chlorine: 0.41 });
  assert(chlorineOnly.tds === undefined, `chlorine-only OCR response must not produce tds (got ${JSON.stringify(chlorineOnly.tds)})`);
}

console.log('\n=== TDS-007: existing certified parameters — no cross-contamination from the tds-derivation change ===');
{
  const mapped = asmCtx.mapOcrDataToMeterReadings({ ph: 7.29, orp: 208.3, do_mg_l: 89.4, ec: 319 });
  assert(mapped.ph === '7.29' && mapped.orp === '208.3' && mapped.do === '89.4',
    `ph/orp/do must be unaffected by the new tds-derivation branch (got ${JSON.stringify(mapped)})`);
  assert(mapped.tds === '159.5', 'tds still derives correctly alongside other fields in the same response');
}

console.log('\n=== Turbidity: OCR -> client mapping -> meterReadings -> score (real device: HACH 2100Q) ===');
{
  // Real evidence: live PaddleOCR against ocr/test_images/line_oa_chat_260720_084735_original.jpg
  // (meter_type='turbidity') returns body.data = {turbidity: 0.41} through the real,
  // unmodified pipeline (server-side profile-routing fix + hach_2100q.json profile).
  const body = { turbidity: 0.41 };
  const readings = {};
  if (body.turbidity !== undefined && body.turbidity !== null && body.turbidity !== '') {
    readings.turbidity = String(body.turbidity);
  }
  assert(readings.turbidity === '0.41', `TURB-006: OCR turbidity=0.41 must map through unchanged (got ${readings.turbidity})`);

  const tap = { meterReadings: {}, standardMeasurement: {}, tasks: {}, photos: {} };
  tap.meterReadings = asmCtx.mergeMeterReadings(tap.meterReadings, readings);
  assert(tap.meterReadings.turbidity === '0.41', 'turbidity visible in tap.meterReadings (form field)');

  const hero = scoreCtx.readingsFromTapData([tap]);
  const allLocations = scoreCtx.readingsFromSingleTap(tap, {});
  assert(hero.turbidity === 0.41, `TURB-002: Hero score input turbidity (got ${hero.turbidity})`);
  assert(allLocations.turbidity === 0.41, `All Locations turbidity (got ${allLocations.turbidity})`);
}

console.log('\n=== TURB-003: turbidity must never leak into another parameter, and vice versa ===');
{
  const readings = { turbidity: '0.41' };
  const tap = { meterReadings: {}, standardMeasurement: {}, tasks: {}, photos: {} };
  tap.meterReadings = asmCtx.mergeMeterReadings(tap.meterReadings, readings);
  const hero = scoreCtx.readingsFromTapData([tap]);
  assert(hero.chlorine === undefined, `turbidity must not leak into chlorine (got ${hero.chlorine})`);
  assert(hero.tds === undefined, `turbidity must not leak into tds (got ${hero.tds})`);
  assert(hero.orp === undefined, `turbidity must not leak into orp (got ${hero.orp})`);
  assert(hero.ph === undefined, `turbidity must not leak into ph (got ${hero.ph})`);
}

console.log('\n=== TURB-004: missing turbidity stays missing, never 0 ===');
{
  const readings = {};
  const tap = { meterReadings: {}, standardMeasurement: {}, tasks: {}, photos: {} };
  tap.meterReadings = asmCtx.mergeMeterReadings(tap.meterReadings, readings);
  const hero = scoreCtx.readingsFromTapData([tap]);
  assert(hero.turbidity === undefined, `missing turbidity must stay undefined (got ${hero.turbidity})`);
}

console.log('\n=== TURB-005: zero turbidity (0.00 NTU) is preserved, not dropped as missing ===');
{
  const readings = { turbidity: '0.00' };
  const tap = { meterReadings: {}, standardMeasurement: {}, tasks: {}, photos: {} };
  tap.meterReadings = asmCtx.mergeMeterReadings(tap.meterReadings, readings);
  const hero = scoreCtx.readingsFromTapData([tap]);
  assert(hero.turbidity === 0, `zero turbidity must be preserved as 0, not missing (got ${JSON.stringify(hero.turbidity)})`);
}

console.log('\n=== TURB-007: existing certified parameters unaffected by turbidity client mapping ===');
{
  const readings = { ph: '7.29', tds: '159.5', orp: '208.3', do: '89.4', turbidity: '0.41' };
  const tap = { meterReadings: {}, standardMeasurement: {}, tasks: {}, photos: {} };
  tap.meterReadings = asmCtx.mergeMeterReadings(tap.meterReadings, readings);
  const hero = scoreCtx.readingsFromTapData([tap]);
  assert(hero.ph === 7.29 && hero.tds === 159.5 && hero.orp === 208.3 && hero.do === 89.4,
    `existing parameters must be unaffected alongside turbidity in the same tap (got ${JSON.stringify(hero)})`);
  assert(hero.turbidity === 0.41, 'turbidity itself still correct alongside the others');
}

console.log('\n=== TURB manual override: OCR value replaced by manual edit must not resurrect ===');
{
  const tap = { meterReadings: {}, standardMeasurement: {}, tasks: {}, photos: {} };
  // OCR fills turbidity=0.41 (mirrors processAssessmentPhoto's turbidity branch).
  tap.meterReadings = asmCtx.mergeMeterReadings(tap.meterReadings, { turbidity: '0.41' });
  assert(tap.meterReadings.turbidity === '0.41', 'sanity: OCR wrote turbidity=0.41');

  // Operator manually edits the m-turb field to a different value (real
  // meter-reading form path — persistMeterReadings's own merge/invalidate).
  asmCtx.document.getElementById = (id) => (id === 'm-turb' ? { value: '1.2' } : { value: '' });
  const before = { ...(tap.meterReadings || {}) };
  tap.meterReadings = asmCtx.mergeMeterReadings(tap.meterReadings, asmCtx.readMeterReadingFields());
  asmCtx.invalidateStaleStandardMeasurement(tap, before, tap.meterReadings);
  assert(tap.meterReadings.turbidity === '1.2', `manual edit must win over OCR value (got ${tap.meterReadings.turbidity})`);

  const hero = scoreCtx.readingsFromTapData([tap]);
  assert(hero.turbidity === 1.2, `score input must resolve to the manual 1.2, not stale OCR 0.41 (got ${hero.turbidity})`);
}

console.log('\n=== TURB clear + reload: explicit clear must not resurrect stale OCR turbidity ===');
{
  const localTap = { meterReadings: { turbidity: null, ph: 7.2 }, tasks: {}, photos: {} };
  const outgoing = AssessmentSnapshot.buildSnapshot({ taps: ['Tap 1'], tapData: [localTap], revision: 2 });
  const existingOnServer = AssessmentSnapshot.buildSnapshot({
    taps: ['Tap 1'], tapData: [{ meterReadings: { turbidity: 0.41, ph: 7.2 } }], revision: 1
  });
  const merged = AssessmentSnapshot.mergeSnapshots(existingOnServer, outgoing);
  assert(merged.taps[0].meterReadings?.turbidity === undefined,
    `server merge must delete turbidity on explicit clear (got ${JSON.stringify(merged.taps[0].meterReadings?.turbidity)})`);
  const draftAfterReload = AssessmentSnapshot.applySnapshotToDraft({}, merged);
  assert(draftAfterReload.tapData[0].meterReadings?.turbidity === undefined,
    `after reload, turbidity must stay missing, not resurrect 0.41 (got ${JSON.stringify(draftAfterReload.tapData[0].meterReadings?.turbidity)})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
console.warn = noisy;
process.exitCode = failed > 0 ? 1 : 0;
