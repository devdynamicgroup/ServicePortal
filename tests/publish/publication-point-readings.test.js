/**
 * New publications freeze optional per-point readings beside the Whole House score.
 * Run: node tests/publish/publication-point-readings.test.js
 */
const assert = require('assert');
const {
  createOrReusePublication,
  resolveReportByToken,
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies
} = require('../../services/score-publication-service');
const { buildSnapshot, serializeSnapshot, MAX_SNAPSHOT_CHARS } = require('../../services/score-publication-snapshot');
const { createMemoryPublicationStore } = require('../../services/score-publication-store-memory');
const { computeCanonicalScore, computeCanonicalCountryScore } = require('../../services/canonical-score');

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

const measurement = (extra = {}) => ({ ph: 7.2, tds: 80, chlorine: 0.35, turbidity: 0.1, orp: 400, do: 8, temp: 27, ...extra });

function seed(id, taps, result = {}) {
  const job = {
    id,
    notionId: id,
    name: id,
    pkg: 'full',
    draft: {
      taps: taps.map((tap) => tap.name),
      fields: {},
      tapData: taps.map((tap) => ({
        photos: { tapphoto: tap.photo || `photo-${tap.name}` },
        tasks: { visual: true },
        standardMeasurement: tap.readings ? { ...tap.readings } : {}
      }))
    },
    result: { ...result },
    drive: {}
  };
  cases.set(id, job);
  return job;
}

async function publish(id, payload) {
  return createOrReusePublication({
    job: clone(cases.get(id)),
    caseId: id,
    payload
  });
}

const snapshotOf = (publicationId) => store._rows.find((row) => row.publicationId === publicationId).snapshot;

