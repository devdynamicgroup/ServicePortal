/**
 * PD-008 chlorine forensic repair — boundary + semantic locks.
 * Numeric bands unchanged for TH/EPA/EU; JP DO excluded (PD-012 B).
 * Run: node tests/score/pd008-chlorine-repair.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const engineFiles = [
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

const sandbox = { console, document: { getElementById: () => null }, S: {}, t: (k) => k };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of engineFiles) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

const BASE = Object.freeze({
  ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7, temp: 25
});

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function withCl(cl) {
  return { ...BASE, chlorine: cl };
}

function bench(key, readings) {
  return sandbox.WaterScoreBenchmarkRegistry.calculate(key, readings);
}

console.log('\nPD-008 — provenance metadata');
{
  const th = sandbox.ThailandBenchmarkLimits.chlorine;
  assert(th.min === 0.2 && th.max === 2.0, 'TH band numbers unchanged 0.2–2.0');
  assert(th.minProvenance === 'project-defined' && th.maxProvenance === 'project-defined', 'TH provenance project-defined');
  assert(th.maxCitationStatus === 'NO CITATION', 'TH upper 2.0 citation status NO CITATION');
  assert(th.citedSurveillanceResidual.max === 0.5, 'TH cites DoH surveillance residual max 0.5 without adopting it');
  assert(th.citedSurveillanceResidual.evidenceClass === 'OPERATIONAL', 'TH cited residual classified OPERATIONAL');

  const epa = sandbox.UsEpaBenchmarkLimits.chlorine;
  assert(epa.min === 0.2 && epa.max === 4.0, 'EPA numeric window unchanged');
  assert(epa.projectMin === 0.2 && epa.mrdlMax === 4.0, 'EPA split projectMin + mrdlMax');
  assert(epa.minProvenance === 'project-defined', 'EPA min is project-defined');
  assert(epa.maxProvenance.includes('epa-mrdl'), 'EPA max provenance is MRDL');
  assert(epa.minEvidenceClass === 'PROJECT_DEFINED' && epa.maxEvidenceClass === 'VERIFIED', 'EPA evidence classes split');

  const eu = sandbox.EuBenchmarkLimits.chlorine;
  assert(eu.min === 0.1 && eu.max === 0.5, 'EU band numbers unchanged');
  assert(eu.directiveFreeChlorineResidual === false, 'EU free-Cl not Directive-derived');
  assert(sandbox.EuBenchmarkLimits.gateCapOnChlorineFail === 65, 'EU gate 65 unchanged (PD-002)');
  assert(sandbox.EuBenchmarkLimits.gateCapProvenance === 'project-defined-pd-002', 'EU gate provenance PD-002');
  assert(sandbox.EuBenchmarkLimits.gateCapEvidenceClass === 'UNSUPPORTED', 'EU gate evidence UNSUPPORTED');
}

console.log('\nPD-008 — TH chlorine boundaries (numeric lock)');
{
  const pts = [0.19, 0.20, 0.49, 0.50, 0.51, 1.0, 2.0];
  for (const cl of pts) {
    const r = bench('thailand', withCl(cl));
    const inCompliance = cl >= 0.2 && cl <= 2.0;
    const inExcellent = cl >= 0.2 && cl <= 0.5;
    assert(r.statuses.chlorine === (inCompliance ? 'good' : 'attn'),
      `TH Cl=${cl} compliance status ${r.statuses.chlorine}`);
    if (inExcellent) assert(r.params.chlorine === 100, `TH Cl=${cl} inner residual → grade 100`);
    if (inCompliance && !inExcellent) {
      // Chlorine curve steepened (2026-08-17, PO-approved): grade now ranges
      // down to 10 at cl=2.0 (was bounded at >=70) -- still classifies as
      // in-compliance (status='good'), but the grade itself is far more
      // severity-sensitive within the 0.5-2.0 band now.
      assert(r.params.chlorine < 100 && r.params.chlorine >= 10,
        `TH Cl=${cl} still in 0.2–2.0 band but severity-graded (${r.params.chlorine})`);
    }
    if (!inCompliance) assert(r.params.chlorine < 100, `TH Cl=${cl} out-of-band → <100`);
  }
  const above = bench('thailand', withCl(2.01));
  assert(above.params.chlorine < 100, 'TH Cl=2.01 out of band');
  const msg = JSON.stringify(above.reasons || []);
  assert(msg.includes('project compliance band'), 'TH over-max message is project-labeled');
  assert(!msg.includes('drinking-water residual guidance (0.2–2.0)'), 'TH no longer claims verified residual guidance for 0.2–2.0');
}

console.log('\nPD-008 — EPA chlorine boundaries (numeric lock + MRDL semantic)');
{
  // 2026-08-18 (PO-approved): per-country chlorine curves were replaced by
  // one shared formula (computeSharedBenchmarkBase's gradeChlorine) — EPA no
  // longer has its own inner plateau to test here. The shared curve's own
  // plateau is 0.2-0.5 (flat 100), then declines monotonically to a floor;
  // EPA's numeric window (0.2-4.0) and MRDL semantics/messaging below are
  // still EPA-owned and asserted unchanged.
  const pts = [0.19, 0.20, 0.49, 0.50, 1.0, 2.0, 3.9, 4.0, 4.01];
  for (const cl of pts) {
    const r = bench('usEpa', withCl(cl));
    const inPlateau = cl >= 0.2 && cl <= 0.5;
    const inWindow = cl >= 0.2 && cl <= 4.0;
    if (inPlateau) assert(r.params.chlorine === 100, `EPA Cl=${cl} in shared plateau → 100`);
    else if (inWindow) assert(r.params.chlorine < 100, `EPA Cl=${cl} in window but declining → <100`);
    else assert(r.params.chlorine < 100, `EPA Cl=${cl} outside → <100`);
  }
  const hi = bench('usEpa', withCl(4.01));
  const hiMsg = JSON.stringify(hi.reasons || []);
  assert(hiMsg.includes('MRDL') && hiMsg.includes('4.0'), 'EPA over-max cites MRDL ceiling');
  const lo = bench('usEpa', withCl(0.19));
  const loMsg = JSON.stringify(lo.reasons || []);
  assert(loMsg.includes('project residual floor') || loMsg.includes('not an EPA MRDL'), 'EPA under-min is project floor, not EPA MRDL');
  assert(!JSON.stringify(bench('usEpa', withCl(0.7)).topPositiveFactors || []).includes('MRDL-style comparison band (0.2–4'),
    'EPA positive factor no longer claims 0.2–4 as MRDL Ideal band');
}

console.log('\nPD-008 — EU chlorine boundaries + gate 65');
{
  // 2026-08-18 (PO-approved): per-country chlorine curves were replaced by
  // one shared formula — EU's own "in-band = grade 100" curve shape no
  // longer applies (the shared curve's own plateau is narrower, 0.2-0.5,
  // and EU's compliance band starts at 0.1). Gate behavior (EU's own,
  // PD-002, unchanged) is still tested below.
  const pts = [0.09, 0.10, 0.49, 0.50, 0.51];
  for (const cl of pts) {
    const r = bench('eu', withCl(cl));
    const inBand = cl >= 0.1 && cl <= 0.5;
    if (inBand) {
      assert(r.gated !== true, `EU Cl=${cl} not gated`);
    } else {
      assert(r.score <= 65, `EU Cl=${cl} score capped ≤65 (got ${r.score})`);
      assert(r.gated === true, `EU Cl=${cl} gated`);
    }
  }
  const fail = bench('eu', withCl(0.51));
  const failMsg = JSON.stringify(fail.reasons || []);
  assert(failMsg.includes('project residual') || failMsg.includes('not a Directive'), 'EU fail message de-claims Directive residual');
  assert(!failMsg.includes('EU parametric residual value'), 'EU no longer claims Directive parametric residual value');
  assert(fail.standardRevision.includes('project-defined') || fail.standardRevision.includes('project'),
    'EU standardRevision acknowledges project free-Cl');
  const thBase = bench('thailand', withCl(0.7));
  assert(thBase.standardRevision.includes('project') || thBase.standardRevision.includes('PD-008'),
    'TH standardRevision does not claim verified Thai Cl Ideal');
  assert(!thBase.standardRevision.includes('Drinking Water Standard 2024'),
    'TH standardRevision no longer overclaims Drinking Water Standard 2024 for Cl band');
  const epaBase = bench('usEpa', withCl(0.7));
  assert(epaBase.standardRevision.includes('project floor') && epaBase.standardRevision.includes('MRDL'),
    'EPA standardRevision splits project floor vs MRDL');
}

console.log('\n2026-08-18 (PO-approved) — missing chlorine computes a capped score, never incomplete');
{
  for (const bad of [null, undefined, '', false, NaN, Infinity]) {
    const th = bench('thailand', withCl(bad));
    assert(Number.isFinite(th.score), `TH missing Cl (${String(bad)}) → finite score (got ${th.score})`);
    assert(th.score <= 79, `TH missing Cl (${String(bad)}) → capped ≤79 (got ${th.score})`);
    assert(th.classifications.chlorine === 'NOT_MEASURED', `TH missing Cl (${String(bad)}) → NOT_MEASURED`);
    assert(th.params.chlorine === undefined, `TH missing Cl (${String(bad)}) → params omit graded chlorine`);
    assert((th.reasons || []).some((r) => r.parameter === 'chlorine' && /not been measured/i.test(r.message)),
      `TH missing Cl (${String(bad)}) → provisional reason present`);
  }
  // Every engine — not just Thailand — must honor the same rule.
  for (const key of ['thailand', 'japan', 'who', 'eu', 'usEpa']) {
    const r = bench(key, withCl(null));
    assert(Number.isFinite(r.score), `${key} missing Cl → finite score (got ${r.score})`);
    assert(r.score <= 79, `${key} missing Cl → capped ≤79 (got ${r.score})`);
  }
  // A genuinely clean reading set without chlorine must still be capped —
  // proves the cap is not merely a side effect of other params being weak.
  const cleanTh = bench('thailand', { ph: 7.2, tds: 150, turbidity: 0.5, orp: 400, chlorine: null });
  assert(Number.isFinite(cleanTh.score) && cleanTh.score <= 79,
    `TH clean reading set minus chlorine still capped ≤79 (got ${cleanTh.score})`);
}

console.log('\nPD-008 / PD-012 — JP DO excluded from Compliance Index (PD-012 B)');
{
  const W = sandbox.JapanBenchmarkWeights;
  assert(W.turbidity === 0.22 && W.chlorine === 0.22 && W.ph === 0.16 && W.tds === 0.16
    && W.do === 0.12 && W.orp === 0.12, 'JP-WEIGHTS magnitudes unchanged (PD-013 A)');
  assert(sandbox.JapanBenchmarkLimits.do.min === 5, 'JP do.min remains 5 (provenance only; not scored)');

  const at = bench('japan', { ...BASE, do: 5.0 });
  const below = bench('japan', { ...BASE, do: 4.9 });
  assert(Number.isFinite(at.score), 'JP DO=5 → finite score');
  assert(Number.isFinite(below.score), 'JP DO=4.9 → finite score');
  assert(at.classifications.do === 'NOT_EVALUATED', 'JP DO=5 → NOT_EVALUATED');
  assert(below.classifications.do === 'NOT_EVALUATED', 'JP DO=4.9 → NOT_EVALUATED');
  // 2026-08-18 (PO-approved): DO is now part of the shared grading base for
  // every engine, including Japan, when present — only Japan's own
  // PASS/FAIL classification of DO stays opinion-free (NOT_EVALUATED,
  // asserted above). The numeric grade DOES now reflect DO when present.
  assert(typeof at.params.do === 'number', 'JP params DO now numerically graded when present (shared base)');
  assert(at.params.do !== below.params.do, 'JP graded DO differs between 5.0 and 4.9 (shared curve is sensitive there)');
  assert(!(at.topPositiveFactors || []).some((s) => /dissolved oxygen/i.test(s)), 'JP no DO positive factor');
  assert(!(at.reasons || []).some((r) => r.parameter === 'do'), 'JP no DO reason');

  const miss = bench('japan', { ...BASE, do: null });
  assert(Number.isFinite(miss.score), 'JP missing DO → finite score (not incomplete)');
  assert(miss.classifications.do === 'NOT_EVALUATED', 'JP missing DO → NOT_EVALUATED');
}

console.log('\nPD-008 — baseline + cross-engine isolation');
{
  const q = sandbox.computeScoreFromReadings(BASE);
  assert(q === 76, `Quality V3 still 76 (got ${q})`);
  // 2026-08-18 (PO-approved): all 5 engines now share one grading formula
  // (computeSharedBenchmarkBase); raw base for BASE = 76 for every engine.
  // Thailand/Japan have no severity cap binding here, so they stay at raw 76.
  assert(bench('thailand', BASE).score === 76, 'TH baseline 76 (shared base, no cap)');
  assert(bench('japan', BASE).score === 76, 'JP baseline 76 (shared base, no cap)');
  // WHO classifies do=5.3 as FAIL; FAIL cap (75) does not lower a raw 76 below itself,
  // but WHO's own severity protection still binds at the FAIL cap value.
  assert(bench('who', BASE).score === 75, 'WHO baseline 75 (FAIL cap)');
  assert(bench('eu', BASE).score === 65, 'EU baseline 65');
  assert(bench('usEpa', BASE).score === 75, 'EPA baseline 75 (FAIL cap, do classifies FAIL)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
