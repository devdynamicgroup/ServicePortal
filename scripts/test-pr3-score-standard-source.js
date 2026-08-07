/**
 * PR3 smoke: score.js prefers standardMeasurement, falls back to legacy
 * meterReadings/chlorineReadings when standardMeasurement is absent.
 * Run: node scripts/test-pr3-score-standard-source.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const files = [
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
  'src/js/score/production/computeProductionScore.js',
  'src/js/score/benchmark/registry.js',
  'src/js/score/benchmark/thailand/limits.js',
  'src/js/score/benchmark/thailand/weights.js',
  'src/js/score/benchmark/thailand/score.js',
  'src/js/score/benchmark/who/limits.js',
  'src/js/score/benchmark/who/weights.js',
  'src/js/score/benchmark/who/score.js',
  'src/js/score/benchmark/eu/limits.js',
  'src/js/score/benchmark/eu/weights.js',
  'src/js/score/benchmark/eu/score.js',
  'src/js/score/benchmark/japan/limits.js',
  'src/js/score/benchmark/japan/weights.js',
  'src/js/score/benchmark/japan/score.js',
  'src/js/score/benchmark/usEpa/limits.js',
  'src/js/score/benchmark/usEpa/weights.js',
  'src/js/score/benchmark/usEpa/score.js',
  'src/js/flows/score.js'
];

const sandbox = { console, document: { getElementById: () => null }, S: {}, t: (k) => k };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of files) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}
function assertClose(actual, expected, msg) {
  assert(Math.abs(actual - expected) < 1e-9, `${msg} (got ${actual}, expected ${expected})`);
}

console.log('PR3 score.js standardMeasurement source');

{
  const tap = {
    standardMeasurement: { ph: 7.1, tds: 300 },
    meterReadings: { ph: 6.0, tds: 999, turbidity: 1.5 },
    chlorineReadings: { freeChlorine: 0.4 }
  };
  const out = sandbox.readingsFromSingleTap(tap, {});
  assertClose(out.ph, 7.1, 'standardMeasurement ph wins over legacy meterReadings');
  assertClose(out.tds, 300, 'standardMeasurement tds wins over legacy meterReadings');
  assertClose(out.turbidity, 1.5, 'legacy meterReadings fills field missing from standardMeasurement');
  assertClose(out.chlorine, 0.4, 'legacy chlorineReadings fills chlorine when absent from standardMeasurement');
}

{
  const tap = { meterReadings: { ph: 6.9, tds: 410 }, chlorineReadings: { chlorine: 1.1 } };
  const out = sandbox.readingsFromSingleTap(tap, {});
  assertClose(out.ph, 6.9, 'legacy-only tap: ph from meterReadings');
  assertClose(out.tds, 410, 'legacy-only tap: tds from meterReadings');
  assertClose(out.chlorine, 1.1, 'legacy-only tap: chlorine from chlorineReadings');
}

{
  assert(sandbox.hasTapReadingSource({ standardMeasurement: {} }) === false, 'empty standardMeasurement is not a reading source');
  assert(sandbox.hasTapReadingSource({ standardMeasurement: { ph: 7 } }) === true, 'non-empty standardMeasurement is a reading source');
  assert(sandbox.hasTapReadingSource({ meterReadings: { ph: 7 } }) === true, 'legacy meterReadings is still a reading source');
  assert(sandbox.hasTapReadingSource({}) === false, 'tap with nothing is not a reading source');
}

{
  const tapData = [
    { standardMeasurement: { ph: 7.0, tds: 300 } },
    { standardMeasurement: { ph: 7.2 }, meterReadings: { tds: 500 } }
  ];
  const out = sandbox.readingsFromTapData(tapData);
  assertClose(out.ph, 7.1, 'aggregate ph averages standardMeasurement across taps');
  assertClose(out.tds, 300, 'aggregate tds uses standardMeasurement rows only (legacy row excluded from that key avg)');
}

{
  const tapData = [{ meterReadings: { ph: 6.8 } }, { meterReadings: { ph: 7.0 } }];
  const out = sandbox.readingsFromTapData(tapData);
  assertClose(out.ph, 6.9, 'aggregate ph falls back to legacy meterReadings average');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

