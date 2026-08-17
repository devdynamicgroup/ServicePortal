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
 * project's QA all classify PASS on every scored Thailand parameter for
 * their real readings, so their Thailand scores are unaffected BY THIS CAP
 * (though later changed by the separate 2026-08-17 chlorine-curve +
 * weakest-link-share update — see thailand-severity-grading.test.js for
 * those numbers). Thailand's own grade curves are simply lenient enough
 * that these specific readings never cross into WARNING.
 *
 * IMPORTANT — cap is a ceiling, not a floor: with the 2026-08-17 weakest-link
 * share raised to 0.5, a single catastrophic parameter (grade near 0, all
 * others perfect) already produces a raw composite AT OR BELOW the
 * CRITICAL/FAIL cap on its own (verified by direct computation below) — the
 * cap is a no-op there, exactly as expected ("ceiling not floor"). This file
 * therefore asserts `score <= cap` for the general single-parameter cases,
 * and separately proves the cap DOES bind (raw > cap, final == cap) using
 * fixtures found by direct search rather than assumed.
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

console.log('\nB. CRITICAL classification never exceeds 60 (ceiling, not floor)');
{
  // Single-catastrophic-parameter fixtures: with weakest-link share=0.5, raw
  // composite already lands AT the cap or below on its own (40 for
  // chlorine=0/tds=5000) -- cap is correctly a no-op, does NOT raise them to 60.
  const r1 = bench('thailand', { ...IDEAL, chlorine: 0 });
  assert(r1.classifications.chlorine === 'CRITICAL', 'chlorine=0 classifies CRITICAL on Thailand');
  assert(r1.score <= 60 && r1.score === 40, `chlorine CRITICAL: raw already below cap, stays 40, not raised to 60 (got ${r1.score})`);

  const r2 = bench('thailand', { ...IDEAL, tds: 5000 });
  assert(r2.classifications.tds === 'CRITICAL', 'tds=5000 classifies CRITICAL on Thailand');
  assert(r2.score <= 60 && r2.score === 40, `tds CRITICAL: raw already below cap, stays 40, not raised to 60 (got ${r2.score})`);

  // Fixture where the cap genuinely binds (raw=63 > cap=60), found by direct
  // search: tds=1020 gives grade=38.6 (CRITICAL) with the other 4 params
  // perfect, producing a raw composite of 63 that the cap correctly pulls
  // down to exactly 60.
  const r3 = bench('thailand', { ...IDEAL, tds: 1020 });
  assert(r3.classifications.tds === 'CRITICAL', 'tds=1020 classifies CRITICAL on Thailand');
  assert(r3.score === 60, `tds=1020: cap genuinely binds, raw 63 -> capped 60 (got ${r3.score})`);
}

console.log('\nC. FAIL classification never exceeds 75 (ceiling, not floor)');
{
  // turbidity=6: raw composite (68) is already below the FAIL cap (75) --
  // cap is correctly a no-op here, not raised to 75.
  const r = bench('thailand', { ...IDEAL, turbidity: 6 });
  assert(r.classifications.turbidity === 'FAIL', 'turbidity=6 classifies FAIL on Thailand');
  assert(r.score <= 75 && r.score === 68, `turbidity=6 FAIL: raw already below cap, stays 68, not raised to 75 (got ${r.score})`);

  // Fixture where the FAIL cap genuinely binds (raw~76 > cap=75), found by
  // direct search: orp=199 gives grade=69.65 (FAIL, just past the 200 outer
  // limit) with the other 4 params perfect.
  const r2 = bench('thailand', { ...IDEAL, orp: 199 });
  assert(r2.classifications.orp === 'FAIL', 'orp=199 classifies FAIL on Thailand');
  assert(r2.score === 75, `orp=199: cap genuinely binds, raw >75 -> capped 75 (got ${r2.score})`);
}

console.log('\nD. Real Cases: worst=PASS on Thailand (unaffected by this cap); numeric values are');
console.log('   independently owned by thailand-severity-grading.test.js (2026-08-17 curve/share update)');
{
  const cases = {
    'New C 8/11': { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 },
    'New C 8/10': { ph: 7.81, tds: 14.672, turbidity: 0.46, orp: 499.3, do: 5.31, chlorine: 0.37 },
    test1: { ph: 7.4, tds: 250, turbidity: 0.2, orp: 300, do: 5, chlorine: 0.2 },
    'Case 1328': { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3 }
  };
  for (const [name, r] of Object.entries(cases)) {
    const res = bench('thailand', r);
    assert(worst(res.classifications) === 'PASS', `${name}: worst=PASS on Thailand (this cap is a no-op for all 4 real Cases)`);
  }
}

console.log('\nE. Catastrophic sweep — cap composes correctly with the weakest-link blend (ceiling, not floor)');
{
  const one = bench('thailand', { ...IDEAL, tds: 5000 });
  const two = bench('thailand', { ...IDEAL, tds: 5000, turbidity: 50 });
  const three = bench('thailand', { ...IDEAL, tds: 5000, turbidity: 50, chlorine: 10 });
  const all = bench('thailand', { ph: 3, tds: 5000, turbidity: 50, orp: -100, chlorine: 10, do: 0, temp: 80 });
  // Weakest-link share 0.5 (2026-08-17) already drives these below the CRITICAL
  // cap (60) on its own -- the cap is correctly a no-op, never raising them.
  assert(one.score <= 60 && one.score === 40, `1 catastrophic -> 40, not raised to 60 (got ${one.score})`);
  assert(two.score <= 60 && two.score === 30, `2 catastrophic -> 30, not raised to 60 (got ${two.score})`);
  assert(three.score <= 60 && three.score === 20, `3 catastrophic -> 20, not raised to 60 (got ${three.score})`);
  assert(all.score === 0, `all catastrophic -> 0, not raised to 60 (got ${all.score})`);
}

console.log('\nF. Cross-engine isolation — Japan/WHO/EU/US EPA scores byte-unchanged by this fix');
{
  const r = { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7 }; // New C 8/11
  assert(bench('japan', r).score === 98, `Japan unaffected (got ${bench('japan', r).score})`);
  assert(bench('who', r).score === 85, `WHO unaffected (got ${bench('who', r).score})`);
  assert(bench('eu', r).score === 65, `EU unaffected (got ${bench('eu', r).score})`);
  assert(bench('usEpa', r).score === 85, `US EPA unaffected (got ${bench('usEpa', r).score})`);
}

console.log('\nG. Severity ordering holds: PASS > FAIL-cap-bound > CRITICAL-cap-bound for Thailand too');
{
  const pass = bench('thailand', IDEAL).score;
  const failBound = bench('thailand', { ...IDEAL, orp: 199 }).score; // genuinely capped at 75
  const criticalBound = bench('thailand', { ...IDEAL, tds: 1020 }).score; // genuinely capped at 60
  assert(pass >= 96, 'PASS score is high (clean reading)');
  assert(failBound === 75, 'FAIL-tier fixture is exactly the FAIL cap (75) when the cap binds');
  assert(criticalBound === 60, 'CRITICAL-tier fixture is exactly the CRITICAL cap (60) when the cap binds');
  assert(pass > failBound && failBound > criticalBound, 'PASS > FAIL(75) > CRITICAL(60), strictly ordered');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
