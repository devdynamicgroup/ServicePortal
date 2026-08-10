/**
 * Measurement Validator — the single canonical gate raw readings pass through
 * before reaching ANY scoring engine (Quality V3, legacy DWQI, or a country
 * benchmark engine).
 *
 * Pure utility. Never scores anything, never invents a value, never touches
 * the frozen scoring formulas. It exists because `Number(x)` alone silently
 * turns null/""/false/true/[] into 0/0/0/1/0 — this module rejects those
 * instead of coercing them, and separately flags values that are numeric
 * but physically impossible for the instrument/domain (e.g. DO = 1000).
 *
 * Physical-plausibility bounds below are deliberately wide "impossible
 * sensor reading" guards, NOT quality judgments — they must never be
 * confused with the Quality V3 ideal/breakpoint curves. Each is marked
 * PROVISIONAL / INPUT_PLAUSIBILITY_GUARD per that distinction.
 */

const FIELD_STATE = Object.freeze({
  VALID: 'VALID',
  MISSING: 'MISSING',
  INVALID_TYPE: 'INVALID_TYPE',
  IMPLAUSIBLE: 'IMPLAUSIBLE'
});

// Only the six fields the Quality V3 / legacy / benchmark engines actually
// score. `temp`, `ec`, `doPercent`, `totalChlorine` are collected elsewhere
// but are already excluded from scoring math (see `notScored` in
// computeQualityScoreV2.js) — they are passed through untouched here.
const SCORED_KEYS = Object.freeze(['ph', 'tds', 'turbidity', 'orp', 'chlorine', 'do']);
const PASSTHROUGH_KEYS = Object.freeze(['temp', 'ec', 'doPercent', 'totalChlorine']);

// Wide, sensor-impossibility-only bounds. Never narrowed to represent a
// "good" range — that is the frozen Quality V3 curve's job, not this gate's.
const PLAUSIBLE_RANGES = Object.freeze({
  ph: { min: 0, max: 14, status: 'PROVISIONAL', reason: 'INPUT_PLAUSIBILITY_GUARD', note: 'physical pH scale' },
  tds: { min: 0, max: 100000, status: 'PROVISIONAL', reason: 'INPUT_PLAUSIBILITY_GUARD', note: 'ppm sensor ceiling guard' },
  turbidity: { min: 0, max: 100000, status: 'PROVISIONAL', reason: 'INPUT_PLAUSIBILITY_GUARD', note: 'NTU sensor ceiling guard' },
  orp: { min: -2000, max: 2000, status: 'PROVISIONAL', reason: 'INPUT_PLAUSIBILITY_GUARD', note: 'mV instrument range guard' },
  chlorine: { min: 0, max: 1000, status: 'PROVISIONAL', reason: 'INPUT_PLAUSIBILITY_GUARD', note: 'mg/L sensor ceiling guard' },
  do: { min: 0, max: 25, status: 'PROVISIONAL', reason: 'INPUT_PLAUSIBILITY_GUARD', note: 'mg/L dissolved-oxygen saturation guard' }
});

/**
 * Strictly coerce a raw value into a finite number, or null if it isn't one.
 * Unlike `Number(x)`, this never turns null/""/false/true/[] into 0/0/0/1/0.
 */
function coerceStrictNumber(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  // null, undefined, boolean, Array, plain object, symbol, etc. — all rejected.
  return null;
}

function classifyField(key, rawValue) {
  const present = rawValue !== undefined && rawValue !== null;
  const isEmptyString = typeof rawValue === 'string' && rawValue.trim() === '';

  if (!present || isEmptyString) {
    return { state: FIELD_STATE.MISSING, value: null, rawType: rawValue === null ? 'null' : typeof rawValue };
  }

  const isAcceptableType = typeof rawValue === 'number' || typeof rawValue === 'string';
  if (!isAcceptableType) {
    return { state: FIELD_STATE.INVALID_TYPE, value: null, rawType: Array.isArray(rawValue) ? 'array' : typeof rawValue };
  }

  const n = coerceStrictNumber(rawValue);
  if (n === null) {
    return { state: FIELD_STATE.INVALID_TYPE, value: null, rawType: typeof rawValue };
  }

  const range = PLAUSIBLE_RANGES[key];
  if (range && (n < range.min || n > range.max)) {
    return {
      state: FIELD_STATE.IMPLAUSIBLE,
      value: null,
      rawType: typeof rawValue,
      guard: { min: range.min, max: range.max, status: range.status, reason: range.reason }
    };
  }

  return { state: FIELD_STATE.VALID, value: n, rawType: typeof rawValue };
}

/**
 * Validate a raw readings object. Returns a canonical, validated measurement
 * envelope — invalid/implausible fields are OMITTED from `.measurements`
 * (become `undefined`) rather than passed through, so a scoring engine's own
 * `Number.isFinite` gate correctly treats them as missing.
 *
 * @param {object} rawReadings
 * @returns {{status: 'VALID'|'PARTIAL'|'INVALID', measurements: object, fields: object, flags: Array}}
 */
function validateMeasurements(rawReadings = {}) {
  const fields = {};
  const measurements = {};
  const flags = [];

  SCORED_KEYS.forEach(key => {
    const result = classifyField(key, rawReadings[key]);
    fields[key] = result;
    if (result.state === FIELD_STATE.VALID) {
      measurements[key] = result.value;
    } else if (result.state !== FIELD_STATE.MISSING) {
      flags.push({ field: key, reason: result.state, rawType: result.rawType, guard: result.guard || null });
    }
  });

  PASSTHROUGH_KEYS.forEach(key => {
    if (rawReadings[key] !== undefined) {
      measurements[key] = rawReadings[key];
    }
  });

  const validCount = SCORED_KEYS.filter(key => fields[key].state === FIELD_STATE.VALID).length;
  let status;
  if (validCount === SCORED_KEYS.length) status = 'VALID';
  else if (validCount === 0) status = 'INVALID';
  else status = 'PARTIAL';

  return Object.freeze({
    status,
    measurements,
    fields: Object.freeze(fields),
    flags: Object.freeze(flags)
  });
}

const MeasurementValidator = Object.freeze({
  STATE: FIELD_STATE,
  SCORED_KEYS,
  PLAUSIBLE_RANGES,
  coerceStrictNumber,
  validateMeasurements
});

if (typeof window !== 'undefined') {
  window.MeasurementValidator = MeasurementValidator;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MeasurementValidator;
}
