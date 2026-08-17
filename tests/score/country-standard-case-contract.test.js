/**
 * Country Score standard Case-persistence contract.
 * Run: node tests/score/country-standard-case-contract.test.js
 */
const { normalizeScoreStandardKey, SCORE_STANDARD_KEYS } = require('../../services/case-score-standard-service');
const { notionPageToJob } = require('../../services/notion/mapper');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${message}`);
  }
}

console.log('\nA. Server accepts only registered Country Benchmark keys');
SCORE_STANDARD_KEYS.forEach(key => {
  assert(normalizeScoreStandardKey(key) === key, `${key} is accepted`);
});
assert(normalizeScoreStandardKey('quality-v3') === null, 'Quality V3 cannot become a Country Score standard');
assert(normalizeScoreStandardKey('unknown') === null, 'unknown standards are rejected');

console.log('\nB. Notion Case mapping restores an explicit saved selection');
const selected = notionPageToJob({
  id: '3b99a92d-fb61-81f2-a65a-c34db7f6179d',
  created_time: '2026-08-11T00:00:00.000Z',
  properties: {
    'Country Score Standard': { type: 'select', select: { name: 'eu' } }
  }
});
assert(selected.draft.scoreStandardKey === 'eu', 'mapped Case draft restores EU');

console.log('\nC. Legacy Case without a saved selection remains unset for frontend Thailand fallback');
const legacy = notionPageToJob({
  id: '3b89a92d-fb61-8105-8c80-ff4477932434',
  created_time: '2026-08-10T00:00:00.000Z',
  properties: {}
});
assert(!Object.prototype.hasOwnProperty.call(legacy.draft, 'scoreStandardKey'), 'legacy Case preserves missing-value fallback semantics');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
