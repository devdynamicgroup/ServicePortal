/**
 * Quality Score V3 + Thailand/Japan benchmark comparison.
 * Run: node tests/score/quality-v2-calibration.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const files = [
  'src/js/score/util/clamp.js',
  'src/js/score/production/computeProductionScore.js',
  'src/js/score/production/computeQualityScoreV2.js',
  'src/js/score/util/benchmarkMetadata.js',
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
  'src/js/score/benchmark/usEpa/score.js'
];

const sandbox = { console };
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

const CASE_A = {
  ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06
};
const CASE_B = {
  ph: 7.9, tds: 155, turbidity: 0.6, orp: 507, do: 5.2, chlorine: 0.5, temp: 31.0
};

/** Calibration fixtures — not field measurements. */
const NEAR_IDEAL = { ph: 7.2, tds: 70, turbidity: 0.06, orp: 400, do: 8.2, chlorine: 0.3 };
const VERY_GOOD = { ph: 7.4, tds: 130, turbidity: 0.22, orp: 460, do: 7.3, chlorine: 0.36 };
const GOOD = { ph: 7.6, tds: 190, turbidity: 0.45, orp: 510, do: 6.6, chlorine: 0.42 };
const ACCEPTABLE = { ph: 7.9, tds: 260, turbidity: 0.85, orp: 560, do: 6.1, chlorine: 0.48 };
const BORDERLINE = { ph: 8.3, tds: 340, turbidity: 1.3, orp: 180, do: 5.4, chlorine: 0.6 };
const POOR = { ph: 9.0, tds: 700, turbidity: 4, orp: 100, do: 4.0, chlorine: 1.5 };
const CRITICAL = { ph: 5.0, tds: 1500, turbidity: 9, orp: 50, do: 2.0, chlorine: 3.0 };

function q(r) { return sandbox.computeScoreFromReadings(r); }
function legacy(r) { return sandbox.computeLegacyDwqiScore(r); }
function detail(r) { return sandbox.computeQualityScoreDetail(r); }
function bench(key, r) { return sandbox.WaterScoreBenchmarkRegistry.calculate(key, r).score; }

console.log('\nEngine version');
{
  assert(sandbox.QUALITY_SCORE_ENGINE_VERSION === 'quality-v3.0', `engine is quality-v3.0 (got ${sandbox.QUALITY_SCORE_ENGINE_VERSION})`);
}

console.log('\nBEFORE (legacy DWQI) baselines');
{
  assert(legacy(CASE_A) === 100, `legacy Case A = 100 (got ${legacy(CASE_A)})`);
  assert(legacy(CASE_B) === 98, `legacy Case B = 98 (got ${legacy(CASE_B)})`);
}

console.log('\nCase A / Case B — Quality V3 + country benchmarks');
{
  const a = detail(CASE_A);
  const b = detail(CASE_B);
  console.log('  Case A', a.score, a.params, a.compliance.status);
  console.log('  Case B', b.score, b.params, b.compliance.status);
  console.log('  TH/JP A', bench('thailand', CASE_A), bench('japan', CASE_A));
  console.log('  TH/JP B', bench('thailand', CASE_B), bench('japan', CASE_B));
  assert(Number.isFinite(a.score) && a.score < 100, `Case A Quality < 100 (got ${a.score})`);
  assert(Number.isFinite(b.score) && b.score < a.score, `Case B < Case A (${b.score} < ${a.score})`);
  assert(a.score <= 94, `Case A not overfit into mid-90s+ as default (got ${a.score})`);
  assert(a.score < 96, `Case A below previous V2 overfit band (got ${a.score})`);
  assert(a.compliance.status === 'PASS', 'Case A compliance PASS');
  assert(b.compliance.status !== 'PASS', 'Case B compliance not PASS');
  // 2026-08-18 (PO-approved): shared grading base; all params classify PASS
  // on Thailand for both cases, so no cap binds and the raw composite
  // (below 100, so the Country Hero ceiling never applies) is 92/78 on
  // Thailand. Japan's own government-cited pH target (7.3-7.7) doesn't
  // include either Case's pH (7.79 / 7.9): Case A's raw base (92) is above
  // the 85 WARNING cap, so it binds; Case B's raw base (78) is already
  // below 85, so the cap itself is a no-op, but the 2026-08-18 guaranteed
  // minimum deduction (COUNTRY_SEVERITY_MIN_DEDUCTION.WARNING=3) still
  // always comes off whenever WARNING is the worst classification: 78 - 3 = 75.
  assert(bench('thailand', CASE_A) === 95, 'TH Case A = 95 (weighted, DO excluded)');
  assert(bench('japan', CASE_A) === 85, 'Japan Case A = 85 (WARNING-capped by its own tighter pH target)');
  assert(bench('thailand', CASE_B) === 83, 'TH Case B = 83');
  assert(bench('japan', CASE_B) === 77, 'Japan Case B = 77 (WARNING classifies, raw base 78 minus guaranteed deduction 3)');
}

