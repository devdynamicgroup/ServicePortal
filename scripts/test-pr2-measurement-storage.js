/**
 * PR2 smoke: assessment storage contracts via ConversionEngine (no Score/OCR).
 * Simulates the store helpers' conversion + immutability rules.
 * Run: node scripts/test-pr2-measurement-storage.js
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

function freezeMeasurement(value = {}) {
  return Object.freeze({ ...value });
}

function mergeRawMeasurement(existing = {}, incoming = {}) {
  const out = { ...(existing || {}) };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    out[key] = value;
  });
  return freezeMeasurement(out);
}

function storeRawAndStandard(tap, rawMeasurement, metadata, entry) {
  if (!rawMeasurement || !Object.keys(rawMeasurement).length) return null;
  const imageRaw = freezeMeasurement(rawMeasurement);
  const imageConversion = ConversionEngine.toStandardMeasurement(imageRaw);
  entry.rawMeasurement = imageRaw;
  entry.standardMeasurement = freezeMeasurement(imageConversion.standardMeasurement);
  entry.metadata = {
    ...metadata,
    conversion: { applied: imageConversion.applied, missing: imageConversion.missing }
  };
  tap.rawMeasurement = mergeRawMeasurement(tap.rawMeasurement, imageRaw);
  const tapConversion = ConversionEngine.toStandardMeasurement(tap.rawMeasurement);
  tap.standardMeasurement = freezeMeasurement(tapConversion.standardMeasurement);
  tap.metadata = {
    ...metadata,
    conversion: { applied: tapConversion.applied, missing: tapConversion.missing }
  };
  return tap;
}

console.log('PR2 measurement storage');

const tap = { meterReadings: { ph: '7.29' } };
const entry = { id: 'meter-1', detected: { ph: '7.29' } };
const raw = { ph: 7.29, ec: 319, do_percent: 89.4 };

storeRawAndStandard(tap, raw, { source: 'ocr', image: 'meter-1', confidence: 0.9 }, entry);

assert(tap.meterReadings.ph === '7.29', 'legacy meterReadings unchanged');
assert(tap.rawMeasurement.ph === 7.29, 'raw stores OCR ph');
assert(tap.rawMeasurement.ec === 319, 'raw stores OCR ec');
assert(tap.rawMeasurement.do_percent === 89.4, 'raw keeps do_percent (not do mg/L)');
assert(tap.standardMeasurement.ph === 7.29, 'standard has ph');
assert(tap.standardMeasurement.tds === 159.5, 'standard derives tds from ec');
assert(tap.standardMeasurement.do === undefined, 'standard does not invent do from %');
assert(entry.rawMeasurement === tap.rawMeasurement || entry.rawMeasurement.ph === 7.29, 'entry has raw');
assert(entry.metadata.image === 'meter-1', 'metadata image id');
assert(Array.isArray(tap.metadata.conversion.applied), 'traceability applied list');

const rawBefore = { ...tap.rawMeasurement };
ConversionEngine.toStandardMeasurement(tap.rawMeasurement);
assert(tap.rawMeasurement.ph === rawBefore.ph && tap.rawMeasurement.ec === rawBefore.ec, 'raw immutable after conversion');

let threw = false;
try {
  tap.rawMeasurement.ph = 1;
} catch {
  threw = true;
}
assert(threw || tap.rawMeasurement.ph === 7.29, 'rawMeasurement is frozen');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
