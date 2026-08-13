/**
 * Benchmark Isolation Suite
 * Run: node tests/benchmark/benchmark-isolation.test.js
 *
 * Guarantees country engines cannot leak into each other,
 * and Production WHO/DWQI remains byte-identical.
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
  'src/js/flows/score.js'
];

const sandbox = { console, document: { getElementById: () => null }, S: { lang: 'en' }, t: (k) => k };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of files) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

const KEYS = ['thailand', 'who', 'eu', 'japan', 'usEpa'];
const SAMPLE = {
  ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5, temp: 28
};

let passed = 0;
let failed = 0;
const report = [];

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    report.push(`PASS  ${msg}`);
    console.log(`  ok  ${msg}`);
  } else {
    failed += 1;
    report.push(`FAIL  ${msg}`);
    console.error(`  FAIL  ${msg}`);
  }
}

function fingerprint(result) {
  // Stable isolation fingerprint — exclude volatile trace ids/timestamps.
  return JSON.stringify({
    engine: result.engine,
    engineKey: result.engineKey,
    score: result.score,
    verdict: result.verdict,
    summary: result.summary,
    passedParameters: result.passedParameters,
    warningParameters: result.warningParameters,
    failedParameters: result.failedParameters,
    criticalFailures: result.criticalFailures,
    reasons: result.reasons,
    topPositiveFactors: result.topPositiveFactors,
    topNegativeFactors: result.topNegativeFactors,
    params: result.params,
    classifications: result.classifications,
    engineVersion: result.engineVersion,
    standardRevision: result.standardRevision,
    inputFingerprint: result.inputFingerprint
  });
}

function snapshotAll(reg) {
  const out = {};
  for (const key of KEYS) out[key] = fingerprint(reg.calculate(key, SAMPLE));
  return out;
}

function cloneEngine(engine) {
  return {
    key: engine.key,
    labelKey: engine.labelKey,
    shortKey: engine.shortKey,
    display: engine.display,
    limits: engine.limits,
    weights: engine.weights,
    calculate: engine.calculate,
    evaluateStatus: engine.evaluateStatus
  };
}

const reg = sandbox.WaterScoreBenchmarkRegistry;
const originals = {};
for (const key of KEYS) originals[key] = cloneEngine(reg.get(key));

console.log('\n=== Baseline fingerprints ===');
const baseline = snapshotAll(reg);
const productionBefore = sandbox.computeLegacyDwqiScore(SAMPLE);
console.log('Production before:', productionBefore);
KEYS.forEach(k => console.log(`  ${k}: score=${JSON.parse(baseline[k]).score}`));

function restoreAll() {
  for (const key of KEYS) reg.register(cloneEngine(originals[key]));
}

function assertOthersUnchanged(changedKey, afterSnap, label) {
  for (const key of KEYS) {
    if (key === changedKey) continue;
    assert(afterSnap[key] === baseline[key], `${label}: ${key} fingerprint unchanged`);
  }
}

console.log('\nTest 1 — Modify Thailand calculate (simulates weight change)');
{
  restoreAll();
  const thai = cloneEngine(originals.thailand);
  const inner = thai.calculate;
  thai.calculate = (readings) => {
    const out = inner(readings);
    return { ...out, score: 11, summary: 'ISOLATION_THAILAND_MUTATION', verdict: 'Poor' };
  };
  reg.register(thai);
  const after = snapshotAll(reg);
  assert(JSON.parse(after.thailand).score === 11, 'Thailand score changed to mutation marker');
  assertOthersUnchanged('thailand', after, 'Test1');
  restoreAll();
  assert(snapshotAll(reg).thailand === baseline.thailand, 'Thailand restored');
}

console.log('\nTest 2 — Modify Japan calculate (simulates limits change)');
{
  restoreAll();
  const japan = cloneEngine(originals.japan);
  const inner = japan.calculate;
  japan.calculate = (readings) => {
    const out = inner(readings);
    return { ...out, score: 22, summary: 'ISOLATION_JAPAN_MUTATION' };
  };
  reg.register(japan);
  const after = snapshotAll(reg);
  assert(JSON.parse(after.japan).score === 22, 'Japan score changed to mutation marker');
  assertOthersUnchanged('japan', after, 'Test2');
  restoreAll();
}

console.log('\nTest 3 — Modify EU calculate (simulates penalty change)');
{
  restoreAll();
  const eu = cloneEngine(originals.eu);
  const inner = eu.calculate;
  eu.calculate = (readings) => {
    const out = inner(readings);
    return { ...out, score: 33, summary: 'ISOLATION_EU_MUTATION', criticalFailures: ['chlorine'] };
  };
  reg.register(eu);
  const after = snapshotAll(reg);
  assert(JSON.parse(after.eu).score === 33, 'EU score changed to mutation marker');
  assertOthersUnchanged('eu', after, 'Test3');
  restoreAll();
}

console.log('\nTest 4 — Modify EPA calculate (simulates scoring change)');
{
  restoreAll();
  const epa = cloneEngine(originals.usEpa);
  const inner = epa.calculate;
  epa.calculate = (readings) => {
    const out = inner(readings);
    return { ...out, score: 44, summary: 'ISOLATION_EPA_MUTATION' };
  };
  reg.register(epa);
  const after = snapshotAll(reg);
  assert(JSON.parse(after.usEpa).score === 44, 'EPA score changed to mutation marker');
  assertOthersUnchanged('usEpa', after, 'Test4');
  restoreAll();
}

console.log('\nTest 5 — Production regression (byte-identical)');
{
  restoreAll();
  const before = sandbox.computeLegacyDwqiScore(SAMPLE);
  for (const key of KEYS) reg.calculate(key, SAMPLE);
  const after = sandbox.computeLegacyDwqiScore(SAMPLE);
  assert(before === productionBefore && after === productionBefore, `Legacy DWQI remains ${productionBefore}`);
  assert(before === after, 'Legacy DWQI unchanged by benchmark execution');
}

console.log('\nTest 6 — Registry independence (dummy engine)');
{
  restoreAll();
  const before = snapshotAll(reg);
  reg.register({
    key: 'singapore_dummy',
    labelKey: 'x',
    shortKey: 'x',
    display: {},
    calculate() {
      return {
        engine: 'Singapore', engineKey: 'singapore_dummy', score: 7, verdict: 'Poor',
        summary: 'dummy', passedParameters: [], warningParameters: [], failedParameters: [],
        criticalFailures: [], reasons: [], params: {}, statuses: {}, findings: []
      };
    },
    evaluateStatus() { return 'good'; }
  });
  assert(reg.calculate('singapore_dummy', SAMPLE).score === 7, 'dummy engine registered');
  const after = snapshotAll(reg);
  for (const key of KEYS) {
    assert(after[key] === before[key], `Test6: ${key} unchanged after dummy register`);
  }
}

console.log('\nTest 7 — Benchmark scores locked (must not drift)');
{
  restoreAll();
  const expected = { thailand: 95, who: 93, eu: 65, japan: 96, usEpa: 91 };
  for (const key of KEYS) {
    const score = reg.calculate(key, SAMPLE).score;
    assert(score === expected[key], `${key} score locked at ${expected[key]} (got ${score})`);
  }
  assert(sandbox.computeLegacyDwqiScore(SAMPLE) === 93, 'Legacy DWQI locked at 93');
  assert(Number.isFinite(sandbox.computeScoreFromReadings(SAMPLE)), 'Quality V2 computes finite score');
}

console.log('\nTest 8 — Metadata contract present on every engine');
{
  restoreAll();
  for (const key of KEYS) {
    const out = reg.calculate(key, SAMPLE);
    assert(typeof out.engine === 'string' && out.engine.length > 0, `${key} has engine name`);
    assert(Number.isFinite(out.score), `${key} has numeric score`);
    assert(typeof out.verdict === 'string', `${key} has verdict`);
    assert(typeof out.summary === 'string', `${key} has summary`);
    assert(Array.isArray(out.reasons), `${key} has reasons[]`);
    assert(Array.isArray(out.passedParameters), `${key} has passedParameters`);
    assert(Array.isArray(out.warningParameters), `${key} has warningParameters`);
    assert(Array.isArray(out.failedParameters), `${key} has failedParameters`);
    assert(Array.isArray(out.criticalFailures), `${key} has criticalFailures`);
    assert(Array.isArray(out.topPositiveFactors), `${key} has topPositiveFactors`);
    assert(Array.isArray(out.topNegativeFactors), `${key} has topNegativeFactors`);
    assert(typeof out.calculationId === 'string' && out.calculationId.startsWith('calc_'), `${key} has calculationId`);
    assert(typeof out.engineVersion === 'string', `${key} has engineVersion`);
    assert(typeof out.standardRevision === 'string' && out.standardRevision.length > 0, `${key} has standardRevision`);
    assert(typeof out.calculatedAt === 'string', `${key} has calculatedAt`);
    assert(typeof out.inputFingerprint === 'string' && out.inputFingerprint.length === 8, `${key} has inputFingerprint`);
  }
  const eu = reg.calculate('eu', SAMPLE);
  assert(eu.criticalFailures.includes('chlorine') || eu.reasons.some(r => r.parameter === 'chlorine'),
    'EU metadata flags chlorine for this sample');
}

const summary = [
  '# Benchmark Isolation Test Report',
  '',
  `Date: ${new Date().toISOString()}`,
  `Sample: ${JSON.stringify(SAMPLE)}`,
  `Production score: ${productionBefore}`,
  '',
  '## Results',
  ...report.map(line => `- ${line}`),
  '',
  `## Totals`,
  `${passed} passed, ${failed} failed`,
  '',
  failed ? 'STATUS: FAIL' : 'STATUS: PASS'
].join('\n');

fs.writeFileSync(path.join(root, 'docs/BENCHMARK_ISOLATION_TEST_REPORT.md'), summary);
fs.writeFileSync(path.join(root, 'docs/BENCHMARK_METADATA_SCHEMA.md'), `# Benchmark Metadata Schema

Every \`engine.calculate(readings)\` MUST return:

\`\`\`ts
{
  engine: string;              // "WHO" | "Thailand" | ...
  engineKey: string;           // registry key
  score: number | null;
  verdict: "Excellent" | "Good" | "Acceptable" | "Attention" | "Poor";
  summary: string;             // engine-authored one-liner
  passedParameters: string[];
  warningParameters: string[];
  failedParameters: string[];
  criticalFailures: string[];
  reasons: Array<{
    parameter: string;
    severity: "pass" | "warning" | "fail" | "critical";
    message: string;           // engine-specific wording
  }>;
  classifications?: Record<string, "PASS" | "WARNING" | "FAIL" | "CRITICAL">;
  params?: Record<string, number> | null;  // sub-scores (optional for UI bars)
  statuses?: Record<string, string>;       // legacy good/attn for metric rows
  findings?: Array<{ label: string; val: string; note?: string }>;
}
\`\`\`

Rules:
- Metadata is produced **inside** each country engine.
- UI / reports / LINE / PDF must **consume**, never recompute, explanations.
- Production \`computeScoreFromReadings\` is out of scope and must not emit this contract.
`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
