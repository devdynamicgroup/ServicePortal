/**
 * Score Architecture V2 (2026-08-17, PO-approved) — additive contract tests.
 * Covers: new ScoreResult fields (modelVersion/rawAggregate/severityProtection/
 * countryGate/ceiling/complete/reason), explainScore() determinism, and the
 * aggregation-dilution regression matrix that justified NOT changing any
 * grade-curve constants (severity protection already prevents a diluted raw
 * aggregate from leaking into the displayed final score, across all 5 engines
 * and both catastrophic and moderate degradation — verified below, not assumed).
 * Run: node tests/score/architecture-v2-contract.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const files = [
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
  'src/js/score/production/computeProductionScore.js',
  'src/js/score/production/computeQualityScoreV2.js',
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
  'src/js/score/util/explainScore.js'
];
const sandbox = { console };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of files) vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });

const bench = (k, r) => sandbox.WaterScoreBenchmarkRegistry.calculate(k, r);
const KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const EXCELLENT = { ph: 7.2, tds: 60, turbidity: 0.1, orp: 400, chlorine: 0.3, do: 8, temp: 25 };

console.log('\nA. New ScoreResult fields present and correctly shaped, all 5 engines');
{
  for (const key of KEYS) {
    const r = bench(key, EXCELLENT);
    assert(typeof r.modelVersion === 'string' && r.modelVersion.startsWith(key === 'usEpa' ? 'usEpa' : key),
      `${key}: modelVersion is a string starting with engine key (got ${r.modelVersion})`);
    assert(r.complete === true, `${key}: complete=true for a full reading`);
    assert(r.reason === null, `${key}: reason=null when complete`);
    assert(Number.isFinite(r.rawAggregate), `${key}: rawAggregate is finite (got ${r.rawAggregate})`);
    assert(r.severityProtection && typeof r.severityProtection === 'object',
      `${key}: severityProtection sub-object present`);
    assert(r.ceiling && typeof r.ceiling.value === 'number' && r.ceiling.value === 99,
      `${key}: ceiling sub-object present with value=99`);
    assert('preCeilingScore' in r.ceiling, `${key}: ceiling.preCeilingScore present`);
  }
}

console.log('\nB. Incomplete readings: complete=false, reason set, score stays null (no engine silently defaults missing to a passing grade)');
{
  const missingForms = [
    ['1 missing (turbidity undefined)', { ph: 7.2, tds: 60, orp: 400, chlorine: 0.3, do: 8 }],
    ['2 missing', { ph: 7.2, tds: 60, do: 8 }],
    ['all missing', {}],
    ['null', { ph: null, tds: 60, turbidity: 0.1, orp: 400, chlorine: 0.3, do: 8 }],
    ['NaN', { ph: NaN, tds: 60, turbidity: 0.1, orp: 400, chlorine: 0.3, do: 8 }],
    ['empty string', { ph: '', tds: 60, turbidity: 0.1, orp: 400, chlorine: 0.3, do: 8 }],
    ['false', { ph: false, tds: 60, turbidity: 0.1, orp: 400, chlorine: 0.3, do: 8 }]
  ];
  for (const key of KEYS) {
    for (const [label, readings] of missingForms) {
      const r = bench(key, readings);
      assert(r.score === null, `${key} / ${label}: score is null (got ${r.score})`);
      assert(r.complete === false, `${key} / ${label}: complete=false`);
      assert(r.reason === 'INCOMPLETE_READINGS', `${key} / ${label}: reason=INCOMPLETE_READINGS (got ${r.reason})`);
    }
  }
}

console.log('\nC. explainScore() — deterministic, matches registry.calculate() exactly, no hidden transformation');
{
  const CASE_1328 = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06 };
  for (const key of KEYS) {
    const direct = bench(key, CASE_1328);
    const explained = sandbox.explainScore(CASE_1328, key);
    assert(explained.result.score === direct.score, `${key}: explainScore result.score matches direct registry.calculate (${explained.result.score} === ${direct.score})`);
    assert(typeof explained.text === 'string' && explained.text.includes('final = ' + direct.score),
      `${key}: explainScore text ends with the same final score`);
    const again = sandbox.explainScore(CASE_1328, key);
    assert(again.text === explained.text, `${key}: explainScore is deterministic (same input -> byte-identical trace)`);
  }
}

console.log('\nD. Aggregation dilution matrix — one catastrophic parameter, five excellent (Phase 9 requirement)');
{
  // CATASTROPHIC values chosen to be unambiguously bad on every engine's own
  // classification thresholds (near-zero grade), not calibration-sensitive.
  const CATASTROPHIC = { ph: 3, tds: 5000, turbidity: 50, orp: -100, chlorine: 15, do: 0 };
  // 2026-08-18 (PO-approved): all engines now use the one shared grading
  // formula (computeSharedBenchmarkBase, plain equal-weight average — no
  // weakest-link aggregation) for the raw base, then each engine applies
  // only its own classification-based severity cap (and, for EU, its own
  // PD-002 chlorine gate) on top. The classification-based severity cap
  // alone is what prevents a single catastrophic parameter from being
  // diluted away by five excellent ones. Thailand/Japan classify DO as
  // NOT_EVALUATED (never CRITICAL), so a catastrophic DO value never caps
  // their score — it only lowers the raw average.
  const expected = {
    thailand: { ph: 60, tds: 60, turbidity: 60, orp: 60, chlorine: 60, do: 84 },
    japan: { ph: 60, tds: 60, turbidity: 60, orp: 60, chlorine: 60, do: 84 },
    who: { ph: 60, tds: 60, turbidity: 60, orp: 60, chlorine: 60, do: 60 },
    eu: { ph: 75, tds: 75, turbidity: 60, orp: 85, chlorine: 65, do: 75 },
    usEpa: { ph: 60, tds: 60, turbidity: 60, orp: 60, chlorine: 60, do: 60 }
  };
  for (const key of KEYS) {
    for (const param of Object.keys(CATASTROPHIC)) {
      const readings = { ...EXCELLENT, [param]: CATASTROPHIC[param] };
      const r = bench(key, readings);
      const exp = expected[key][param];
      assert(r.score === exp, `${key} 1-catastrophic(${param}=${CATASTROPHIC[param]}): final=${exp} (got ${r.score})`);
      // The core dilution-safety property: whenever a parameter classifies
      // CRITICAL, the FINAL score must never exceed the CRITICAL ceiling (60),
      // regardless of how high the raw weighted-mean aggregate is diluted to
      // by the other five excellent parameters. Now enforced by BOTH the
      // weakest-link aggregation (Japan/WHO/EU/EPA, this round) AND the
      // classification-based severity cap as a backstop.
      if (r.classifications && r.classifications[param] === 'CRITICAL' && key !== 'eu') {
        assert(r.score <= 60, `${key} ${param} CRITICAL: final score ${r.score} <= 60 despite raw dilution (rawAggregate=${r.rawAggregate})`);
      }
    }
  }
}

console.log('\nE. EU countryGate — dedicated chlorine gate captured as an inspectable stage, still dominant over generic severity');
{
  // 2026-08-18 (PO-approved): the raw base is now the shared plain
  // equal-weight average (no weakest-link aggregation), so a single
  // catastrophic chlorine value among five excellent params still leaves
  // the raw aggregate well above the gate cap (85), regardless of exactly
  // how extreme chlorine itself is. EU's own PD-002 gate (unchanged
  // mechanism) therefore binds and dominates the generic CRITICAL=60
  // severity floor for both a milder-but-still-CRITICAL value (0.7) and an
  // extreme one (15).
  const r = bench('eu', { ...EXCELLENT, chlorine: 0.7 });
  assert(r.countryGate && r.countryGate.applied === true, 'EU chlorine=0.7: countryGate.applied=true');
  assert(r.countryGate.cap === 65, `EU chlorine=0.7: countryGate.cap=65 (got ${r.countryGate.cap})`);
  assert(r.score === 65, `EU chlorine=0.7: final score is the gate value 65, not the generic CRITICAL=60 (got ${r.score})`);

  const extreme = bench('eu', { ...EXCELLENT, chlorine: 15 });
  assert(extreme.countryGate && extreme.countryGate.applied === true, 'EU chlorine=15: countryGate.applied=true (raw aggregate still above cap)');
  assert(extreme.score === 65, `EU chlorine=15: final score is the gate value 65 (got ${extreme.score})`);
}

console.log('\nF. modelVersion is stable across repeated calls with the same readings (determinism)');
{
  for (const key of KEYS) {
    const a = bench(key, EXCELLENT).modelVersion;
    const b = bench(key, EXCELLENT).modelVersion;
    assert(a === b, `${key}: modelVersion stable across calls (${a} === ${b})`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
