/**
 * PR3 smoke: score.js prefers standardMeasurement, falls back to legacy
 * meterReadings/chlorineReadings when standardMeasurement is absent.
 * Run: node scripts/test-pr3-score-standard-source.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'flows', 'score.js'), 'utf8');
const sandbox = { console, document: { getElementById: () => null } };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'score.js' });

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

// 1) readingsFromSingleTap prefers standardMeasurement per-field, falls back per-field.
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

// 2) readingsFromSingleTap falls back entirely when standardMeasurement absent.
{
  const tap = { meterReadings: { ph: 6.9, tds: 410 }, chlorineReadings: { chlorine: 1.1 } };
  const out = sandbox.readingsFromSingleTap(tap, {});
  assertClose(out.ph, 6.9, 'legacy-only tap: ph from meterReadings');
  assertClose(out.tds, 410, 'legacy-only tap: tds from meterReadings');
  assertClose(out.chlorine, 1.1, 'legacy-only tap: chlorine from chlorineReadings');
}

// 3) hasTapReadingSource: empty standardMeasurement does not count as a source on its own.
{
  assert(sandbox.hasTapReadingSource({ standardMeasurement: {} }) === false, 'empty standardMeasurement is not a reading source');
  assert(sandbox.hasTapReadingSource({ standardMeasurement: { ph: 7 } }) === true, 'non-empty standardMeasurement is a reading source');
  assert(sandbox.hasTapReadingSource({ meterReadings: { ph: 7 } }) === true, 'legacy meterReadings is still a reading source');
  assert(sandbox.hasTapReadingSource({}) === false, 'tap with nothing is not a reading source');
}

// 4) readingsFromTapData averages standardMeasurement across taps, falls back per-key.
{
  const tapData = [
    { standardMeasurement: { ph: 7.0, tds: 300 } },
    { standardMeasurement: { ph: 7.2 }, meterReadings: { tds: 500 } }
  ];
  const out = sandbox.readingsFromTapData(tapData);
  assertClose(out.ph, 7.1, 'aggregate ph averages standardMeasurement across taps');
  assertClose(out.tds, 300, 'aggregate tds uses standardMeasurement rows only (legacy row excluded from that key avg)');
}

// 5) readingsFromTapData falls back to legacy entirely when no tap has standardMeasurement.
{
  const tapData = [{ meterReadings: { ph: 6.8 } }, { meterReadings: { ph: 7.0 } }];
  const out = sandbox.readingsFromTapData(tapData);
  assertClose(out.ph, 6.9, 'aggregate ph falls back to legacy meterReadings average');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
