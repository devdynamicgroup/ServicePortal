/**
 * Generate example payloads for docs. Run: node scripts/generate-benchmark-metadata-examples.js
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
  'src/js/score/benchmark/usEpa/score.js'
];

const sandbox = { console: { log() {}, warn() {}, error() {} } };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of files) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

const sample = {
  ph: 7.2, tds: 450, chlorine: 0.8, turbidity: 2.5, orp: 350, do: 6.5, temp: 28
};

const production = sandbox.computeScoreFromReadings(sample);
const examples = {};
for (const key of ['thailand', 'who', 'eu', 'japan', 'usEpa']) {
  examples[key] = sandbox.WaterScoreBenchmarkRegistry.calculate(key, sample);
}

const md = [
  '# Benchmark Metadata Examples',
  '',
  'Sample readings:',
  '```json',
  JSON.stringify(sample, null, 2),
  '```',
  '',
  `Production WHO/DWQI (unchanged): **${production}**`,
  '',
  '## Score lock',
  '',
  '| Engine | Score | Verdict |',
  '|---|---|---|',
  ...Object.values(examples).map(r => `| ${r.engine} | ${r.score} | ${r.verdict} |`),
  '',
  '## Explainability + Traceability payloads',
  ''
];

for (const [key, r] of Object.entries(examples)) {
  md.push(`### ${r.engine}`, '', '```json', JSON.stringify({
    engine: r.engine,
    engineKey: r.engineKey,
    score: r.score,
    verdict: r.verdict,
    summary: r.summary,
    topPositiveFactors: r.topPositiveFactors,
    topNegativeFactors: r.topNegativeFactors,
    calculationId: r.calculationId,
    engineVersion: r.engineVersion,
    standardRevision: r.standardRevision,
    calculatedAt: r.calculatedAt,
    inputFingerprint: r.inputFingerprint,
    passedParameters: r.passedParameters,
    warningParameters: r.warningParameters,
    failedParameters: r.failedParameters,
    criticalFailures: r.criticalFailures
  }, null, 2), '```', '');
}

fs.writeFileSync(path.join(root, 'docs/BENCHMARK_METADATA_EXAMPLES.md'), md.join('\n'));
console.log('wrote docs/BENCHMARK_METADATA_EXAMPLES.md');
