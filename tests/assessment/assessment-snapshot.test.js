/**
 * Assessment Snapshot persistence suite
 * Run: node tests/assessment/assessment-snapshot.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const AssessmentSnapshot = require('../../src/js/assessment-snapshot');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const CASE_1328 = {
  taps: ['Kitchen', 'Master bath', 'Shower', 'Laundry', 'Guest'],
  tapData: [
    {
      tasks: {},
      photos: {},
      meterReadings: {
        ph: 7.79, tds: 92, ec: 184, temp: 28.06,
        turbidity: 0.12, orp: 434.1, do: 6.34, doPercent: 82
      },
      chlorineReadings: { freeChlorine: 0.3 },
      standardMeasurement: {
        ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, temp: 28.06, chlorine: 0.3
      }
    },
    { tasks: {}, photos: {} },
    { tasks: {}, photos: {} },
    { tasks: {}, photos: {} },
    { tasks: {}, photos: {} }
  ]
};

console.log('\nbuild / serialize / parse');
{
  const snap = AssessmentSnapshot.buildSnapshot({
    taps: CASE_1328.taps,
    tapData: CASE_1328.tapData,
    revision: 1
  });
  assert(snap.version === 1, 'version = 1');
  assert(snap.taps[0].meterReadings.ph === 7.79, 'ph persisted');
  assert(snap.taps[0].chlorineReadings.freeChlorine === 0.3, 'free chlorine persisted');
  assert(snap.taps[0].chlorineReadings.totalChlorine === undefined, 'no invented total chlorine');
  const raw = AssessmentSnapshot.serializeSnapshot(snap);
  const parsed = AssessmentSnapshot.parseSnapshot(raw);
  assert(parsed && parsed.taps[0].meterReadings.orp === 434.1, 'round-trip serialize/parse');
}

console.log('\ninvalid snapshot fallback');
{
  assert(AssessmentSnapshot.parseSnapshot('') === null, 'empty → null');
  assert(AssessmentSnapshot.parseSnapshot('{bad') === null, 'malformed JSON → null');
  assert(AssessmentSnapshot.parseSnapshot(JSON.stringify({ version: 99, taps: [] })) === null, 'bad version → null');
}

console.log('\npartial update merge (absent ≠ clear)');
{
  const existing = AssessmentSnapshot.buildSnapshot({
    taps: ['Kitchen'],
    tapData: [{ meterReadings: { ph: 7.79, tds: 92, orp: 434.1 }, tasks: {}, photos: {} }],
    revision: 1,
    updatedAt: '2026-08-10T01:00:00.000Z'
  });
  const incoming = AssessmentSnapshot.buildSnapshot({
    taps: ['Kitchen'],
    tapData: [{
      meterReadings: { orp: 434.1 },
      chlorineReadings: { freeChlorine: 0.3 },
      tasks: {},
      photos: {}
    }],
    revision: 2,
    updatedAt: '2026-08-10T02:00:00.000Z'
  });
  // Simulate partial payload merge at reading-map level
  const mergedMaps = AssessmentSnapshot.mergeReadingMaps(
    { ph: 7.79, tds: 92, orp: 434.1 },
    { freeChlorine: undefined, chlorine: 0.3, ph: undefined },
    AssessmentSnapshot.METER_KEYS
  );
  // chlorine not in METER_KEYS — use chlorine merge:
  const mergedChlorine = AssessmentSnapshot.mergeReadingMaps(
    {},
    { freeChlorine: 0.3 },
    AssessmentSnapshot.CHLORINE_KEYS
  );
  const merged = AssessmentSnapshot.mergeSnapshots(existing, {
    ...incoming,
    taps: [{
      index: 0,
      name: 'Kitchen',
      meterReadings: { orp: 434.1 }, // partial — ph/tds absent
      chlorineReadings: { freeChlorine: 0.3 }
    }]
  });
  assert(merged.taps[0].meterReadings.ph === 7.79, 'ph retained when absent in incoming');
  assert(merged.taps[0].meterReadings.tds === 92, 'tds retained when absent in incoming');
  assert(merged.taps[0].meterReadings.orp === 434.1, 'orp kept');
  assert(merged.taps[0].chlorineReadings.freeChlorine === 0.3, 'chlorine added');
  assert(mergedChlorine.freeChlorine === 0.3, 'chlorine map merge works');
}

console.log('\nexplicit clear via null');
{
  const cleared = AssessmentSnapshot.mergeReadingMaps(
    { ph: 7.79, tds: 92 },
    { ph: null },
    AssessmentSnapshot.METER_KEYS
  );
  assert(cleared.ph === undefined, 'null clears ph');
  assert(cleared.tds === 92, 'tds retained when not cleared');
}

console.log('\nmulti-tap isolation');
{
  const snap = AssessmentSnapshot.buildSnapshot({
    taps: ['Kitchen', 'Bathroom'],
    tapData: [
      { meterReadings: { ph: 7.1 }, tasks: {}, photos: {} },
      { meterReadings: { ph: 8.2 }, tasks: {}, photos: {} }
    ],
    revision: 1
  });
  assert(snap.taps[0].meterReadings.ph === 7.1, 'Kitchen ph');
  assert(snap.taps[1].meterReadings.ph === 8.2, 'Bathroom ph');
  assert(snap.taps[0].name === 'Kitchen' && snap.taps[1].name === 'Bathroom', 'names preserved by index');
}

console.log('\nno data URL photos');
{
  const snap = AssessmentSnapshot.buildSnapshot({
    taps: ['Kitchen'],
    tapData: [{
      photos: {
        tapphoto: 'data:image/png;base64,aaa',
        meter: { fileId: 'drive-1', previewUrl: 'data:image/png;base64,bbb', contentUrl: 'https://example/file' }
      },
      tasks: { tapphoto: true },
      meterReadings: { ph: 7 }
    }],
    revision: 1
  });
  assert(snap.taps[0].photos.tapphoto === undefined, 'data URL tapphoto stripped');
  assert(snap.taps[0].photos.meter.fileId === 'drive-1', 'fileId kept');
  assert(snap.taps[0].photos.meter.previewUrl === undefined, 'preview data URL stripped');
}

console.log('\napplySnapshotToDraft + preferDraft');
{
  const snap = AssessmentSnapshot.buildSnapshot({
    taps: CASE_1328.taps,
    tapData: CASE_1328.tapData,
    revision: 3,
    updatedAt: '2026-08-10T09:00:00.000Z'
  });
  const draft = AssessmentSnapshot.applySnapshotToDraft({}, snap);
  assert(draft.tapData[0].meterReadings.do === 6.34, 'draft reconstructed');
  assert(draft.assessmentRevision === 3, 'revision stamped');

  const emptyLocal = { tapData: [{ tasks: {}, photos: {} }], assessmentUpdatedAt: '2026-08-10T10:00:00.000Z' };
  const preferred = AssessmentSnapshot.preferDraft(emptyLocal, draft);
  assert(preferred === draft, 'Notion measurements win over empty local');
}

console.log('\nCase 13.28 snapshot + score regression via production engine');
{
  const snap = AssessmentSnapshot.buildSnapshot({
    taps: CASE_1328.taps,
    tapData: CASE_1328.tapData,
    revision: 1
  });
  const draft = AssessmentSnapshot.applySnapshotToDraft({}, snap);
  const readings = draft.tapData[0].standardMeasurement;
  const sandbox = { console, window: {} };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const rel of [
    'src/js/score/util/clamp.js',
    'src/js/score/production/computeProductionScore.js',
    'src/js/score/production/computeQualityScoreV2.js',
    'src/js/score/eligibility/evidenceEngine.js',
    'src/js/score/eligibility/coverageEngine.js',
    'src/js/score/eligibility/contract.js',
    'src/js/score/eligibility/eligibilityEngine.js',
    'src/js/score/eligibility/presentation.js'
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
  }
  const score = sandbox.computeScoreFromReadings(readings);
  assert(Number.isFinite(score) && score < 100, `Case 13.28 Quality V2 < 100 (got ${score})`);
  assert(sandbox.computeLegacyDwqiScore(readings) === 100, 'Case 13.28 legacy DWQI still 100');
  const elig = sandbox.EligibilityEngine.evaluate({
    reportType: 'production',
    readings,
    tasks: {}
  });
  assert(elig.canCalculateScore === true, 'canCalculateScore true after reconstruct');
  assert(elig.canPublishReport === false, 'canPublishReport false (inspection incomplete)');
}

console.log('\nrich_text chunk join');
{
  const long = 'x'.repeat(5000);
  const chunks = AssessmentSnapshot.chunkRichText(long);
  assert(chunks.length >= 3, 'long text chunked');
  assert(AssessmentSnapshot.joinRichTextSegments(chunks) === long, 'chunk join has no inserted spaces');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