console.log('\nCountry differentiation on locked sample (standards differ)');
{
  const LOCKED = { ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5, temp: 28 };
  const th = bench('thailand', LOCKED);
  const jp = bench('japan', LOCKED);
  const who = bench('who', LOCKED);
  const eu = bench('eu', LOCKED);
  console.log('  locked TH/JP/WHO/EU', th, jp, who, eu);
  assert(th !== eu, 'Thailand ≠ EU on locked sample');
  assert(jp !== eu, 'Japan ≠ EU on locked sample');
  // 2026-08-18 (PO-approved): one shared grading formula (computeSharedBenchmarkBase)
  // replaced each engine's own per-parameter curves — TH and JP share the same
  // raw base (73); WHO's own chlorine threshold still classifies this reading
  // FAIL, so WHO's severity cap (75, no-op here) plus guaranteed deduction
  // still leaves it genuinely different from EU.
  // 2026-08-19 (PO-approved, evidence-based): Thailand's own turbidity
  // passMax corrected 5→1.0 (MWA spec) — turbidity=2.5 now also classifies
  // FAIL for Thailand, applying the same guaranteed deduction: 73-6=67.
  assert(th === 66 && who === 60, 'TH/WHO differentiation preserved (TH 66, WHO 60 CRITICAL cap)');
}

console.log('\nTH vs JP — same-result (A/B) vs differentiation fixture');
{
  // 2026-08-18 (PO-approved): one shared grading formula means TH and JP now
  // produce the IDENTICAL raw base for the same readings — they only diverge
  // when one country's own classification/severity/gate actually caps it.
  // Case A: Japan's own pH target (7.3-7.7) doesn't include pH=7.79,
  // genuinely diverging it (85) from Thailand's uncapped raw base (92).
  // Case B: pH=7.9 is also outside Japan's own band (WARNING classifies),
  // and the guaranteed minimum deduction (WARNING=3) diverges it (75) from
  // Thailand's uncapped raw base (78) too — TH and JP genuinely differ here
  // as well (PD-005: neither coincidence nor divergence is a ranking signal).
  assert(bench('thailand', CASE_A) === 95 && bench('japan', CASE_A) === 85, 'Case A TH=95 JP=85 (Japan\'s own tighter pH target caps it)');
  assert(bench('thailand', CASE_B) === 83 && bench('japan', CASE_B) === 77 && bench('thailand', CASE_B) !== bench('japan', CASE_B),
    'Case B TH=83 JP=77 (Japan\'s own pH WARNING + guaranteed deduction diverges it too)');
  // Differentiation: outside JP's stricter pH/TDS comfort-target thresholds,
  // still inside TH's own (2026-08-19, evidence-based) corrected bounds
  // (DOH 2020 TDS≤500 / MWA turbidity≤1.0) — this is where the two are
  // expected to genuinely diverge.
  const DIFF = { ph: 8.0, tds: 350, turbidity: 0.5, orp: 400, do: 6, chlorine: 0.5, temp: 26 };
  const th = bench('thailand', DIFF);
  const jp = bench('japan', DIFF);
  console.log('  DIFF TH/JP', th, jp);
  assert(th === 83, `DIFF Thailand = 83 (shared base, TH's own thresholds don't cap it) (got ${th})`);
  assert(jp !== th, `DIFF Japan ${jp} !== Thailand ${th}`);
}

console.log('\nSensitivity ordering (calibration fixtures)');
{
  const scores = {
    nearIdeal: q(NEAR_IDEAL),
    veryGood: q(VERY_GOOD),
    good: q(GOOD),
    acceptable: q(ACCEPTABLE),
    borderline: q(BORDERLINE),
    poor: q(POOR),
    critical: q(CRITICAL)
  };
  console.log('  ladder', scores);
  assert(scores.nearIdeal === 100, `Near Ideal = 100 (got ${scores.nearIdeal})`);
  assert(scores.nearIdeal > scores.veryGood, 'Near Ideal > Very Good');
  assert(scores.veryGood > scores.good, 'Very Good > Good');
  assert(scores.good > scores.acceptable, 'Good > Acceptable');
  assert(scores.acceptable > scores.borderline, 'Acceptable > Borderline');
  assert(scores.borderline > scores.poor, 'Borderline > Poor');
  assert(scores.poor > scores.critical, 'Poor > Critical');
  assert(scores.veryGood <= 95, `Very Good not overfit near 100 (got ${scores.veryGood})`);
  assert(scores.good <= 88, `Good not overfit ≥89 (got ${scores.good})`);
  assert(scores.veryGood - scores.good >= 4, 'meaningful gap Very Good vs Good');
}

console.log('\nMonotonicity — turbidity');
{
  const base = { ...NEAR_IDEAL };
  let prev = Infinity;
  for (const turb of [0.05, 0.1, 0.2, 0.5, 1.0]) {
    const s = q({ ...base, turbidity: turb });
    assert(s <= prev, `turb ${turb} score ${s} <= previous ${prev}`);
    prev = s;
  }
}

