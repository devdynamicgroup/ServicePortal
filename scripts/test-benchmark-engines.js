/**
 * Regression: production score frozen + independent benchmark engines diverge.
 * Run: node scripts/test-benchmark-engines.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const files = [
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
  'src/js/score/production/computeProductionScore.js',
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

const sandbox = {
  console,
  window: {},
  globalThis: null,
  document: { getElementById: () => null },
  S: { lang: 'en' },
  t: (k) => k
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of files) {
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const sample = {
  ph: 7.2,
  tds: 450,
  chlorine: 0.8,
  turbidity: 2.5,
  orp: 350,
  do: 6.5,
  temp: 28
};

console.log('\n1) Production score frozen (golden sample)');
const production = sandbox.computeScoreFromReadings(sample);
assert(production === 93, `production score === 93 (got ${production})`);

console.log('\n2) Engines registered independently');
const reg = sandbox.WaterScoreBenchmarkRegistry;
assert(reg.has('thailand') && reg.has('who') && reg.has('eu') && reg.has('japan') && reg.has('usEpa'), 'all five engines registered');

console.log('\n3) Independent benchmark outputs for same readings');
const scores = {};
for (const key of ['thailand', 'who', 'eu', 'japan', 'usEpa']) {
  scores[key] = reg.calculate(key, sample).score;
  console.log(`   ${key.padEnd(10)} => ${scores[key]}`);
}
assert(scores.thailand !== scores.eu, 'Thailand !== EU');
assert(scores.who !== scores.eu, 'WHO !== EU');
assert(Math.max(...Object.values(scores)) - Math.min(...Object.values(scores)) >= 15, 'spread across engines >= 15 points');

console.log('\n4) WHO engine matches production for this product sample');
assert(scores.who === production, `WHO engine (${scores.who}) matches production (${production})`);

console.log('\n5) Production path not coupled to benchmark registry math');
const before = sandbox.computeScoreFromReadings(sample);
reg.calculate('eu', sample);
const after = sandbox.computeScoreFromReadings(sample);
assert(before === after && after === 93, 'production unchanged after benchmark calculate');

console.log('\n6) Orchestrator delegates comparison');
const cmp = sandbox.buildComparisonScoreResult(sample, 'eu');
assert(cmp.standardKey === 'eu', 'comparison standardKey eu');
assert(cmp.score === scores.eu, 'comparison score matches EU engine');

console.log('\n7) Open/Closed: registry accepts a new engine without editing others');
reg.register({
  key: 'singapore_test',
  labelKey: 'x',
  shortKey: 'x',
  display: {},
  calculate() { return { score: 1, params: {}, findings: [], statuses: {} }; },
  evaluateStatus() { return 'good'; }
});
assert(reg.calculate('singapore_test', sample).score === 1, 'new engine works without touching Thailand/WHO');
assert(reg.calculate('thailand', sample).score === scores.thailand, 'Thailand unchanged after new engine');

// Persist comparison table for deliverable
const report = [
  '# Benchmark engine comparison (sample readings)',
  '',
  '```',
  JSON.stringify(sample, null, 2),
  '```',
  '',
  '| Engine | Score |',
  '|---|---|',
  `| Production (WHO DWQI) | ${production} |`,
  `| Thailand | ${scores.thailand} |`,
  `| WHO | ${scores.who} |`,
  `| Japan | ${scores.japan} |`,
  `| US EPA | ${scores.usEpa} |`,
  `| EU | ${scores.eu} |`,
  '',
  `Spread: ${Math.max(...Object.values(scores)) - Math.min(...Object.values(scores))} points`
].join('\n');
fs.writeFileSync(path.join(root, 'docs/BENCHMARK_ENGINE_COMPARISON_SAMPLE.md'), report);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

