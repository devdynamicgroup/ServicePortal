/**
 * MeasurementValidator input-contract coverage (M4 / M7 / M8 hardening).
 * Proves invalid/implausible raw values never reach a scoring engine as a
 * silently-corrupted number. Does not touch the frozen scoring engines.
 * Run: node tests/score/measurement-validation.test.js
 */
const path = require('path');
const MeasurementValidator = require(path.join(__dirname, '../../src/js/score/validation/measurementValidator.js'));

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const { validateMeasurements, STATE } = MeasurementValidator;

// ---- Input-contract matrix: none of these may become a valid numeric measurement ----
const INVALID_RAW_VALUES = [
  ['null', null],
  ['undefined', undefined],
  ['empty string', ''],
  ['whitespace string', '   '],
  ['false', false],
  ['true', true],
  ['empty array', []],
  ['empty object', {}],
  ['non-numeric string', 'abc'],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['-Infinity', -Infinity]
];

for (const [label, raw] of INVALID_RAW_VALUES) {
  const result = validateMeasurements({ ph: 7.2, tds: 100, turbidity: 0.5, orp: 400, do: 7, chlorine: raw });
  const field = result.fields.chlorine;
  assert(
    field.value === null,
    `chlorine=${label} → never becomes a valid number (state=${field.state})`
  );
  assert(
    !(raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) ? field.state !== STATE.VALID : true,
    `chlorine=${label} → not classified VALID`
  );
  assert(
    result.measurements.chlorine === undefined,
    `chlorine=${label} → omitted from validated measurements object`
  );
}

// Specifically re-confirm the historically dangerous coercions that `Number(x)`
// alone would turn into scoreable numbers (Number(null)=0, Number(false)=0,
// Number(true)=1, Number([])=0).
{
  const nullResult = validateMeasurements({ ph: 7.2, tds: 100, turbidity: 0.5, orp: 400, do: 7, chlorine: null });
  assert(nullResult.fields.chlorine.state === STATE.MISSING, 'null is classified MISSING, not coerced to 0');

  const falseResult = validateMeasurements({ ph: 7.2, tds: 100, turbidity: 0.5, orp: 400, do: 7, chlorine: false });
  assert(falseResult.fields.chlorine.state === STATE.INVALID_TYPE, 'false is rejected, not coerced to 0');

  const trueResult = validateMeasurements({ ph: 7.2, tds: 100, turbidity: 0.5, orp: 400, do: 7, chlorine: true });
  assert(trueResult.fields.chlorine.state === STATE.INVALID_TYPE, 'true is rejected, not coerced to 1');

  const arrResult = validateMeasurements({ ph: 7.2, tds: 100, turbidity: 0.5, orp: 400, do: 7, chlorine: [] });
  assert(arrResult.fields.chlorine.state === STATE.INVALID_TYPE, 'empty array is rejected, not coerced to 0');
}

// ---- Physical plausibility guard (M4 / M8): numeric but impossible values ----
const PLAUSIBILITY_CASES = [
  ['do', 1000, 'DO far beyond dissolved-oxygen sensor range'],
  ['orp', 5000, 'ORP far beyond mV instrument range'],
  ['tds', -50, 'negative TDS is physically impossible'],
  ['ph', 20, 'pH outside the physical 0-14 scale']
];

for (const [key, value, desc] of PLAUSIBILITY_CASES) {
  const base = { ph: 7.2, tds: 100, turbidity: 0.5, orp: 400, do: 7, chlorine: 0.3 };
  base[key] = value;
  const result = validateMeasurements(base);
  assert(result.fields[key].state === STATE.IMPLAUSIBLE, `${key}=${value} (${desc}) → flagged IMPLAUSIBLE`);
  assert(result.measurements[key] === undefined, `${key}=${value} → omitted from validated measurements`);
  assert(
    result.flags.some(f => f.field === key && f.guard?.status === 'PROVISIONAL' && f.guard?.reason === 'INPUT_PLAUSIBILITY_GUARD'),
    `${key}=${value} → flag carries PROVISIONAL/INPUT_PLAUSIBILITY_GUARD, not a scientific claim`
  );
}

// A plausible, ordinary DO reading must NOT be flagged (guard is wide, not a quality judgment).
{
  const result = validateMeasurements({ ph: 7.2, tds: 100, turbidity: 0.5, orp: 400, do: 6.34, chlorine: 0.3 });
  assert(result.fields.do.state === STATE.VALID, 'DO=6.34 (a normal reading) is VALID, not flagged');
  assert(result.status === 'VALID', 'all-valid readings object has overall status VALID');
}

// ---- Overall status classification ----
{
  const allMissing = validateMeasurements({});
  assert(allMissing.status === 'INVALID', 'empty readings object → overall status INVALID');

  const partial = validateMeasurements({ ph: 7.2, tds: 100 });
  assert(partial.status === 'PARTIAL', 'some-but-not-all valid fields → overall status PARTIAL');
}

// ---- Pass-through fields are untouched (not scored, not validated) ----
{
  const result = validateMeasurements({ ph: 7.2, tds: 100, turbidity: 0.5, orp: 400, do: 7, chlorine: 0.3, temp: 28.06 });
  assert(result.measurements.temp === 28.06, 'temp passes through unvalidated (not a scored field)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
