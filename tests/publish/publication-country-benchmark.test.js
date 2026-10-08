/**
 * Country-benchmark publication: the selected country engine's score can be
 * published as the Water Score, verified and frozen by the server.
 * Run: node tests/publish/publication-country-benchmark.test.js
 *
 * In-memory ledger; services/notion/clients is replaced with an in-memory fake
 * before workflow-service is loaded, so the real publish and Complete entry
 * points run without Notion. Expected scores are checked against the browser's
 * own engine files -- no formula lives in this test.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');
const clientsPath = require.resolve(path.join(ROOT, 'services/notion/clients'));
const db = new Map();
const pointerWrites = [];
require.cache[clientsPath] = {
  id: clientsPath,
  filename: clientsPath,
  loaded: true,
  exports: {
    async getClient(id) {
      const job = db.get(id);
      if (!job) throw new Error('not found');
      return JSON.parse(JSON.stringify(job));
    },
    async updateClient(id, patch) {
      const job = db.get(id);
      if (patch.publicReportToken !== undefined) pointerWrites.push({ id, patch });
      job.workflow = { ...job.workflow, ...(patch.caseWorkflowStatus ? { status: patch.caseWorkflowStatus } : {}) };
      job.result = {
        ...job.result,
        ...(patch.latestWaterScore !== undefined ? { waterScore: patch.latestWaterScore } : {}),
        ...(patch.publicReportToken !== undefined ? { publicReportToken: patch.publicReportToken } : {}),
        ...(patch.reportUrl !== undefined ? { reportUrl: patch.reportUrl } : {}),
        ...(patch.complianceStatus !== undefined ? { complianceStatus: patch.complianceStatus } : {})
      };
      return JSON.parse(JSON.stringify(job));
    },
    async findClientByFeedbackToken() { return null; },
    async findClientByReportToken() { return null; },
    async getAllClients() { return Array.from(db.values()); }
  }
};

const { publishCaseScore, closeCase } = require(path.join(ROOT, 'services/workflow-service'));
const {
  createOrReusePublication,
  resolveReportByToken,
  setPublicationStore
} = require(path.join(ROOT, 'services/score-publication-service'));
const { applyPublicationToJob } = require(path.join(ROOT, 'services/score-publication-snapshot'));
const { createMemoryPublicationStore } = require(path.join(ROOT, 'services/score-publication-store-memory'));
const { computeCanonicalScore, computeCanonicalCountryScore } = require(path.join(ROOT, 'services/canonical-score'));

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

// The browser's own engines, loaded the way the page loads them.
const ENGINE_KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];
const browser = { console: { log() {}, warn() {}, error() {}, info() {} } };
browser.window = browser;
browser.globalThis = browser;
vm.createContext(browser);
['src/js/score/util/clamp.js', 'src/js/score/util/benchmarkMetadata.js', 'src/js/score/validation/measurementValidator.js',
  'src/js/score/production/computeProductionScore.js', 'src/js/score/production/computeQualityScoreV2.js', 'src/js/score/benchmark/registry.js',
  ...ENGINE_KEYS.flatMap((key) => ['limits', 'weights', 'score'].map((file) => `src/js/score/benchmark/${key}/${file}.js`))
].forEach((rel) => vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), browser, { filename: rel }));
const browserScore = (key, readings) => browser.WaterScoreBenchmarkRegistry.calculate(key, readings).score;

// Known input where the five engines disagree (Japan strictest).
const READINGS = { ph: 7.6, tds: 102, chlorine: 0.02, turbidity: 0.7, orp: 174, do: 5.7, temp: 27.3 };
const EXPECTED = { quality: 64, thailand: 54, japan: 51, who: 54, eu: 54, usEpa: 57 };

let store;
function reset() {
  db.clear();
  pointerWrites.length = 0;
  store = createMemoryPublicationStore();
  setPublicationStore(store);
}
function seed(id, readings = READINGS, overrides = {}) {
  const job = {
    id,
    notionId: id,
    name: 'Country benchmark fixture',
    workflow: { status: 'in_progress' },
    status: 'in_progress',
    result: { waterScore: null, publicReportToken: '', reportUrl: '' },
    notification: { status: 'not_sent' },
    feedback: { token: 'fb', status: 'not_sent' },
    line: {},
    review: {},
    draft: { taps: ['Tap 1'], fields: {}, tapData: [{ photos: { tapphoto: 'photo-1' }, standardMeasurement: { ...readings } }] },
    ...overrides
  };
  db.set(id, job);
  return job;
}
const country = (standardKey, score, extra = {}) => ({ scoreType: 'country-benchmark', standardKey, score, intent: 'publish', ...extra });
async function attempt(fn) {
  try { return { result: await fn() }; } catch (error) { return { error }; }
}
const snapshotOf = (publicationId) => store._rows.find((row) => row.publicationId === publicationId).snapshot;
// Case ids must look like Notion page ids (32 hex characters).
const ID = (letter) => letter.charCodeAt(0).toString(16).padStart(2, '0').repeat(16);

async function main() {
  console.log('\nFixture: server and browser run the same engines');
  const fixtureJob = seed(ID('0'));
  assert(computeCanonicalScore(fixtureJob).score === EXPECTED.quality, `Quality V3 is ${EXPECTED.quality}`);
  ENGINE_KEYS.forEach((key) => {
    const server = computeCanonicalCountryScore(fixtureJob, key).score;
    assert(server === EXPECTED[key] && server === browserScore(key, READINGS), `${key}: server ${server} === browser ${browserScore(key, READINGS)} === ${EXPECTED[key]}`);
  });

  console.log('\n1. Japan publication');
  reset();
  seed(ID('a'));
  const japan = await publishCaseScore(ID('a'), country('japan', EXPECTED.japan, { idempotencyKey: 'a-1', complianceStatus: 'PASS' }));
  const japanSnapshot = JSON.parse(JSON.stringify(snapshotOf(japan.publicationId)));
  assert(japan.ok === true && japan.score === EXPECTED.japan && japan.reused === false, `published ${japan.score}`);
  assert(japanSnapshot.scoreType === 'country-benchmark' && japanSnapshot.standardKey === 'japan', 'snapshot is a country-benchmark publication for japan');
  assert(japanSnapshot.publishedScore === EXPECTED.japan, `snapshot score is the Japan engine's ${EXPECTED.japan}, not Quality V3 ${EXPECTED.quality}`);
  assert(['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do'].every((key) => japanSnapshot.readings[key] === READINGS[key]), 'readings are frozen in the snapshot');
  assert(japanSnapshot.benchmarkVersion === 'japan-v3', `benchmark version recorded (${japanSnapshot.benchmarkVersion})`);
  assert(japanSnapshot.complianceStatus === 'CRITICAL', `compliance is the Japan engine's own result (${japanSnapshot.complianceStatus}), not the client's "PASS"`);
  assert(japanSnapshot.scorePayload.classifications.chlorine === 'CRITICAL' && japanSnapshot.scorePayload.classifications.do === 'NOT_EVALUATED', 'the engine classifications are stored with it');
  assert(japan.scoreType === 'country-benchmark' && japan.standardKey === 'japan' && Boolean(japan.reportToken), 'response carries type, standard, and token');
  assert(db.get(ID('a')).result.waterScore === EXPECTED.japan && db.get(ID('a')).result.publicReportToken === japan.reportToken, 'Case pointer follows the publication');

  console.log('\n2. Thailand publication uses the Thailand engine');
  reset();
  seed(ID('b'));
  const thai = await publishCaseScore(ID('b'), country('thailand', EXPECTED.thailand));
  assert(thai.score === EXPECTED.thailand && snapshotOf(thai.publicationId).standardKey === 'thailand', `Thailand publishes ${thai.score}`);
  assert(thai.score !== EXPECTED.quality, 'it is not the Quality V3 score');
  const qualityAsThai = await attempt(() => publishCaseScore(seed(ID('c')).id, country('thailand', EXPECTED.quality)));
  assert(qualityAsThai.error?.code === 'SCORE_MISMATCH', 'submitting the Quality V3 number as a Thailand score is rejected');

  console.log('\n3. Score mismatch');
  reset();
  seed(ID('d'));
  const wrong = await attempt(() => publishCaseScore(ID('d'), country('japan', 99)));
  assert(wrong.error?.statusCode === 409 && wrong.error?.code === 'SCORE_MISMATCH', 'japan + 99 -> 409 SCORE_MISMATCH');
  const otherEngine = await attempt(() => publishCaseScore(ID('d'), country('japan', EXPECTED.usEpa)));
  assert(otherEngine.error?.code === 'SCORE_MISMATCH', "another country's score under japan -> SCORE_MISMATCH");
  assert(store._rows.length === 0 && pointerWrites.length === 0, 'nothing created or written on rejection');

  console.log('\n4. Invalid standard');
  for (const bad of ['something-invalid', '', 'quality-v3', 'constructor', 'JAPAN']) {
    const res = await attempt(() => publishCaseScore(ID('d'), country(bad, EXPECTED.japan)));
    assert(res.error?.statusCode === 400 && res.error?.code === 'INVALID_STANDARD', `standardKey "${bad}" -> 400 INVALID_STANDARD`);
  }
  assert(store._rows.length === 0 && pointerWrites.length === 0, 'nothing created for an invalid standard');

  console.log('\n5. Frozen publication');
  reset();
  seed(ID('e'));
  const frozen = await publishCaseScore(ID('e'), country('japan', EXPECTED.japan));
  db.get(ID('e')).draft.tapData[0].standardMeasurement = { ...READINGS, chlorine: 0.35, orp: 400 };
  assert(computeCanonicalCountryScore(db.get(ID('e')), 'japan').score !== EXPECTED.japan, 'the live Japan score has moved after the edit');
  const report = await resolveReportByToken(frozen.reportToken);
  assert(report.result.waterScore === EXPECTED.japan, `the publication still resolves to ${EXPECTED.japan}`);
  assert(report.result.scoreType === 'country-benchmark' && report.result.standardKey === 'japan', 'the report carries the published standard');
  assert(report.draft.tapData[0].standardMeasurement.chlorine === 0.02 && report.draft.tapData[0].standardMeasurement.orp === 174, 'the report serves the frozen readings, not the edited Case');
  assert(report.draft.tapData[0].photos.tapphoto === 'photo-1', 'photos are kept');
  assert(computeCanonicalCountryScore(report, 'japan').score === EXPECTED.japan, 'the frozen readings still score the published number');

  console.log('\n6. Standard change creates a new publication');
  reset();
  seed(ID('f'));
  const first = await publishCaseScore(ID('f'), country('japan', EXPECTED.japan, { idempotencyKey: 'f-1' }));
  const firstSnapshot = JSON.stringify(snapshotOf(first.publicationId));
  const second = await publishCaseScore(ID('f'), country('thailand', EXPECTED.thailand, { idempotencyKey: 'f-2' }));
  assert(second.reused === false && second.publicationId !== first.publicationId && second.reportToken !== first.reportToken, 'Thailand is a new publication with its own link');
  assert(store._rows.length === 2, 'two publications exist');
  assert(second.score === EXPECTED.thailand && snapshotOf(second.publicationId).standardKey === 'thailand', `publication B is Thailand ${second.score}`);
  assert(JSON.stringify(snapshotOf(first.publicationId)) === firstSnapshot, 'publication A (Japan) is unchanged');
  assert((await resolveReportByToken(first.reportToken)).result.waterScore === EXPECTED.japan, `Japan link still ${EXPECTED.japan}`);
  assert((await resolveReportByToken(second.reportToken)).result.waterScore === EXPECTED.thailand, `Thailand link is ${EXPECTED.thailand}`);
  assert(db.get(ID('f')).result.waterScore === EXPECTED.thailand, 'Case pointer is the latest publication');
  const sameKey = await publishCaseScore(ID('f'), country('usEpa', EXPECTED.usEpa, { idempotencyKey: 'f-2' }));
  assert(sameKey.reused === false && sameKey.standardKey === 'usEpa' && store._rows.length === 3, 'a client key reused for another standard is not a replay');

  console.log('\n7. Existing Quality V3 publications and requests are unchanged');
  reset();
  seed(ID('g'));
  const quality = await publishCaseScore(ID('g'), { score: EXPECTED.quality, intent: 'publish', complianceStatus: 'FAIL', idempotencyKey: 'g-1' });
  const qualitySnapshot = snapshotOf(quality.publicationId);
  assert(quality.score === EXPECTED.quality && qualitySnapshot.scoreType === 'quality-v3' && qualitySnapshot.standardKey === undefined, 'a payload without scoreType publishes Quality V3 as before');
  assert(qualitySnapshot.complianceStatus === 'FAIL' && quality.standardKey === null, 'its compliance and response are as before');
  const qualityReport = await resolveReportByToken(quality.reportToken);
  assert(qualityReport.result.waterScore === EXPECTED.quality && qualityReport.result.standardKey === undefined, `old publication resolves to ${EXPECTED.quality}`);
  const again = await publishCaseScore(ID('g'), { score: 12, intent: 'publish', idempotencyKey: 'g-2' });
  assert(again.reused === true && again.publicationId === quality.publicationId, 'a Quality V3 publish request still reuses it');
  const upgrade = await publishCaseScore(ID('g'), country('japan', EXPECTED.japan, { idempotencyKey: 'g-3' }));
  assert(upgrade.reused === false && upgrade.publicationId !== quality.publicationId, 'a country request is not answered with the Quality V3 publication');
  assert((await resolveReportByToken(quality.reportToken)).result.waterScore === EXPECTED.quality, `the Quality V3 link still ${EXPECTED.quality}`);
  const stored = applyPublicationToJob(seed(ID('h')), { snapshot: { publishedScore: 64, publicReportToken: 'rpt-old', publicationId: 'pub-old' } });
  assert(stored.result.waterScore === 64 && stored.result.standardKey === undefined, 'a stored snapshot with no scoreType/standardKey resolves as before');

  console.log('\n8. Idempotency');
  reset();
  seed(ID('i'));
  const one = await publishCaseScore(ID('i'), country('japan', EXPECTED.japan, { idempotencyKey: 'i-1' }));
  const replay = await publishCaseScore(ID('i'), country('japan', 1, { idempotencyKey: 'i-1' }));
  assert(replay.reused === true && replay.publicationId === one.publicationId && replay.score === EXPECTED.japan, 'same key + same standard replays the publication');
  const repeat = await publishCaseScore(ID('i'), country('japan', EXPECTED.japan, { idempotencyKey: 'i-2' }));
  assert(repeat.reused === true && repeat.publicationId === one.publicationId, 'publishing Japan again reuses the Japan publication');
  assert(store._rows.length === 1, 'no duplicate record');
  const republish = await publishCaseScore(ID('i'), country('japan', EXPECTED.japan, { intent: 'republish', idempotencyKey: 'i-3' }));
  assert(republish.reused === false && store._rows.length === 2, 'an explicit republish still creates a new record');

  console.log('\nAvailability follows the selected engine');
  reset();
  const noDo = { ...READINGS };
  delete noDo.do;
  seed(ID('j'), noDo);
  assert(computeCanonicalScore(db.get(ID('j'))).score === null, 'Quality V3 is unavailable without DO');
  const japanNoDo = await attempt(() => publishCaseScore(ID('j'), country('japan', browserScore('japan', noDo))));
  assert(japanNoDo.result?.ok === true && japanNoDo.result.score === browserScore('japan', noDo), 'Japan (does not use DO) still publishes');
  const noDoReport = await resolveReportByToken(japanNoDo.result.reportToken);
  assert(noDoReport.draft.tapData[0].standardMeasurement.do === undefined && noDoReport.draft.tapData[0].standardMeasurement.ph === READINGS.ph, 'its frozen readings are served without inventing DO');
  const qualityNoDo = await attempt(() => publishCaseScore(seed(ID('k'), noDo).id, { score: 60, intent: 'publish' }));
  assert(qualityNoDo.error?.code === 'SCORE_UNAVAILABLE', 'a Quality V3 request for the same Case is still SCORE_UNAVAILABLE');
  const noPh = { ...READINGS };
  delete noPh.ph;
  seed(ID('l'), noPh);
  const before = store._rows.length;
  const unavailable = await attempt(() => publishCaseScore(ID('l'), country('japan', 50)));
  assert(unavailable.error?.statusCode === 409 && unavailable.error?.code === 'SCORE_UNAVAILABLE', 'a reading the engine requires is missing -> 409 SCORE_UNAVAILABLE');
  assert(store._rows.length === before && !pointerWrites.some((w) => w.id === ID('l')), 'no record, token, or pointer for it');

  console.log('\nLegacy pointer and Complete');
  reset();
  seed(ID('m'), READINGS, { result: { waterScore: 96, publicReportToken: 'rpt-legacy', reportUrl: '' } });
  const fromLegacy = await createOrReusePublication({ job: JSON.parse(JSON.stringify(db.get(ID('m')))), caseId: ID('m'), payload: country('japan', EXPECTED.japan) });
  assert(fromLegacy.reused === false && fromLegacy.score === EXPECTED.japan && fromLegacy.reportToken !== 'rpt-legacy', 'a country request on a legacy-pointer Case gets its own publication');
  const legacyRow = store._rows.find((row) => row.publicReportToken === 'rpt-legacy');
  assert(legacyRow && legacyRow.snapshot.scoreType === 'legacy-publication' && legacyRow.snapshot.publishedScore === 96 && legacyRow.snapshot.readings === undefined, 'the legacy score is still frozen as before, without readings');
  reset();
  seed(ID('n'));
  const closed = await closeCase(ID('n'), { score: EXPECTED.usEpa, scoreType: 'country-benchmark', standardKey: 'usEpa', completedBy: 'QA' });
  assert(closed.ok === true && store._rows.length === 1 && store._rows[0].snapshot.standardKey === 'usEpa' && store._rows[0].publishedScore === EXPECTED.usEpa, 'Complete passes the standard through and publishes the US score');
  reset();
  seed(ID('o'));
  const closedQuality = await closeCase(ID('o'), { score: EXPECTED.quality, completedBy: 'QA' });
  assert(closedQuality.ok === true && store._rows[0].snapshot.scoreType === 'quality-v3', 'Complete without a standard still publishes Quality V3');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
