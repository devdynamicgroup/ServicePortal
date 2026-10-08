/**
 * A publication freezes the canonical readings its score was computed from,
 * and the customer report is served those readings instead of the live Case.
 * Run: node tests/publish/publication-frozen-readings.test.js
 *
 * Uses the in-memory ledger only; no Notion. The customer-side assertions load
 * the real, unmodified src/js/flows/score.js so they check what the report page
 * itself would read -- no second reading resolver or scoring formula lives here.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  createOrReusePublication,
  resolveReportByToken,
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies
} = require('../../services/score-publication-service');
const { applyPublicationToJob, minimalJobFromSnapshot } = require('../../services/score-publication-snapshot');
const { createMemoryPublicationStore } = require('../../services/score-publication-store-memory');
const { computeCanonicalScore } = require('../../services/canonical-score');

const root = path.join(__dirname, '../..');
const SCORED = ['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do'];
const CLIENT_FILES = [
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
  'src/js/score/validation/measurementValidator.js',
  'src/js/score/production/computeProductionScore.js',
  'src/js/score/production/computeQualityScoreV2.js',
  'src/js/score/benchmark/registry.js',
  ...['thailand', 'who', 'eu', 'japan', 'usEpa'].flatMap((key) =>
    ['limits', 'weights', 'score'].map((file) => `src/js/score/benchmark/${key}/${file}.js`)),
  'src/js/flows/score.js'
];

const store = createMemoryPublicationStore();
const cases = new Map();
const clone = (value) => JSON.parse(JSON.stringify(value));

let passed = 0;
let failed = 0;
function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ok   ', label);
  } catch (error) {
    failed += 1;
    console.error('  FAIL ', label, '\n        ', error.message);
  }
}

const measurement = (chlorine, extra = {}) => ({ ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, do: 8, chlorine, ...extra });

function seed(id, taps) {
  const job = {
    id,
    notionId: id,
    name: `Case ${id}`,
    pkg: 'full',
    draft: {
      taps: taps.map((tap) => tap.name),
      fields: { 'm-free-cl': '0.03', note: 'kept' },
      tapData: taps.map((tap) => ({ tasks: { visual: true }, photos: { tapphoto: tap.photo }, standardMeasurement: tap.readings }))
    },
    result: {},
    drive: {}
  };
  cases.set(id, job);
  return job;
}

async function publish(id, intent, key) {
  const job = clone(cases.get(id));
  return createOrReusePublication({
    job,
    caseId: id,
    payload: { score: computeCanonicalScore(job).score, intent, idempotencyKey: key }
  });
}

const snapshotOf = (publicationId) => store._rows.find((row) => row.publicationId === publicationId).snapshot;

/** What the unmodified report page reads from a report object. */
function customerView(report) {
  const quiet = { log() {}, warn() {}, error() {}, info() {} };
  const sandbox = {
    console: quiet,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    navigator: { userAgent: 'node' },
    S: { activeJob: report, taps: report.draft.taps || ['Tap 1'], tapData: [], publicScoreView: true, scoreStandardKey: 'thailand' },
    t: (key) => key
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  CLIENT_FILES.forEach((rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel }));
  const hero = sandbox.resolveScoreReadings(report);
  const context = { readings: hero };
  const plain = (readings) => Object.fromEntries(SCORED.concat('temp').filter((key) => readings[key] !== undefined).map((key) => [key, readings[key]]));
  return {
    hero: plain(hero),
    quality: sandbox.computeQualityScoreDetail(hero).score,
    all: plain(sandbox.getRoomReadings('all', context)),
    room: (name) => plain(sandbox.getRoomReadings(name, context))
  };
}

