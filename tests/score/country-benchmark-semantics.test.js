/**
 * Country Benchmark semantic contract — PD-005 / PD-001 presentation + frozen math.
 * Run: node tests/score/country-benchmark-semantics.test.js
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

const sandbox = {
  console,
  document: { getElementById: () => null },
  S: { lang: 'en', publicScoreView: false, scoreStandardKey: 'thailand', comparisonScoreResult: null },
  t: (k) => k
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of engineFiles) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}
vm.runInContext(fs.readFileSync(path.join(root, 'src/js/flows/score.js'), 'utf8'), sandbox, {
  filename: 'src/js/flows/score.js'
});

const decisionDoc = fs.readFileSync(path.join(root, 'docs/quality-v3/UNRESOLVED_DECISIONS.md'), 'utf8');
const i18nSrc = fs.readFileSync(path.join(root, 'src/js/i18n.js'), 'utf8');
const scoreFlowSrc = fs.readFileSync(path.join(root, 'src/js/flows/score.js'), 'utf8');

// PD-014 D1/D2/D3 (2026-08-14): orp=515 now inner-declines on every engine
// (was flat 100 for the whole 200-600 band); Q-V3 (76) and EU (65, gated by
// chlorine) are unaffected by D1-D3.
// WARNING severity cap=85 (2026-08-14, PO-approved numeric): this reading's
// worst classification on WHO/EPA is WARNING (chlorine/do), now capped 85
// (was 93/98).
const BASELINE = Object.freeze({
  readings: { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7, temp: 25 },
  quality: 76,
  thailand: 86,
  japan: 98,
  who: 85,
  eu: 65,
  usEpa: 85
});

const KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function bench(key, readings) {
  return sandbox.WaterScoreBenchmarkRegistry.calculate(key, readings);
}

console.log('\nGovernance — all five PDs DECIDED A');
{
  assert(/PD-005[\s\S]*?\*\*Status:\*\* DECIDED/.test(decisionDoc), 'PD-005 Status DECIDED');
  assert(/PD-001[\s\S]*?\*\*Status:\*\* DECIDED/.test(decisionDoc), 'PD-001 Status DECIDED');
  assert(decisionDoc.includes('FORBID MAGNITUDE RANKING'), 'PD-005 Decision A recorded');
  assert(decisionDoc.includes('PASS-BAND') || decisionDoc.includes('pass-band'), 'PD-001 Decision A recorded');


  // PD-010/011 Ideal KEEP+LABEL locks (ledger Status asserts deferred until UNRESOLVED PD-010/011 sections land)
  const qv3Src = fs.readFileSync(path.join(root, 'src/js/score/production/computeQualityScoreV2.js'), 'utf8');
  assert(qv3Src.includes('PD-011 A'), 'Q-V3 source carries PD-011 A labels');
  assert(!/pH center 7\.2 = midpoint of common 6\.5–8\.5/.test(qv3Src), 'false pH midpoint claim removed');
  assert(qv3Src.includes('Math.abs(ph - 7.2)'), 'pH center 7.2 numeric unchanged');
  assert(qv3Src.includes('tds <= 80'), 'TDS ≤80 numeric unchanged');
  assert(qv3Src.includes('Math.abs(orp - 400)'), 'ORP 400 numeric unchanged');
  assert(qv3Src.includes('doValue >= 8.0'), 'DO ≥8 numeric unchanged');
  assert(qv3Src.includes('lerp(fcl, 0.5, 100, 1.0, 46)'), 'Cl high-side 46@1.0 unchanged');
  assert(i18nSrc.includes("'score.about.qualityNote'"), 'qualityNote i18n key exists');
  assert(i18nSrc.includes('PROJECT-DEFINED'), 'PROJECT-DEFINED Ideal labeling present');

  const pd002decisions = ['KEEP AS EXPLICIT PROJECT HARD GATE', 'UNSUPPORTED ANCHOR'];
  const pd003decisions = ['KEEP DO EXCLUDED AS PROJECT DESIGN'];
  const pd004decisions = ['KEEP AS SHARED OPERATIONAL / PROJECT BAND'];

  for (const id of ['002', '003', '004']) {
    const block = decisionDoc.match(new RegExp(`## PD-${id}:[\\s\\S]*?(?=\\n## |$)`));
    assert(block, `PD-${id} record exists`);
    const text = block[0];
    assert(/\*\*Status:\*\* DECIDED/.test(text), `PD-${id} Status DECIDED`);
    assert(/\*\*Recommendation:\*\* A/.test(text), `PD-${id} Recommendation A`);
    assert(/\*\*PO Approval:\*\* APPROVED/.test(text), `PD-${id} PO Approval APPROVED`);
    assert(/\*\*Approved by:\*\* Product Owner/.test(text), `PD-${id} Approved by Product Owner`);
    assert(/\*\*Date:\*\* 2026-08-11/.test(text), `PD-${id} Date recorded`);
  }

  const pd002block = decisionDoc.match(/## PD-002:[\s\S]*?(?=\n## |$)/)[0];
  for (const phrase of pd002decisions) assert(pd002block.includes(phrase), `PD-002 contains "${phrase}"`);
  assert(pd002block.includes('NOT an EU Directive score'), 'PD-002 preserves EU non-regulatory claim');

  const pd003block = decisionDoc.match(/## PD-003:[\s\S]*?(?=\n## |$)/)[0];
  for (const phrase of pd003decisions) assert(pd003block.includes(phrase), `PD-003 contains "${phrase}"`);
  assert(pd003block.includes('NOT prove that Thai law'), 'PD-003 preserves conservative legal wording');

  const pd004block = decisionDoc.match(/## PD-004:[\s\S]*?(?=\n## |$)/)[0];
  for (const phrase of pd004decisions) assert(pd004block.includes(phrase), `PD-004 contains "${phrase}"`);
  assert(pd004block.includes('NOT five independent national'), 'PD-004 preserves shared-band framing');
}

console.log('\nBaseline replay — scoring math frozen');
{
  const r = BASELINE.readings;
  const q = sandbox.computeScoreFromReadings(r);
  assert(q === BASELINE.quality, `Quality V3 = ${BASELINE.quality} (got ${q})`);
  assert(bench('thailand', r).score === BASELINE.thailand, `Thailand = ${BASELINE.thailand}`);
  assert(bench('japan', r).score === BASELINE.japan, `Japan = ${BASELINE.japan}`);
  assert(bench('who', r).score === BASELINE.who, `WHO = ${BASELINE.who}`);
  assert(bench('eu', r).score === BASELINE.eu, `EU = ${BASELINE.eu}`);
  assert(bench('usEpa', r).score === BASELINE.usEpa, `US EPA = ${BASELINE.usEpa}`);
}

console.log('\nPD-005 — no ranking semantics / equal scores valid');
{
  assert(i18nSrc.includes('not a country ranking'), 'disclaimer forbids country ranking');
  assert(i18nSrc.includes('higher score = better country') || i18nSrc.includes('คะแนนสูงกว่า = ประเทศดีกว่า'),
    'disclaimer forbids higher=better-country');
  assert(!/best country|worst country|country ranking|leaderboard/i.test(scoreFlowSrc.replace(/PD-005[\s\S]*?ranking/g, '')),
    'score flow does not introduce best/worst country ranking');
  const overlap = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06 };
  const thOverlap = bench('thailand', overlap).score;
  const jpOverlap = bench('japan', overlap).score;
  // Raw composite is 100 on both engines for this reading; Country Hero
  // ceiling caps both at 99 — equality is still valid (inner-plateau overlap).
  assert(thOverlap === jpOverlap && thOverlap === 99, 'equal TH/JP scores remain valid (inner-plateau overlap)');
  const thBaseline = bench('thailand', BASELINE.readings);
  const jpBaseline = bench('japan', BASELINE.readings);
  // PD-014 D1 (2026-08-14): orp=515 now inner-declines on both engines, so
  // TH (97) and JP (98) genuinely differ — no longer identical via any
  // mechanism. This is the intended product fix: ordinary water no longer
  // collapses to one shared number.
  assert(thBaseline.score === 86 && jpBaseline.score === 98,
    'BASELINE TH 86 !== JP 98 (real separation, not a ranking)');
  assert(thBaseline.params.chlorine < 100, 'TH chlorine grade already below 100 pre-ceiling (in-band severity)');
  assert(jpBaseline.params.orp < 100, 'JP orp grade now below 100 for orp=515 (PD-014 D1 inner decline)');
  assert(!scoreFlowSrc.includes('strictest cleanliness expectations'),
    'dropdown order comment no longer implies quality ranking');
}

console.log('\nPD-001 — comparison presentation is pass-band, not Excellent');
{
  assert(typeof sandbox.comparisonPresentationVerdict === 'function', 'comparisonPresentationVerdict exists');
  const present100 = sandbox.comparisonPresentationVerdict(100);
  const present95 = sandbox.comparisonPresentationVerdict(95);
  const present65 = sandbox.comparisonPresentationVerdict(65);
  assert(present100.label === 'score.benchmark.verdict.passBand', `100 → passBand (got ${present100.label})`);
  assert(present95.label === 'score.benchmark.verdict.passBand', `95 → passBand (got ${present95.label})`);
  assert(present65.label === 'score.benchmark.verdict.withinLimits', `65 → withinLimits (got ${present65.label})`);
  assert(!String(present100.label).toLowerCase().includes('excellent'), 'comparison presentation is not Excellent');

  const qualityVerdict = sandbox.customerVerdict(92);
  assert(qualityVerdict.label === 'score.verdict.excellent', 'customer customerVerdict still Excellent for high scores');

  assert(typeof sandbox.qualityPublishPresentation === 'function', 'qualityPublishPresentation exists');
  const failOverride = sandbox.qualityPublishPresentation(92, 'FAIL');
  assert(failOverride.label === 'score.verdict.complianceFail', `FAIL overrides Excellent (got ${failOverride.label})`);
  assert(failOverride.tier === 'low', 'FAIL override tier is low');
  assert(failOverride.complianceOverride === true, 'FAIL sets complianceOverride');
  assert(failOverride.complianceOverrideKind === 'FAIL', 'FAIL sets complianceOverrideKind');
  const warnOverride = sandbox.qualityPublishPresentation(92, 'WARNING');
  assert(warnOverride.label === 'score.verdict.complianceWarning', `WARNING overrides Excellent (got ${warnOverride.label})`);
  assert(warnOverride.tier === 'low', 'WARNING override tier is low');
  assert(warnOverride.complianceOverride === true, 'WARNING sets complianceOverride');
  assert(warnOverride.complianceOverrideKind === 'WARNING', 'WARNING sets complianceOverrideKind');
  const warnGood = sandbox.qualityPublishPresentation(65, 'WARNING');
  assert(warnGood.complianceOverride === true, 'WARNING also blocks Good/Acceptable');
  const passOk = sandbox.qualityPublishPresentation(92, 'PASS');
  assert(passOk.label === 'score.verdict.excellent', 'PASS keeps Excellent on Quality path');
  assert(passOk.complianceOverride !== true, 'PASS does not set complianceOverride');
  assert(i18nSrc.includes("'score.verdict.complianceFail'"), 'complianceFail i18n key exists');
  assert(i18nSrc.includes("'score.verdict.complianceWarning'"), 'complianceWarning i18n key exists');
  assert(i18nSrc.includes("'score.msg.complianceWarningOverride'"), 'complianceWarningOverride i18n key exists');
  assert(i18nSrc.includes('compliance failed') || i18nSrc.includes('Compliance'), 'EN complianceFail wording present');
  assert(i18nSrc.includes('compliance warning') || i18nSrc.includes('WARNING'), 'EN complianceWarning wording present');
  assert(scoreFlowSrc.includes("status === 'WARNING'"), 'score flow handles WARNING override');


  const compare = sandbox.buildComparisonScoreResult(BASELINE.readings, 'thailand');
  assert(compare.score === 86, 'comparison numeric score matches Thailand engine (86 after ordinary-band severity)');
  assert(compare.verdict === 'score.benchmark.verdict.passBand', `comparison result.verdict is pass-band (got ${compare.verdict})`);
  assert(compare.engineVerdict === 'Good', `engineVerdict is Good for ordinary baseline (got ${compare.engineVerdict})`);

  assert(i18nSrc.includes("'score.benchmark.verdict.passBand'"), 'passBand i18n key exists');
  assert(i18nSrc.includes('Within pass band'), 'EN pass-band wording present');
}

console.log('\nModel integrity — engines untouched numerically');
{
  assert(sandbox.EuBenchmarkLimits.gateCapOnChlorineFail === 65, 'EU gate still 65');
  assert(sandbox.ThailandBenchmarkWeights.do === undefined, 'TH DO still excluded');
  for (const key of KEYS) {
    const name = {
      thailand: 'ThailandBenchmarkLimits',
      japan: 'JapanBenchmarkLimits',
      who: 'WhoBenchmarkLimits',
      eu: 'EuBenchmarkLimits',
      usEpa: 'UsEpaBenchmarkLimits'
    }[key];
    const L = sandbox[name];
    assert(L.orp.min === 200 && L.orp.max === 600, `${key} ORP unchanged`);
  }
}

console.log('\nPD-003 — Thailand DO/Temp classification is NOT_EVALUATED, never PASS');
{
  const th = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', BASELINE.readings);
  assert(th.score === 86, 'TH baseline 86 after ordinary-band severity (DO still excluded)');
  assert(th.classifications.do === 'NOT_EVALUATED', `TH measured DO → NOT_EVALUATED (got ${th.classifications.do})`);
  assert(th.classifications.temp === 'NOT_EVALUATED', `TH measured temp → NOT_EVALUATED (got ${th.classifications.temp})`);
  assert(th.statuses.do !== 'good', 'TH DO status is not good');
  assert(!(th.passedParameters || []).includes('do'), 'TH DO not in passedParameters');
  assert(!(th.passedParameters || []).includes('temp'), 'TH temp not in passedParameters');

  const thNullDo = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', { ...BASELINE.readings, do: null, temp: null });
  assert(thNullDo.score === 86, 'TH score unchanged with null DO/temp');
  assert(thNullDo.classifications.do === 'NOT_EVALUATED', 'TH null DO → NOT_EVALUATED (not PASS via Number(null)===0)');
  assert(thNullDo.classifications.temp === 'NOT_EVALUATED', 'TH null temp → NOT_EVALUATED');
}

console.log('\nPD-012 B — Japan DO excluded from Compliance Index (I2 den)');
{
  const W = sandbox.JapanBenchmarkWeights;
  assert(W.do === 0.12 && W.ph === 0.16 && W.orp === 0.12, 'JP-WEIGHTS do:0.12 retained (PD-013 A)');
  const expectedDen = W.ph + W.tds + W.chlorine + W.turbidity + W.orp;
  assert(Math.abs(expectedDen - 0.88) < 1e-9, `expected scored den = 0.88 (got ${expectedDen})`);

  const low = bench('japan', { ...BASELINE.readings, do: 2.0 });
  const high = bench('japan', { ...BASELINE.readings, do: 9.0 });
  const miss = bench('japan', { ...BASELINE.readings, do: null });
  assert(Number.isFinite(low.score) && Number.isFinite(high.score) && Number.isFinite(miss.score), 'JP scores finite with low/high/missing DO');
  assert(low.score === high.score, 'JP score identical for low vs high DO');
  assert(low.score === miss.score, 'JP score identical for low vs missing DO');
  assert(low.classifications.do === 'NOT_EVALUATED' && high.classifications.do === 'NOT_EVALUATED' && miss.classifications.do === 'NOT_EVALUATED', 'JP DO always NOT_EVALUATED');
  assert(low.params.do === undefined && !Object.prototype.hasOwnProperty.call(low.params, 'do'), 'JP graded params omit do');
  // Reconstruct den from scored grades to prove DO weight not in composite.
  let num = 0;
  let den = 0;
  for (const key of ['ph', 'tds', 'chlorine', 'turbidity', 'orp']) {
    num += low.params[key] * W[key];
    den += W[key];
  }
  assert(Math.abs(den - 0.88) < 1e-9, 'reconstructed den excludes do:0.12');
  // low.score is post-Hero-ceiling; compare against the raw weighted mean
  // through the same shared ceiling function, not a duplicated formula.
  const rawMean = Math.round(num / den);
  assert(sandbox.applyCountryBenchmarkHeroCeiling(rawMean) === low.score,
    `JP score matches five-param weighted mean through Hero ceiling (raw ${rawMean} -> ${low.score})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
