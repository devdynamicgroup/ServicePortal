#!/usr/bin/env node
'use strict';

/**
 * Layer 3 — Free must not expose /r/{token}; Paid retains Water Score link.
 * Payload construction only (no LINE API, no Notion).
 *
 * Run: node scripts/test-line-free-paid-payload.js
 */

const assert = require('assert');
const {
  buildCaseResultFlexMessage,
  buildCaseResultFlexMessageForType,
  buildCaseResultTextMessage
} = require('../services/line-notifications');
const {
  resolveResultType,
  RESULT_TYPES
} = require('../services/line-result-resolver');

let passed = 0;
let failed = 0;

function ok(msg) {
  passed += 1;
  console.log(`  PASS  ${msg}`);
}

function fail(msg, err) {
  failed += 1;
  console.error(`  FAIL  ${msg}`);
  console.error(err && err.stack ? err.stack : err);
}

function collectUris(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((item) => collectUris(item, out));
    return out;
  }
  if (node.action?.uri) out.push(String(node.action.uri));
  if (node.uri) out.push(String(node.uri));
  Object.values(node).forEach((value) => {
    if (value && typeof value === 'object') collectUris(value, out);
  });
  return out;
}

function jsonHasReportPath(value) {
  return /\/r\//i.test(JSON.stringify(value));
}

const REPORT = 'https://example.test/r/rpt-abcd';
const CARD = 'https://example.test/api/public/score-card/rpt-abcd?format=landscape';

console.log('\n=== Layer 3 Free / Paid LINE payload ===\n');

try {
  assert.strictEqual(
    resolveResultType({ campaignOffer: 'Launch Offer 2026' }),
    RESULT_TYPES.FREE_WATER_CHECK
  );
  assert.strictEqual(
    resolveResultType({ campaignOffer: '' }),
    RESULT_TYPES.PAID_ASSESSMENT
  );
  ok('resolveResultType unchanged (Launch=Free, empty=Paid)');
} catch (e) {
  fail('resolveResultType unchanged', e);
}

try {
  const free = buildCaseResultFlexMessageForType({
    resultLinkUrl: REPORT,
    scoreCardImageUrl: CARD,
    clientName: 'Free Cust',
    waterScore: 75
  }, RESULT_TYPES.FREE_WATER_CHECK);

  assert.ok(free.contents?.hero?.url === CARD, 'Free keeps score-card hero');
  assert.ok(!free.contents.hero.action, 'Free hero has no URI action');
  assert.ok(!free.contents.footer, 'Free has no footer CTA');
  const uris = collectUris(free);
  assert.ok(uris.every((u) => !/\/r\//i.test(u)), 'Free Flex URIs have no /r/');
  assert.ok(!jsonHasReportPath(free), 'Free Flex JSON has no /r/ path');
  assert.ok(String(free.altText).includes('75'), 'Free shows real score 75');
  ok('Free Flex: poster hero, no /r CTA (score 75)');
} catch (e) {
  fail('Free Flex score 75', e);
}

try {
  const freeZero = buildCaseResultFlexMessage({
    resultLinkUrl: REPORT,
    scoreCardImageUrl: CARD,
    waterScore: 0,
    resultType: RESULT_TYPES.FREE_WATER_CHECK
  });
  assert.ok(String(freeZero.altText).includes('0/100'), 'score 0 is real 0');
  assert.ok(!jsonHasReportPath(freeZero), 'Free score 0 still has no /r/');
  ok('Free Flex: score 0 is not missing');
} catch (e) {
  fail('Free Flex score 0', e);
}

try {
  const freeNull = buildCaseResultFlexMessage({
    resultLinkUrl: REPORT,
    scoreCardImageUrl: CARD,
    waterScore: null,
    resultType: RESULT_TYPES.FREE_WATER_CHECK
  });
  assert.ok(!String(freeNull.altText).includes('0/100'), 'null must not become 0/100');
  assert.ok(!jsonHasReportPath(freeNull), 'Free null score has no /r/');
  ok('Free Flex: null score never becomes 0/100');
} catch (e) {
  fail('Free Flex score null', e);
}

try {
  const paid = buildCaseResultFlexMessageForType({
    resultLinkUrl: REPORT,
    scoreCardImageUrl: CARD,
    clientName: 'Paid Cust',
    waterScore: 75
  }, RESULT_TYPES.PAID_ASSESSMENT);

  assert.strictEqual(paid.contents?.hero?.action?.uri, REPORT, 'Paid hero keeps /r');
  assert.strictEqual(
    paid.contents?.footer?.contents?.[0]?.action?.uri,
    REPORT,
    'Paid footer keeps /r'
  );
  assert.ok(jsonHasReportPath(paid), 'Paid Flex includes /r/');
  ok('Paid Flex: /r retained on hero + footer');
} catch (e) {
  fail('Paid Flex', e);
}

try {
  const freeText = buildCaseResultTextMessage({
    resultLinkUrl: REPORT,
    resultType: RESULT_TYPES.FREE_WATER_CHECK,
    waterScore: 75
  });
  assert.ok(!/\/r\//i.test(freeText.text), 'Free text fallback has no /r/');
  assert.ok(freeText.text.includes('75'), 'Free text may mention score');

  const freeTextNull = buildCaseResultTextMessage({
    resultLinkUrl: REPORT,
    resultType: RESULT_TYPES.FREE_WATER_CHECK,
    waterScore: null
  });
  assert.ok(!/\/r\//i.test(freeTextNull.text), 'Free null text has no /r/');
  assert.ok(!freeTextNull.text.includes('0/100'), 'Free null text is not 0/100');

  const paidText = buildCaseResultTextMessage({
    resultLinkUrl: REPORT,
    resultType: RESULT_TYPES.PAID_ASSESSMENT,
    waterScore: 75
  });
  assert.ok(paidText.text.includes('/r/'), 'Paid text fallback keeps /r/');
  ok('Text fallback: Free strips /r; Paid keeps /r');
} catch (e) {
  fail('Text fallback', e);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
