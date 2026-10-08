/**
 * Zone Country Benchmark population.
 * All keeps the whole-house readings. A selected zone scores only its own readings.
 * Run: node tests/score/zone-country-score.test.js
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

const ROOT = path.join(__dirname, '../..');
const FILES = [
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
  'src/js/score/validation/measurementValidator.js',
  'src/js/score/production/computeProductionScore.js',
  'src/js/score/production/computeQualityScoreV2.js',
  'src/js/score/benchmark/registry.js',
  ...['thailand', 'who', 'eu', 'japan', 'usEpa'].flatMap(k =>
    ['limits', 'weights', 'score'].map(f => `src/js/score/benchmark/${k}/${f}.js`)),
  'src/js/flows/score.js'
];

const sandbox = {
  console: { log() {}, warn() {}, error() {}, info() {} },
  document: {
    getElementById: () => null,
    querySelector: () => null,
    addEventListener() {},
    querySelectorAll: () => []
  },
  navigator: { userAgent: 'node' },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  performance: { now: () => 0 },
  requestAnimationFrame: () => 0,
  S: {
    activeJob: null, tapData: [], taps: [], scoreStandardKey: 'thailand',
    scoreTapFilter: 'all', publicScoreView: false, comparisonScoreResult: null,
    currentScoreResult: null, scoreBaseReadings: null
  },
  t: (k) => k
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const rel of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}

const HOUSE = [
  { standardMeasurement: { ph: 7.24, tds: 105, chlorine: 0.82, turbidity: 0.56, orp: 591.6, do: 4.97, temp: 0 } },
  { standardMeasurement: { ph: 7.03, tds: 96, chlorine: 0.04, turbidity: 0.32, orp: 529.1, do: 4.37 } },
  { standardMeasurement: { ph: 7.37, tds: 95, chlorine: 0.03, turbidity: 0.2, orp: 355.1, do: 4.74 } }
];
const NAMES = ['Room 1', 'Room 2', 'Room 3'];
const COUNTRIES = ['thailand', 'japan', 'who', 'eu', 'usEpa'];
const EXPECTED = {
  all: { thailand: 91, japan: 92, who: 84, eu: 87, usEpa: 86 },
  'Room 1': { thailand: 78, japan: 78, who: 74, eu: 75, usEpa: 77 },
  'Room 2': { thailand: 75, japan: 72, who: 70, eu: 67, usEpa: 74 },
  'Room 3': { thailand: 79, japan: 75, who: 74, eu: 71, usEpa: 78 }
};

function houseJob(extra = {}) {
  return {
    id: 'h6',
    notionId: 'h6',
    draft: { tapData: HOUSE, taps: NAMES, fields: {}, scoreStandardKey: 'thailand' },
    result: {},
    ...extra
  };
}

function useHouse() {
  const job = houseJob();
  sandbox.S.activeJob = job;
  sandbox.S.taps = NAMES.slice();
  sandbox.S.publicScoreView = false;
  sandbox.S.scoreTapFilter = 'all';
  sandbox.S.scoreStandardKey = 'thailand';
  return job;
}

function countryScore() {
  return sandbox.S.comparisonScoreResult && sandbox.S.comparisonScoreResult.score;
}

console.log('1. Whole house stays on the existing pool');
{
  useHouse();
  sandbox.setScoreReferenceStandard('thailand');
  assert(countryScore() === 91, `Thailand all ${countryScore()}`);
  assert(sandbox.S.currentScoreResult.computedScore === 84, 'Quality of the house pool stays 84');
  assert(sandbox.S.displayedScore.source === 'quality-v3', 'staff gauge source stays Quality');
  assert(sandbox.S.displayedScore.score === 84, 'staff gauge stays the whole-house Quality score');
  for (const key of COUNTRIES) {
    sandbox.S.scoreTapFilter = 'all';
    sandbox.setScoreReferenceStandard(key);
    assert(countryScore() === EXPECTED.all[key], `${key} all ${countryScore()}`);
    assert(sandbox.S.currentScoreResult.computedScore === 84, `${key} switch does not retarget Quality`);
  }
}

function heroScore() {
  return sandbox.S.displayedScore && sandbox.S.displayedScore.score;
}

console.log('2–4. Each room hero is that room country score');
{
  useHouse();
  sandbox.setScoreReferenceStandard('thailand');
  for (const room of NAMES) {
    sandbox.setScoreTapFilter(room);
    assert(sandbox.S.scoreTapFilter === room, `filter stays ${room}`);
    for (const key of COUNTRIES) {
      sandbox.setScoreReferenceStandard(key);
      assert(sandbox.S.scoreTapFilter === room, `${room} country switch keeps the zone`);
      assert(countryScore() === EXPECTED[room][key], `${room} ${key} comparison ${countryScore()} expected ${EXPECTED[room][key]}`);
      assert(heroScore() === EXPECTED[room][key], `${room} ${key} hero ${heroScore()} expected ${EXPECTED[room][key]}`);
      assert(sandbox.S.displayedScore.source === 'country-benchmark', `${room} ${key} hero source is the country score`);
      assert(sandbox.S.currentScoreResult.computedScore === 84, `${room} ${key} Quality stays 84`);
      assert(sandbox.S.scoreVal === 84, `${room} ${key} share payload stays Quality 84`);
      const roomReadings = sandbox.readingsForCountryBenchmark(sandbox.S.activeJob);
      const direct = sandbox.getCountryBenchmarkScore(roomReadings, key).score;
      assert(direct === heroScore(), `${room} ${key} hero uses getCountryBenchmarkScore on zone readings`);
    }
  }
  sandbox.setScoreTapFilter('Room 2');
  sandbox.setScoreReferenceStandard('thailand');
  assert(heroScore() === 75, 'Room 2 Thailand hero is 75');
  assert(heroScore() !== EXPECTED.all.thailand, 'Room 2 hero is not the house Thailand score');
  assert(heroScore() !== EXPECTED['Room 1'].thailand, 'Room 2 hero is not Room 1');
  sandbox.setScoreTapFilter('all');
  sandbox.setScoreReferenceStandard('thailand');
  assert(countryScore() === 91, 'returning to all restores Thailand comparison 91');
  assert(heroScore() === 84, 'returning to all restores the Quality hero');
  assert(sandbox.S.displayedScore.source === 'quality-v3', 'all hero source is Quality');
}

console.log('2b. Switching keeps the other selection');
{
  useHouse();
  sandbox.setScoreReferenceStandard('thailand');
  assert(heroScore() === 84 && countryScore() === 91, 'All Thailand hero is Quality 84 and comparison is 91');
  sandbox.setScoreTapFilter('Room 1');
  assert(heroScore() === 78, 'All Thailand → Room 1 hero 78');
  sandbox.setScoreReferenceStandard('japan');
  assert(sandbox.S.scoreTapFilter === 'Room 1', 'Japan switch keeps Room 1');
  assert(heroScore() === 78, 'Room 1 Japan hero 78');
  sandbox.setScoreReferenceStandard('usEpa');
  assert(heroScore() === 77, 'Room 1 US hero 77');
  sandbox.setScoreReferenceStandard('japan');
  sandbox.setScoreTapFilter('Room 2');
  assert(sandbox.S.scoreStandardKey === 'japan', 'Room 2 keeps Japan');
  assert(heroScore() === 72, 'Room 1 Japan → Room 2 hero 72');
  assert(heroScore() !== 92, 'Room 2 hero is not whole-house Japan');
  sandbox.setScoreTapFilter('all');
  assert(countryScore() === 92, 'Room 2 Japan → All comparison 92');
  assert(heroScore() === 84 && sandbox.S.displayedScore.source === 'quality-v3', 'All hero returns to Quality 84');
}

console.log('5. One location stays on Quality');
{
  const job = {
    id: 'one-location',
    notionId: 'one-location',
    draft: {
      taps: ['Faucet'],
      fields: {},
      scoreStandardKey: 'thailand',
      tapData: [HOUSE[0]]
    },
    result: {}
  };
  sandbox.S.activeJob = job;
  sandbox.S.taps = ['Faucet'];
  sandbox.S.publicScoreView = false;
  sandbox.S.scoreTapFilter = 'Faucet';
  sandbox.setScoreReferenceStandard('thailand');
  const quality = sandbox.S.currentScoreResult.computedScore;
  assert(sandbox.S.displayedScore.source === 'quality-v3', 'one location hero source is Quality');
  assert(heroScore() === quality, `one location hero is Quality ${quality}`);
  assert(sandbox.S.scoreVal === quality, 'one location share payload stays Quality');
  assert(countryScore() === 78, `one location Thailand comparison stays 78 (got ${countryScore()})`);
  sandbox.setScoreReferenceStandard('japan');
  assert(sandbox.S.scoreTapFilter === 'Faucet', 'country switch keeps the single location');
  assert(sandbox.S.displayedScore.source === 'quality-v3', 'one location stays Quality after Japan');
  assert(heroScore() === quality, 'one location hero does not become the Japan score');
  assert(countryScore() === 78, `one location Japan comparison is 78 (got ${countryScore()})`);
}

console.log('6. Empty zone does not inherit the house score');
{
  const job = {
    id: 'empty-zone',
    notionId: 'empty-zone',
    draft: {
      taps: ['Faucet', 'Empty'],
      fields: {},
      scoreStandardKey: 'thailand',
      tapData: [
        HOUSE[0],
        { tasks: {}, photos: {} }
      ]
    },
    result: {}
  };
  sandbox.S.activeJob = job;
  sandbox.S.taps = ['Faucet', 'Empty'];
  sandbox.S.publicScoreView = false;
  sandbox.S.scoreTapFilter = 'all';
  sandbox.setScoreReferenceStandard('thailand');
  const house = countryScore();
  assert(house === 78, `house of the one complete room is 78 (got ${house})`);
  sandbox.setScoreTapFilter('Empty');
  assert(countryScore() == null, `empty zone country score is null (got ${countryScore()})`);
  assert(heroScore() == null, `empty zone hero is null (got ${heroScore()})`);
  assert(heroScore() !== house && heroScore() !== 84, 'empty zone hero is not the house country or Quality score');
  assert(sandbox.S.displayedScore.showScore === false, 'empty zone uses the incomplete hero');
  const population = sandbox.readingsForCountryBenchmark(job);
  assert(Object.keys(population).length === 0, 'empty zone population is empty');
  const shown = sandbox.getRoomReadings('Empty');
  assert(shown.ph === 7.24 && shown.tds === 105, 'measurement fallback for an empty zone is unchanged');
  sandbox.setScoreTapFilter('Faucet');
  assert(countryScore() === 78, 'the complete zone still scores itself');
}

console.log('7. Published gauge stays the published integer');
{
  const job = houseJob();
  job.result = { waterScore: 51, complianceStatus: 'WARNING', scoreType: 'country-benchmark', standardKey: 'japan' };
  sandbox.S.activeJob = job;
  sandbox.S.taps = NAMES.slice();
  sandbox.S.publicScoreView = true;
  sandbox.S.scoreTapFilter = 'all';
  sandbox.setScoreReferenceStandard('japan');
  assert(sandbox.S.displayedScore.score === 51, 'published gauge is 51');
  assert(sandbox.S.displayedScore.source === 'published', 'source stays published');
  assert(countryScore() === 92, `published view all Japan comparison is 92 (got ${countryScore()})`);
  sandbox.setScoreTapFilter('Room 1');
  assert(sandbox.S.displayedScore.score === 51, 'selecting a room does not replace the published gauge');
  assert(sandbox.S.displayedScore.source === 'published', 'source stays published after the zone change');
  assert(countryScore() === 78, `Room 1 Japan comparison is 78 (got ${countryScore()})`);
  assert(job.result.waterScore === 51, 'publication payload is untouched');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
