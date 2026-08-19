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

// 2026-08-18 (PO-approved): all 5 engines now share one grading formula
// (computeSharedBenchmarkBase); raw base for this reading = 76 for every
// engine. Thailand has no severity cap binding here, so it stays at raw 76
// (coincidentally equal to Quality V3 — see PD-005 section below for why
// that's fine). Japan's own tighter pH band (7.3-7.7) classifies ph=7.85
// WARNING, and the guaranteed minimum deduction
// (COUNTRY_SEVERITY_MIN_DEDUCTION.WARNING=3) takes it to 73 even though the
// 85 ceiling doesn't bind. WHO/US EPA both classify chlorine/do FAIL,
// and the guaranteed minimum deduction (FAIL=6) takes raw 76 down to 70
// even though the 75 ceiling doesn't bind either. EU's PD-002 chlorine gate
// is unaffected, still 65.
const BASELINE = Object.freeze({
  readings: { ph: 7.85, tds: 175, turbidity: 0.42, orp: 515, do: 5.3, chlorine: 0.7, temp: 25 },
  quality: 76,
  thailand: 76,
  japan: 73,
  who: 70,
  eu: 65,
  usEpa: 70
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
  // 2026-08-18 (PO-approved): grading is shared, so TH and JP now
  // genuinely CAN coincide when neither country's own classification/cap
  // distinguishes them (as with COINCIDE below) — PD-005 forbids reading
  // that coincidence as a tie/ranking too. This overlap fixture instead now
  // demonstrates the opposite: Japan's own government-cited "comfortable
  // water" pH target (7.3-7.7 — see japan/limits.js) is tighter than every
  // other engine's pH band, so pH=7.79 (still fine everywhere else) already
  // classifies WARNING on Japan alone and caps it at 85 while Thailand stays
  // at the shared raw base (92) — a second, independent way scores can
  // genuinely differ, not a ranking signal either.
  const overlap = { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3, temp: 28.06 };
  const thOverlap = bench('thailand', overlap).score;
  const jpOverlap = bench('japan', overlap).score;
  assert(thOverlap === 92 && jpOverlap === 85 && thOverlap !== jpOverlap,
    'TH 92 !== JP 85 — Japan\'s own tighter pH target caps it (not Thailand\'s)');
  // BASELINE itself (ph=7.85) is now OUTSIDE Japan's 7.3-7.7 comfortable
  // band too, so it no longer coincides either: Japan classifies ph
  // WARNING and the 2026-08-18 guaranteed minimum deduction
  // (COUNTRY_SEVERITY_MIN_DEDUCTION.WARNING=3) takes 76 down to 73 even
  // though the 85 WARNING ceiling never binds. COINCIDE below (ph=7.5,
  // otherwise identical to BASELINE) keeps pH inside Japan's own band, so
  // both engines see worst=PASS and share the same raw base.
  const thBaseline = bench('thailand', BASELINE.readings);
  const jpBaseline = bench('japan', BASELINE.readings);
  assert(thBaseline.score === 76 && jpBaseline.score === 73 && thBaseline.score !== jpBaseline.score,
    'BASELINE TH 76 !== JP 73 — Japan\'s own pH WARNING + guaranteed deduction, not Thailand\'s');
  const coincide = { ...BASELINE.readings, ph: 7.5 };
  const thCoincide = bench('thailand', coincide).score;
  const jpCoincide = bench('japan', coincide).score;
  assert(thCoincide === 77 && jpCoincide === 77 && thCoincide === jpCoincide,
    'TH 77 === JP 77 (shared grading, ph inside Japan\'s own band too, no country cap binds — not a ranking signal)');
  // 2026-08-19 (PO-approved, evidence-based): Thailand's own TDS/turbidity
  // passMax were corrected to real cited Thai standards (DOH 2020 ≤500 /
  // MWA spec ≤1.0) — this fixture is re-picked so it still clears
  // Thailand's now-tighter bounds while still failing Japan's own stricter
  // comfort-target thresholds (pH ideal 7.3-7.7 / TDS ideal ≤200).
  const diverge = { ph: 8.0, tds: 350, turbidity: 0.5, orp: 400, do: 6, chlorine: 0.5, temp: 26 };
  const thDiverge = bench('thailand', diverge).score;
  const jpDiverge = bench('japan', diverge).score;
  assert(thDiverge === 81 && jpDiverge === 75 && thDiverge !== jpDiverge,
    'TH/JP scores genuinely differ on a fixture where Japan\'s own FAIL classification + severity cap caps it (81 vs 75)');
  assert(thBaseline.params.chlorine < 100, 'TH chlorine grade already below 100 pre-ceiling (in-band severity)');
  assert(jpBaseline.params.orp < 100, 'JP orp grade now below 100 for orp=515 (PD-014 D1 inner decline)');
  assert(!scoreFlowSrc.includes('strictest cleanliness expectations'),
    'dropdown order comment no longer implies quality ranking');
}

console.log('\nPD-001 (superseded 2026-08-18, commit f586d40a) — comparison presentation now reuses Excellent/Good/Needs attention wording, same as customerVerdict');
{
  // 2026-08-18 (post dbd161d2, external commit f586d40a): comparisonPresentationVerdict
  // was further simplified to delegate straight to customerVerdict — the
  // distinct "passBand/withinLimits/outsideLimits" wording this section used
  // to lock in no longer exists; country comparison and Quality/publish now
  // share one label set, not two.
  assert(typeof sandbox.comparisonPresentationVerdict === 'function', 'comparisonPresentationVerdict exists');
  const present100 = sandbox.comparisonPresentationVerdict(100);
  const present95 = sandbox.comparisonPresentationVerdict(95);
  const present65 = sandbox.comparisonPresentationVerdict(65);
  assert(present100.label === 'score.verdict.excellent', `100 → excellent (got ${present100.label})`);
  assert(present95.label === 'score.verdict.excellent', `95 → excellent (got ${present95.label})`);
  assert(present65.label === 'score.verdict.good', `65 → good (got ${present65.label})`);

  const qualityVerdict = sandbox.customerVerdict(92);
  assert(qualityVerdict.label === 'score.verdict.excellent', 'customer customerVerdict still Excellent for high scores');

  assert(typeof sandbox.qualityPublishPresentation === 'function', 'qualityPublishPresentation exists');
  // 2026-08-18 (PO-approved): label/color/tier now always come from
  // customerVerdict(wq) — no compliance-driven override — so a high score
  // still reads Excellent/blue even when compliance FAILs. The compliance
  // signal survives only via complianceOverride/complianceOverrideKind,
  // which drive a separate note (score.msg.complianceFailOverride/
  // complianceWarningOverride), not the main tier label.
  const failOverride = sandbox.qualityPublishPresentation(92, 'FAIL');
  assert(failOverride.label === 'score.verdict.excellent', `FAIL no longer overrides the label (got ${failOverride.label})`);
  assert(failOverride.tier === 'high', 'FAIL no longer overrides the tier');
  assert(failOverride.complianceOverride === true, 'FAIL still sets complianceOverride (for the separate note)');
  assert(failOverride.complianceOverrideKind === 'FAIL', 'FAIL sets complianceOverrideKind');
  const warnOverride = sandbox.qualityPublishPresentation(92, 'WARNING');
  assert(warnOverride.label === 'score.verdict.excellent', `WARNING no longer overrides the label (got ${warnOverride.label})`);
  assert(warnOverride.tier === 'high', 'WARNING no longer overrides the tier');
  assert(warnOverride.complianceOverride === true, 'WARNING still sets complianceOverride (for the separate note)');
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
  assert(compare.score === 76, 'comparison numeric score matches Thailand engine (76, shared grading base)');
  // 2026-08-18 (post dbd161d2, external commit f586d40a): comparisonPresentationVerdict
  // now delegates to customerVerdict — 76 falls in the 51-80 "good" tier.
  assert(compare.verdict === 'score.verdict.good', `comparison result.verdict is good (got ${compare.verdict})`);
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
  assert(th.score === 76, 'TH baseline 76 (shared grading base; DO classification still excluded)');
  assert(th.classifications.do === 'NOT_EVALUATED', `TH measured DO → NOT_EVALUATED (got ${th.classifications.do})`);
  assert(th.classifications.temp === 'NOT_EVALUATED', `TH measured temp → NOT_EVALUATED (got ${th.classifications.temp})`);
  assert(th.statuses.do !== 'good', 'TH DO status is not good');
  assert(!(th.passedParameters || []).includes('do'), 'TH DO not in passedParameters');
  assert(!(th.passedParameters || []).includes('temp'), 'TH temp not in passedParameters');

  const thNullDo = sandbox.WaterScoreBenchmarkRegistry.calculate('thailand', { ...BASELINE.readings, do: null, temp: null });
  // 2026-08-18 (PO-approved): DO is now part of the shared grading base when
  // present, so removing it changes the numeric average (76 -> 79 here,
  // since the below-ideal do=5.3 grade is dropped from the average) — only
  // the classification stays NOT_EVALUATED (unchanged, asserted below).
  assert(thNullDo.score === 79, 'TH score DOES shift with null DO (do drops out of the shared grading average)');
  assert(thNullDo.classifications.do === 'NOT_EVALUATED', 'TH null DO → NOT_EVALUATED (not PASS via Number(null)===0)');
  assert(thNullDo.classifications.temp === 'NOT_EVALUATED', 'TH null temp → NOT_EVALUATED');
}

console.log('\nPD-012 B — Japan DO excluded from Compliance Index classification, not from shared grading');
{
  const W = sandbox.JapanBenchmarkWeights;
  assert(W.do === 0.12 && W.ph === 0.16 && W.orp === 0.12, 'JP-WEIGHTS do:0.12 retained (PD-013 A) — vestigial, no longer drives scoring');
  const expectedDen = W.ph + W.tds + W.chlorine + W.turbidity + W.orp;
  assert(Math.abs(expectedDen - 0.88) < 1e-9, `expected scored den = 0.88 (got ${expectedDen})`);

  const low = bench('japan', { ...BASELINE.readings, do: 2.0 });
  const high = bench('japan', { ...BASELINE.readings, do: 9.0 });
  const miss = bench('japan', { ...BASELINE.readings, do: null });
  assert(Number.isFinite(low.score) && Number.isFinite(high.score) && Number.isFinite(miss.score), 'JP scores finite with low/high/missing DO');
  // 2026-08-18 (PO-approved): per-country weighted-composite aggregation
  // (including the do:0.12 weight and any weakest-link blend) was replaced
  // by the one shared plain-average grading formula. DO is now graded and
  // included in that average whenever present — its magnitude DOES now
  // change the numeric score. Only Japan's own PASS/FAIL classification of
  // DO stays opinion-free (NOT_EVALUATED, asserted below).
  assert(low.score !== high.score, `JP score differs for low vs high DO (${low.score} vs ${high.score}) — DO now enters the shared grading average`);
  assert(low.score !== miss.score, `JP score differs for low vs missing DO (${low.score} vs ${miss.score}) — DO drops out of the average entirely when absent`);
  assert(low.classifications.do === 'NOT_EVALUATED' && high.classifications.do === 'NOT_EVALUATED' && miss.classifications.do === 'NOT_EVALUATED', 'JP DO always NOT_EVALUATED (classification unaffected)');
  assert(typeof low.params.do === 'number', 'JP graded params now include a numeric do grade when present (shared base)');
  assert(!Object.prototype.hasOwnProperty.call(miss.params, 'do'), 'JP graded params omit do only when do is actually absent');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