async function main() {
  setPublicationStore(store);
  setPublicationCaseAdapter({
    getClient: async (id) => (cases.has(id) ? clone(cases.get(id)) : null),
    updateClient: async (id, payload) => {
      const current = cases.get(id);
      current.result = {
        ...current.result,
        waterScore: payload.latestWaterScore ?? current.result.waterScore,
        complianceStatus: payload.complianceStatus ?? current.result.complianceStatus ?? null,
        reportUrl: payload.reportUrl ?? current.result.reportUrl ?? '',
        publicReportToken: payload.publicReportToken ?? current.result.publicReportToken ?? ''
      };
      return clone(current);
    },
    findClientByReportToken: async () => null
  });

  console.log('\n1. A new publication freezes the canonical readings');
  seed('one', [{ name: 'Tap 1', photo: 'photo-1', readings: measurement(0.35) }]);
  const canonicalAtPublish = computeCanonicalScore(clone(cases.get('one')));
  const first = await publish('one', 'publish', 'one-a');
  const firstSnapshot = clone(snapshotOf(first.publicationId));
  check('published score is the canonical score', () => assert.equal(firstSnapshot.publishedScore, canonicalAtPublish.score));
  check('frozen chlorine is 0.35', () => assert.equal(firstSnapshot.readings.chlorine, 0.35));
  check('all six scored readings are frozen and equal the canonical readings', () => {
    SCORED.forEach((key) => assert.equal(firstSnapshot.readings[key], canonicalAtPublish.readings[key], key));
  });

  console.log('\n5. Frozen readings and published score are one set');
  check('canonical score of the frozen readings equals the published score', () => {
    const rescored = computeCanonicalScore({ draft: { tapData: [{ standardMeasurement: firstSnapshot.readings }], fields: {} } });
    assert.equal(rescored.score, firstSnapshot.publishedScore);
  });

  console.log('\n2. Customer stays frozen after the Case is edited');
  cases.get('one').draft.tapData[0].standardMeasurement.chlorine = 0.03;
  cases.get('one').draft.fields['m-temp'] = '31';
  const staff = computeCanonicalScore(clone(cases.get('one')));
  const report = await resolveReportByToken(first.reportToken);
  const view = customerView(report);
  check('staff/live calculation sees the edited value', () => {
    assert.equal(staff.readings.chlorine, 0.03);
    assert.notEqual(staff.score, firstSnapshot.publishedScore);
  });
  check('customer score is still the published score', () => assert.equal(report.result.waterScore, firstSnapshot.publishedScore));
  check('customer chlorine is still 0.35', () => {
    assert.equal(view.hero.chlorine, 0.35);
    assert.equal(view.room('Tap 1').chlorine, 0.35);
  });
  check('report measurements score to the published score', () => assert.equal(view.quality, firstSnapshot.publishedScore));
  check('live draft fields cannot refill a reading (temp was not frozen)', () => {
    assert.equal(view.hero.temp, undefined);
    assert.equal(report.draft.fields['m-free-cl'], undefined);
    assert.equal(report.draft.fields.note, 'kept');
  });
  check('photos and other tap fields are kept', () => {
    assert.equal(report.draft.tapData[0].photos.tapphoto, 'photo-1');
    assert.deepEqual(report.draft.tapData[0].tasks, { visual: true });
  });
  check('the stored Case itself is not modified by serving the report', () => {
    assert.equal(cases.get('one').draft.tapData[0].standardMeasurement.chlorine, 0.03);
    assert.equal(cases.get('one').draft.fields['m-free-cl'], '0.03');
  });

  console.log('\n3. The same report resolves identically every time');
  const again = await resolveReportByToken(first.reportToken);
  check('score and tap readings are identical across requests', () => {
    assert.equal(again.result.waterScore, report.result.waterScore);
    assert.deepEqual(again.draft.tapData, report.draft.tapData);
  });
  check('the ledger snapshot did not change', () => assert.deepEqual(snapshotOf(first.publicationId), firstSnapshot));

  console.log('\n7. Republish');
  const second = await publish('one', 'republish', 'one-b');
  check('publication A is unchanged', () => assert.deepEqual(snapshotOf(first.publicationId), firstSnapshot));
  check('publication B is a new record with its own canonical readings', () => {
    assert.notEqual(second.publicationId, first.publicationId);
    assert.notEqual(second.reportToken, first.reportToken);
    assert.equal(snapshotOf(second.publicationId).readings.chlorine, 0.03);
    assert.equal(snapshotOf(second.publicationId).publishedScore, staff.score);
  });
  const oldLink = customerView(await resolveReportByToken(first.reportToken));
  const newLink = customerView(await resolveReportByToken(second.reportToken));
  check('old link shows 0.35, new link shows 0.03', () => {
    assert.equal(oldLink.hero.chlorine, 0.35);
    assert.equal(newLink.hero.chlorine, 0.03);
  });

  console.log('\n6. Two rooms: whole-house readings');
  seed('two', [
    { name: 'Kitchen', photo: 'photo-k', readings: measurement(0.30, { tds: 60 }) },
    { name: 'Bath', photo: 'photo-b', readings: measurement(0.40, { tds: 100 }) }
  ]);
  const wholeHouse = computeCanonicalScore(clone(cases.get('two')));
  const twoRooms = await publish('two', 'publish', 'two-a');
  const twoSnapshot = clone(snapshotOf(twoRooms.publicationId));
  check('snapshot readings are the canonical whole-house readings', () => {
    SCORED.forEach((key) => assert.equal(twoSnapshot.readings[key], wholeHouse.readings[key], key));
    assert.equal(twoSnapshot.readings.tds, 80);
  });
  cases.get('two').draft.tapData[0].standardMeasurement.chlorine = 0.03;
  cases.get('two').draft.tapData[1].standardMeasurement.tds = 900;
  const twoReport = await resolveReportByToken(twoRooms.reportToken);
  const twoView = customerView(twoReport);
  check('room names and room count are unchanged', () => {
    assert.deepEqual(twoReport.draft.taps, ['Kitchen', 'Bath']);
    assert.equal(twoReport.draft.tapData.length, 2);
  });
  check('photos stay with their rooms', () => {
    assert.equal(twoReport.draft.tapData[0].photos.tapphoto, 'photo-k');
    assert.equal(twoReport.draft.tapData[1].photos.tapphoto, 'photo-b');
  });
  check('"all" readings are the frozen whole-house values', () => {
    SCORED.forEach((key) => assert.equal(twoView.all[key], twoSnapshot.readings[key], key));
  });
  check('each room shows the frozen whole-house values', () => {
    ['Kitchen', 'Bath'].forEach((name) => {
      SCORED.forEach((key) => assert.equal(twoView.room(name)[key], twoSnapshot.readings[key], `${name} ${key}`));
    });
  });
  check('no live Case reading reaches the report', () => {
    const text = JSON.stringify(twoReport.draft.tapData) + JSON.stringify(twoReport.draft.fields);
    assert.ok(!text.includes('0.03'));
    assert.ok(!text.includes('900'));
  });

  console.log('\n8. Legacy pointer');
  const legacy = seed('legacy', [{ name: 'Tap 1', photo: 'photo-l', readings: measurement(0.03) }]);
  // The Case holds a complete reading set in every place a freeze could read it from.
  legacy.draft.scoreBaseReadings = measurement(0.03);
  legacy.result = { waterScore: 96, publicReportToken: 'rpt-legacy', reportUrl: '', readings: measurement(0.03) };
  const frozenLegacy = await createOrReusePublication({
    job: clone(legacy),
    caseId: 'legacy',
    payload: { score: 96, intent: 'publish', idempotencyKey: 'legacy-a' }
  });
  const legacySnapshot = snapshotOf(frozenLegacy.publicationId);
  check('legacy pointer is frozen as before', () => {
    assert.equal(frozenLegacy.reused, true);
    assert.equal(frozenLegacy.reportToken, 'rpt-legacy');
    assert.equal(legacySnapshot.publishedScore, 96);
    assert.equal(legacySnapshot.scoreType, 'legacy-publication');
  });
  check('current Case has a complete canonical reading set', () => assert.equal(computeCanonicalScore(clone(legacy)).score, 87));
  check('legacy freeze captures no current readings', () => assert.equal(legacySnapshot.readings, undefined));

  console.log('\n4. Publications without a complete frozen set keep the existing behavior');
  const legacyReport = await resolveReportByToken('rpt-legacy');
  check('no readings: tap data and fields are served from the Case untouched', () => {
    assert.equal(legacyReport.result.waterScore, 96);
    assert.deepEqual(legacyReport.draft.tapData, legacy.draft.tapData);
    assert.deepEqual(legacyReport.draft.fields, legacy.draft.fields);
    assert.equal(customerView(legacyReport).hero.chlorine, 0.03);
  });
  const completeSet = { ph: 7.2, tds: 80, chlorine: 0.35, turbidity: 0.1, orp: 400, do: 8 };
  store._rows.find((row) => row.publicationId === frozenLegacy.publicationId).snapshot.readings = { ...completeSet };
  const legacyWithReadings = await resolveReportByToken('rpt-legacy');
  check('legacy publication holding a complete reading set still serves the current Case', () => {
    assert.equal(legacyWithReadings.result.waterScore, 96);
    assert.deepEqual(legacyWithReadings.draft.tapData, legacy.draft.tapData);
    assert.deepEqual(legacyWithReadings.draft.fields, legacy.draft.fields);
    assert.equal(customerView(legacyWithReadings).hero.chlorine, 0.03);
  });
  const base = { publishedScore: 88, publicReportToken: 'rpt-partial', publicationId: 'pub-partial', scoreType: 'quality-v3' };
  const liveJob = clone(cases.get('one'));
  const partial = applyPublicationToJob(liveJob, { snapshot: { ...base, readings: { ph: 7.2, tds: 80, chlorine: 0.35, turbidity: 0.1, orp: 400 } } });
  check('incomplete readings (five of six): nothing is synthesized', () => {
    assert.deepEqual(partial.draft.tapData, liveJob.draft.tapData);
    assert.deepEqual(partial.draft.fields, liveJob.draft.fields);
    assert.equal(partial.result.waterScore, 88);
  });

  console.log('\nSnapshot-only fallback (Case unavailable)');
  const minimal = minimalJobFromSnapshot(firstSnapshot);
  const emptyMinimal = minimalJobFromSnapshot({ ...base });
  check('frozen readings are served without the Case', () => {
    assert.equal(minimal.result.waterScore, firstSnapshot.publishedScore);
    assert.equal(customerView(minimal).hero.chlorine, 0.35);
  });
  check('a snapshot without readings still yields the existing empty fallback', () => {
    assert.deepEqual(emptyMinimal.draft.tapData, []);
    assert.deepEqual(emptyMinimal.draft.fields, {});
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main()
  .finally(() => resetPublicationDependencies())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