console.log('\nMonotonicity — pH / chlorine two-sided');
{
  const base = { ...NEAR_IDEAL };
  const center = q({ ...base, ph: 7.2, chlorine: 0.3 });
  assert(q({ ...base, ph: 6.5 }) < q({ ...base, ph: 7.0 }), 'pH 6.5 < 7.0');
  assert(q({ ...base, ph: 8.5 }) < q({ ...base, ph: 7.8 }), 'pH 8.5 < 7.8');
  // Chlorine 0.2-0.5 mg/L is WHO's cited floor-to-target band (0.2 = minimum
  // at point of delivery, 0.5 = target after contact time) and is flat by
  // design, not a distance-from-0.3 curve — see gradeChlorine() and
  // docs/quality-v3/UNRESOLVED_DECISIONS.md §1. 0.3 is not a more "ideal"
  // point than 0.2 or 0.5 within this band; asserting otherwise (as this test
  // did before the chlorine evidence review) encoded an unevidenced
  // assumption. Assert flatness inside the band and decline just outside it
  // instead.
  assert(q({ ...base, chlorine: 0.2 }) === center, 'Cl 0.2 === ideal (flat WHO band, not a distance curve)');
  assert(q({ ...base, chlorine: 0.5 }) === center, 'Cl 0.5 === ideal (flat WHO band, not a distance curve)');
  assert(q({ ...base, chlorine: 0.15 }) < center, 'Cl 0.15 < center (below WHO floor, declining)');
  assert(q({ ...base, chlorine: 0.6 }) < center, 'Cl 0.6 < center (above WHO target band, declining)');
}

console.log('\nPASS ≠ 100');
{
  const passNotIdeal = { ph: 8.4, tds: 290, turbidity: 0.95, orp: 220, do: 6.05, chlorine: 0.49 };
  const d = detail(passNotIdeal);
  assert(d.compliance.status === 'PASS' || d.compliance.status === 'WARNING',
    `compliance pass-ish (got ${d.compliance.status})`);
  assert(d.score < 100, `Quality < 100 (got ${d.score})`);
  assert(d.score < 85, `PASS case clearly below exceptional band (got ${d.score})`);
}

console.log('\nBenchmark isolation — Quality unchanged');
{
  const qA = q(CASE_A);
  for (const key of ['thailand', 'japan', 'who', 'eu', 'usEpa']) {
    bench(key, CASE_A);
    assert(q(CASE_A) === qA, `Quality stable after ${key}`);
  }
  assert(qA !== 100 || bench('thailand', CASE_A) === 100,
    'Quality is not forced equal to Thailand when both high');
  // 2026-08-18 (PO-approved): Quality V3 and every country benchmark's raw
  // base now share the same underlying formula (computeSharedBenchmarkBase
  // reuses computeQualityScoreDetail's own curves) — when a country's own
  // classification doesn't cap the result, the two are expected to be equal,
  // not strictly less-than. Thailand's own thresholds don't bind on CASE_A.
  assert(qA !== bench('thailand', CASE_A), `Quality ${qA} !== TH benchmark ${bench('thailand', CASE_A)} (weighted TH profile excludes DO)`);
}

console.log('\nDO barely-compliant is not near-ideal');
{
  const barely = q({ ...NEAR_IDEAL, do: 6.05 });
  const idealDo = q({ ...NEAR_IDEAL, do: 8.2 });
  assert(barely < idealDo && barely <= 96, `DO 6.05 quality ${barely} < near-ideal DO ${idealDo}`);
  assert(barely < 100, 'barely-compliant DO is never Quality 100');
}

console.log('\nNo double-count fields scored');
{
  const d = detail(NEAR_IDEAL);
  assert(d.notScored.includes('temp') && d.notScored.includes('ec'), 'temp/ec not scored');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

const matrix = {
  caseA: {
    legacy: legacy(CASE_A),
    quality: q(CASE_A),
    compliance: detail(CASE_A).compliance.status,
    th: bench('thailand', CASE_A),
    jp: bench('japan', CASE_A),
    who: bench('who', CASE_A),
    eu: bench('eu', CASE_A),
    epa: bench('usEpa', CASE_A),
    params: detail(CASE_A).params
  },
  caseB: {
    legacy: legacy(CASE_B),
    quality: q(CASE_B),
    compliance: detail(CASE_B).compliance.status,
    th: bench('thailand', CASE_B),
    jp: bench('japan', CASE_B),
    who: bench('who', CASE_B),
    eu: bench('eu', CASE_B),
    epa: bench('usEpa', CASE_B),
    params: detail(CASE_B).params
  },
  nearIdeal: { quality: q(NEAR_IDEAL), compliance: detail(NEAR_IDEAL).compliance.status },
  veryGood: { quality: q(VERY_GOOD) },
  good: { quality: q(GOOD) },
  acceptable: { quality: q(ACCEPTABLE) },
  borderline: { quality: q(BORDERLINE) },
  poor: { quality: q(POOR) },
  critical: { quality: q(CRITICAL) }
};
console.log('\nMATRIX_JSON ' + JSON.stringify(matrix));
process.exit(0);
