/**
 * Utility only — shapes benchmark metadata envelope + stable input fingerprinting.
 * Does NOT score parameters or encode country philosophy.
 *
 * Country Hero ceiling (product architecture, computeQualityScoreV2.js header):
 *   100 = genuinely Near-Ideal / Exceptional Quality  → Quality V3 only
 *   PASS ≠ 100
 *   Quality ≠ country Benchmark
 * Therefore Country Benchmark composite Hero must never equal 100.
 * Param-level grades may still report 100 for in-band compliance; the composite
 * Hero is capped. Does not change weights, aggregation, Math.round, or Q-V3.
 */

/** Hard ceiling for Country Benchmark composite scores (Hero / registry.calculate). */
const COUNTRY_BENCHMARK_HERO_MAX = 99;

function applyCountryBenchmarkHeroCeiling(score) {
  if (!Number.isFinite(score)) return score;
  return score > COUNTRY_BENCHMARK_HERO_MAX ? COUNTRY_BENCHMARK_HERO_MAX : score;
}

/**
 * Country severity protection (product decision, 2026-08-14).
 * Scope: Japan / WHO / US EPA only — called explicitly from each of those
 * three engines' own calculate(), never from Thailand or EU, and never
 * invoked automatically by any shared dispatch path. This function itself
 * is engine-agnostic (reads whatever classifications object it's given) —
 * it does not know or care which country called it; the scoping guarantee
 * comes entirely from which files choose to call it.
 *
 * Policy (locked numbers, not derived from any curve/weight):
 *   worst classification = CRITICAL -> score capped at 60
 *   worst classification = FAIL     -> score capped at 75
 *   worst classification = WARNING or PASS -> score unchanged
 * temp is excluded (never scored by any engine). NOT_EVALUATED / NOT_MEASURED
 * are excluded (absence of a measurement, not a failure of one).
 * Does not touch weights, limits, curves, aggregation, or the 99 ceiling —
 * this runs on the already-computed composite, before finalizeBenchmarkMetadata's
 * own ceiling step, and is a no-op for any classification set with nothing
 * worse than WARNING.
 */
const COUNTRY_SEVERITY_CAPS = Object.freeze({ FAIL: 75, CRITICAL: 60 });

function worstBenchmarkClassification(classifications) {
  const order = { CRITICAL: 3, FAIL: 2, WARNING: 1, PASS: 0 };
  let worst = 'PASS';
  Object.keys(classifications || {}).forEach((key) => {
    if (key === 'temp') return;
    const state = classifications[key];
    if (order[state] !== undefined && order[state] > order[worst]) worst = state;
  });
  return worst;
}

function applyCountrySeverityProtection(score, classifications) {
  if (!Number.isFinite(score)) return score;
  const worst = worstBenchmarkClassification(classifications);
  if (worst === 'CRITICAL') return Math.min(score, COUNTRY_SEVERITY_CAPS.CRITICAL);
  if (worst === 'FAIL') return Math.min(score, COUNTRY_SEVERITY_CAPS.FAIL);
  return score;
}

function normalizeBenchmarkReadingValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // Fixed precision so 7.20 and 7.2 fingerprint identically.
  return Math.round(n * 1000) / 1000;
}

/** Stable hash of normalized measurement values only — no identity, case, or time. */
function fingerprintBenchmarkInputs(readings) {
  const keys = ['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp'];
  const parts = keys.map(key => {
    const v = normalizeBenchmarkReadingValue(readings ? readings[key] : null);
    return `${key}=${v === null ? '' : String(v)}`;
  });
  const payload = parts.join('|');
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (`00000000${(hash >>> 0).toString(16)}`).slice(-8);
}

function makeBenchmarkCalculationId(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const seq = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  return `calc_${y}${m}${d}_${seq}`;
}

function finalizeBenchmarkMetadata(input) {
  const classifications = input.classifications || {};
  const passedParameters = [];
  const warningParameters = [];
  const failedParameters = [];
  const criticalFailures = [];
  Object.keys(classifications).forEach(param => {
    const c = classifications[param];
    if (c === 'PASS') passedParameters.push(param);
    else if (c === 'WARNING') warningParameters.push(param);
    else if (c === 'FAIL') failedParameters.push(param);
    else if (c === 'CRITICAL') criticalFailures.push(param);
  });

  const calculatedAt = input.calculatedAt || new Date().toISOString();
  const inputFingerprint = input.inputFingerprint
    || fingerprintBenchmarkInputs(input.readings || {});

  return {
    engine: input.engine,
    engineKey: input.engineKey,
    score: applyCountryBenchmarkHeroCeiling(input.score),
    verdict: input.verdict,
    summary: input.summary,
    passedParameters,
    warningParameters,
    failedParameters,
    criticalFailures,
    reasons: Array.isArray(input.reasons) ? input.reasons : [],
    topPositiveFactors: Array.isArray(input.topPositiveFactors) ? input.topPositiveFactors : [],
    topNegativeFactors: Array.isArray(input.topNegativeFactors) ? input.topNegativeFactors : [],
    classifications,
    params: input.params || null,
    statuses: input.statuses || {},
    findings: input.findings || [],
    gated: Boolean(input.gated),
    calculationId: input.calculationId || makeBenchmarkCalculationId(new Date(calculatedAt)),
    engineVersion: input.engineVersion || 'v1.0',
    standardRevision: input.standardRevision || '',
    calculatedAt,
    inputFingerprint
  };
}

function incompleteBenchmarkMetadata(engine, engineKey, options = {}) {
  return finalizeBenchmarkMetadata({
    engine,
    engineKey,
    score: null,
    verdict: 'Attention',
    summary: 'Insufficient readings to evaluate this benchmark.',
    classifications: {},
    reasons: [],
    topPositiveFactors: [],
    topNegativeFactors: ['One or more required measurements are missing for this benchmark.'],
    params: null,
    statuses: {},
    findings: [],
    readings: options.readings || {},
    engineVersion: options.engineVersion || 'v1.0',
    standardRevision: options.standardRevision || ''
  });
}