async function main() {
  resetPublicationDependencies();
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

  console.log('\nNew quality and country publications freeze points without changing the Whole House score');
  seed('house', [
    { name: 'Kitchen', readings: measurement({ tds: 60, chlorine: 0.3 }) },
    { name: 'Bath', readings: measurement({ tds: 100, chlorine: 0.4 }) },
    { name: 'Empty', readings: null }
  ]);
  const qualityCanonical = computeCanonicalScore(clone(cases.get('house')));
  const quality = await publish('house', {
    score: qualityCanonical.score,
    intent: 'publish',
    idempotencyKey: 'house-quality'
  });
  const qualitySnapshot = snapshotOf(quality.publicationId);
  check('quality publishedScore is the Whole House canonical score', () => {
    assert.equal(qualitySnapshot.scoreType, 'quality-v3');
    assert.equal(qualitySnapshot.publishedScore, qualityCanonical.score);
    assert.equal(qualitySnapshot.readings.tds, qualityCanonical.readings.tds);
    assert.equal(qualitySnapshot.readings.tds, 80);
  });
  check('point readings are that tap only, and an empty point is null', () => {
    assert.equal(qualitySnapshot.pointReadings[0].ordinal, 0);
    assert.equal(qualitySnapshot.pointReadings[0].label, 'Kitchen');
    assert.equal(qualitySnapshot.pointReadings[0].readings.tds, 60);
    assert.equal(qualitySnapshot.pointReadings[1].ordinal, 1);
    assert.equal(qualitySnapshot.pointReadings[1].readings.tds, 100);
    assert.equal(qualitySnapshot.pointReadings[2].readings, null);
    assert.ok(!JSON.stringify(qualitySnapshot.pointReadings).includes('photo'));
  });

  const countryCanonical = computeCanonicalCountryScore(clone(cases.get('house')), 'japan');
  const country = await publish('house', {
    score: countryCanonical.score,
    scoreType: 'country-benchmark',
    standardKey: 'japan',
    intent: 'republish',
    idempotencyKey: 'house-japan'
  });
  const countrySnapshot = snapshotOf(country.publicationId);
  check('country publication keeps its own canonical score and the same point capture', () => {
    assert.equal(countrySnapshot.scoreType, 'country-benchmark');
    assert.equal(countrySnapshot.standardKey, 'japan');
    assert.equal(countrySnapshot.publishedScore, countryCanonical.score);
    assert.notEqual(countrySnapshot.publishedScore, countrySnapshot.pointReadings[0].readings.tds);
    assert.equal(countrySnapshot.pointReadings[0].readings.tds, 60);
    assert.equal(countrySnapshot.readings.tds, 80);
  });

  console.log('\nReplay does not rewrite the snapshot');
  cases.get('house').draft.tapData[0].standardMeasurement.tds = 999;
  cases.get('house').draft.taps[0] = 'Renamed';
  const replay = await publish('house', {
    score: 1,
    scoreType: 'country-benchmark',
    standardKey: 'japan',
    intent: 'publish',
    idempotencyKey: 'house-japan'
  });
  check('the same idempotency key returns the original point snapshot', () => {
    assert.equal(replay.reused, true);
    assert.equal(replay.publicationId, country.publicationId);
    assert.equal(snapshotOf(country.publicationId).pointReadings[0].label, 'Kitchen');
    assert.equal(snapshotOf(country.publicationId).pointReadings[0].readings.tds, 60);
    assert.equal(snapshotOf(country.publicationId).publishedScore, countryCanonical.score);
    assert.equal(store._rows.length, 2);
  });

  console.log('\nThe customer report receives frozen points, not the edited Case');
  const report = await resolveReportByToken(country.reportToken);
  check('hydration copies pointReadings and leaves the stored score', () => {
    assert.equal(report.result.waterScore, countryCanonical.score);
    assert.equal(report.result.pointReadings[1].readings.tds, 100);
    assert.equal(report.result.pointReadings[2].readings, null);
    assert.equal(cases.get('house').draft.tapData[0].standardMeasurement.tds, 999);
  });

  console.log('\nLegacy freeze is unchanged');
  const legacy = seed('legacy', [{ name: 'Tap 1', readings: measurement() }]);
  legacy.result = { waterScore: 96, publicReportToken: 'rpt-legacy-points', reportUrl: '' };
  const frozenLegacy = await publish('legacy', { score: 96, intent: 'publish', idempotencyKey: 'legacy-points' });
  const legacySnapshot = snapshotOf(frozenLegacy.publicationId);
  check('legacy publication stores no readings and no point history', () => {
    assert.equal(frozenLegacy.reused, true);
    assert.equal(legacySnapshot.scoreType, 'legacy-publication');
    assert.equal(legacySnapshot.publishedScore, 96);
    assert.equal(legacySnapshot.readings, undefined);
    assert.equal(legacySnapshot.pointReadings, undefined);
  });

  console.log('\nCanonical availability still rejects a new publication');
  seed('thin', [{ name: 'Tap 1', readings: { ph: 7.2 } }]);
  let unavailable = null;
  try {
    await publish('thin', { score: 80, intent: 'publish', idempotencyKey: 'thin-1' });
  } catch (error) {
    unavailable = error;
  }
  check('incomplete Whole House readings are still SCORE_UNAVAILABLE', () => {
    assert.equal(unavailable && unavailable.code, 'SCORE_UNAVAILABLE');
    assert.ok(!store._rows.some((row) => row.caseId === 'thin'));
  });
  seed('mismatch', [{ name: 'Tap 1', readings: measurement() }]);
  let mismatch = null;
  try {
    await publish('mismatch', {
      score: 1,
      scoreType: 'country-benchmark',
      standardKey: 'thailand',
      intent: 'publish',
      idempotencyKey: 'mismatch-1'
    });
  } catch (error) {
    mismatch = error;
  }
  check('a country score that does not match the canonical score is still rejected', () => {
    assert.equal(mismatch && mismatch.code, 'SCORE_MISMATCH');
    assert.ok(!store._rows.some((row) => row.caseId === 'mismatch'));
  });

  console.log('\nSnapshot size limit drops point history instead of truncating it');
  const bulkyPoints = Array.from({ length: 200 }, (_, ordinal) => ({
    ordinal,
    label: `Point ${ordinal} ${'x'.repeat(70)}`,
    readings: measurement()
  }));
  const baseFields = {
    publishedScore: 88,
    publicReportToken: 'rpt-size',
    publicationId: 'pub-size',
    scoreType: 'quality-v3',
    readings: measurement()
  };
  let tooLarge = null;
  try {
    serializeSnapshot(buildSnapshot({ ...baseFields, pointReadings: bulkyPoints }));
  } catch (error) {
    tooLarge = error;
  }
  check('point readings that exceed the cap are rejected by the serializer', () => {
    assert.equal(tooLarge && tooLarge.code, 'SNAPSHOT_TOO_LARGE');
    assert.ok(JSON.stringify(buildSnapshot(baseFields)).length < MAX_SNAPSHOT_CHARS);
  });
  seed('bulky', Array.from({ length: 200 }, (_, ordinal) => ({
    name: `Point ${ordinal} ${'x'.repeat(70)}`,
    readings: measurement()
  })));
  const bulkyCanonical = computeCanonicalScore(clone(cases.get('bulky')));
  const bulky = await publish('bulky', {
    score: bulkyCanonical.score,
    intent: 'publish',
    idempotencyKey: 'bulky-1'
  });
  const bulkySnapshot = snapshotOf(bulky.publicationId);
  check('the Whole House publication is kept and point browsing is absent', () => {
    assert.equal(bulkySnapshot.publishedScore, bulkyCanonical.score);
    assert.equal(bulkySnapshot.scoreType, 'quality-v3');
    assert.equal(bulkySnapshot.readings.ph, bulkyCanonical.readings.ph);
    assert.equal(bulkySnapshot.pointReadings, undefined);
    assert.ok(JSON.stringify(bulkySnapshot).length <= MAX_SNAPSHOT_CHARS);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
