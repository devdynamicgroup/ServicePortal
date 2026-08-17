/**
 * Thailand severity-protection coverage (2026-08-17, PO-approved).
 *
 * Root cause: Thailand was the only one of the 5 country engines with zero
 * classification-gated severity protection. WARNING=85/FAIL=75/CRITICAL=60
 * had already shipped for Japan/WHO/US EPA (2026-08-14) and EU (chlorine
 * gate + non-chlorine coverage, 2026-08-14/17), but Thailand's own
 * WARNING/FAIL/CRITICAL classifications never capped its composite score.
 *
 * Fix: reuses the exact shared mechanism (applyCountrySeverityProtection /
 * worstBenchmarkClassification, benchmarkMetadata.js — unmodified) already
 * deployed for the other four engines. No new cap values, no grade-curve
 * change, no weight change, no change to the PD-015 weakest-link blend.
 *
 * Known, expected consequence: the four real Cases used throughout this
 * project's QA (New C 8/11, New C 8/10, test1, Case 1328) all classify
 * PASS on every scored Thailand parameter for their real readings, so their
 * Thailand scores are UNCHANGED by this fix (86/90/86/99) — Thailand's own
 * grade curves are simply lenient enough that these specific readings never
 * cross into WARNING. This fix closes the coverage gap for any case that
 * DOES cross Thailand's own WARNING/FAIL/CRITICAL thresholds; it does not
 * retune what those thresholds are (that is a separate, explicitly
 * out-of-scope grade-curve review).
 *
 * Run: node tests/score/thailand-severity-protection.test.js
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
  'src/js/score/benchmark/usEpa/score.js'
];

const sandbox = { console };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of files) vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });

const bench = (k, r) => sandbox.WaterScoreBenchmarkRegistry.calculate(k, r);
const worst = (c) => sandbox.worstBenchmarkClassification(c);

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const IDEAL = { ph: 7.2, tds: 80, turbidity: 0.1, orp: 400, chlorine: 0.3 };

console.log('\nA. Clean reading — worst=PASS, no cap fires, matches pre-fix behavior');
{
  const res = bench('thailand', IDEAL);
  assert(worst(res.classifications) === 'PASS', 'IDEAL reading classifies PASS on Thailand');
  assert(res.score >= 96, `clean score unaffected by the new cap (got ${res.score})`);
}

console.log('\nB. CRITICAL classification now caps at 60 (was previously uncapped)');
{
  const r1 = bench('thailand', { ...IDEAL, chlorine: 0 });
  assert(r1.classifications.chlorine === 'CRITICAL', 'chlorine=0 classifies CRITICAL on Thailand');
  assert(r1.score === 60, `chlorine CRITICAL capped at 60 (got ${r1.score})`);

  const r2 = bench('thailand', { ...IDEAL, tds: 5000 });
  assert(r2.classifications.tds === 'CRITICAL', 'tds=5000 classifies CRITICAL on Thailand');
  assert(r2.score === 60, `tds CRITICAL capped at 60 (got ${r2.score})`);
}

console.log('\nC. FAIL classification caps at 75 (verified fixture, turbidity=6)');
{
  const r = bench('thailand', { ...IDEAL, turbidity: 6 });
  assert(r.classifications.turbidity === 'FAIL', 'turbidity=6 classifies FAIL on Thailand');
  assert(r.score === 75, `turbidity FAIL capped at 75 (got ${r.score})`);
}

console.log('\nD. Real Cases unchanged (all classify PASS on Thailand for their real readings)');
{
  const cases = {
    'New C 8/11': [{ ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 }, 86],
    'New C 8/10': [{ ph: 7.81, tds: 14.672, turbidity: 0.46, orp: 499.3, do: 5.31, chlorine: 0.37 }, 90],
    test1: [{ ph: 7.4, tds: 250, turbidity: 0.2, orp: 300, do: 5, chlorine: 0.2 }, 86],
    'Case 1328': [{ ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3 }, 99]
  };
  for (const [name, [r, expected]] of Object.entries(cases)) {
    const res = bench('thailand', r);
    assert(worst(res.classifications) === 'PASS', `${name}: worst=PASS on Thailand (unaffected by new cap)`);
    assert(res.score === expected, `${name}: Thailand score unchanged at ${expected} (got ${res.score})`);
  }
}

console.log('\nE. PD-015 weakest-link blend / grade curves / weights untouched (spot-check against known catastrophic sweep)');
{
  const one = bench('thailand', { ...IDEAL, tds: 5000 });
  const two = bench('thailand', { ...IDEAL, tds: 5000, turbidity: 50 });
  const three = bench('thailand', { ...IDEAL, tds: 5000, turbidity: 50, chlorine: 10 });
  const all = bench('thailand', { ph: 3, tds: 5000, turbidity: 50, orp: -100, chlorine: 10, do: 0, temp: 80 });
  // These were already <=60 under the pre-existing weakest-link blend, so the new cap is a no-op here —
  // confirms the cap composes correctly with PD-015 math rather than fighting it.
  assert(one.score === 60, `1 catastrophic -> 60 (weakest-link, cap no-op) (got ${one.score})`);
  assert(two.score === 45, `2 catastrophic -> 45 (weakest-link, cap no-op — already below CRITICAL=60) (got ${two.score})`);
  assert(three.score === 30, `3 catastrophic -> 30 (weakest-link, cap no-op) (got ${three.score})`);
  assert(all.score === 0, `all catastrophic -> 0 (weakest-link, cap no-op) (got ${all.score})`);
}

console.log('\nF. Cross-engine isolation — Japan/WHO/EU/US EPA scores byte-unchanged by this fix');
{
  const r = { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 }; // New C 8/11
  assert(bench('japan', r).score === 98, `Japan unaffected (got ${bench('japan', r).score})`);
  assert(bench('who', r).score === 85, `WHO unaffected (got ${bench('who', r).score})`);
  assert(bench('eu', r).score === 65, `EU unaffected (got ${bench('eu', r).score})`);
  assert(bench('usEpa', r).score === 85, `US EPA unaffected (got ${bench('usEpa', r).score})`);
}

console.log('\nG. Severity ordering holds: PASS >= WARNING(85) > FAIL(75) > CRITICAL(60) for Thailand too');
{
  const pass = bench('thailand', IDEAL).score;
  const critical = bench('thailand', { ...IDEAL, chlorine: 0 }).score;
  assert(pass >= 85, 'PASS score is at least as high as the WARNING cap');
  assert(critical === 60, 'CRITICAL score is exactly the CRITICAL cap');
  assert(pass > critical, 'PASS strictly exceeds CRITICAL');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
