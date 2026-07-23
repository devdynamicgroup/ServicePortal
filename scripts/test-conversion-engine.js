/**
 * PR1 smoke tests for Layer 2 Conversion Engine (no Assessment/Score wiring).
 * Run: node scripts/test-conversion-engine.js
 */
const path = require('path');
const ConversionEngine = require(path.join(__dirname, '..', 'src', 'js', 'conversion', 'engine.js'));

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${msg}`);
  }
}

function assertEq(actual, expected, msg) {
  assert(Object.is(actual, expected), `${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

console.log('ConversionEngine PR1');

{
  const raw = { ph: 7.29, ec: 319, do_percent: 89.4, orp: 220, temp: 28 };
  const out = ConversionEngine.toStandardMeasurement(raw);
  assertEq(out.standardMeasurement.ph, 7.29, 'passthrough ph');
  assertEq(out.standardMeasurement.orp, 220, 'passthrough orp');
  assertEq(out.standardMeasurement.temp, 28, 'passthrough temp');
  assertEq(out.standardMeasurement.tds, 159.5, 'ec→tds with default 0.5');
  assert(out.standardMeasurement.do === undefined, 'do% does not invent do mg/L');
  assert(out.missing.includes('do'), 'do listed in missing');
  assert(out.missing.includes('chlorine'), 'chlorine listed in missing');
  assert(out.rawSnapshot.ec === 319, 'rawSnapshot preserves ec');
  assert(raw.tds === undefined, 'raw input not mutated with derived tds');
}

{
  const raw = { tds: 400, ec: 800 };
  const out = ConversionEngine.toStandardMeasurement(raw);
  assertEq(out.standardMeasurement.tds, 400, 'measured tds preferred over ec-derived');
}

{
  const raw = { do: 6.8, do_percent: 89.4 };
  const out = ConversionEngine.toStandardMeasurement(raw);
  assertEq(out.standardMeasurement.do, 6.8, 'measured do mg/L preferred');
}

{
  const raw = { doPercent: 90 };
  const out = ConversionEngine.toStandardMeasurement(raw, {
    convertDoPercentToMgL: (pct) => ({ value: +(pct * 0.08).toFixed(2) })
  });
  assertEq(out.standardMeasurement.do, 7.2, 'expert DO%→mg/L override works');
}

{
  const wrapped = { rawMeasurement: { ph: 7.1, ec: 200 } };
  const out = ConversionEngine.toStandardMeasurement(wrapped);
  assertEq(out.standardMeasurement.ph, 7.1, 'unwraps rawMeasurement envelope');
  assertEq(out.standardMeasurement.tds, 100, 'ec→tds from wrapped raw');
}

{
  const derived = ConversionEngine.convertEcToTds(100, 0.64);
  assertEq(derived.value, 64, 'custom ec→tds factor');
}

{
  // 72.3°F -> 22.39°C (matches the real Hanna standby-screen case that
  // prompted this: meter set to Fahrenheit, no Celsius value on Raw).
  const raw = { ph: 7.29, temperature_f: 72.3 };
  const out = ConversionEngine.toStandardMeasurement(raw);
  assertEq(out.standardMeasurement.temp, 22.39, 'temperature_f derives Celsius temp');
  assert(out.applied.some(a => a.field === 'temp' && a.reason === 'fahrenheit_to_celsius'), 'applied records fahrenheit_to_celsius');
}

{
  // Measured Celsius on Raw must win — never re-derive/override from F.
  const raw = { temp: 25, temperature_f: 200 };
  const out = ConversionEngine.toStandardMeasurement(raw);
  assertEq(out.standardMeasurement.temp, 25, 'measured Celsius temp preferred over temperature_f');
}

{
  const derived = ConversionEngine.convertFahrenheitToCelsius(32);
  assertEq(derived.value, 0, 'freezing point: 32°F -> 0°C');
}

{
  const raw = { ph: 7.29 };
  const out = ConversionEngine.toStandardMeasurement(raw);
  assert(out.standardMeasurement.temp === undefined, 'no temp and no temperature_f -> temp stays missing, never invented');
  assert(out.missing.includes('temp'), 'temp listed in missing when neither C nor F present');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
