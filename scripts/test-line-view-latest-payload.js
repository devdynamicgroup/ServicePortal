#!/usr/bin/env node
'use strict';

/**
 * view_latest ("ขอดูผลตรวจน้ำ") — same Free/Paid contract as Complete→LINE Layer 3.
 * Payload construction + resolver identity/selection only (no LINE API, no Notion).
 *
 * Run: node scripts/test-line-view-latest-payload.js
 */

const assert = require('assert');
const {
  buildViewLatestResultReply
} = require('../services/line-notifications');
const {
  getLatestAvailableResultByLineUserId,
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
const TOKEN = 'rpt-abcd';

function freeJob(waterScore) {
  return {
    id: 'free-case',
    name: 'Free Cust',
    campaignOffer: 'Launch Offer 2026',
    result: { publicReportToken: TOKEN, waterScore }
  };
}

function paidJob(waterScore) {
  return {
    id: 'paid-case',
    name: 'Paid Cust',
    campaignOffer: '',
    result: { publicReportToken: TOKEN, waterScore }
  };
}

console.log('\n=== view_latest Free / Paid LINE payload ===\n');

try {
  const messages = buildViewLatestResultReply({
    job: freeJob(75),
    resultType: RESULT_TYPES.FREE_WATER_CHECK,
    resultLinkUrl: REPORT
  });
  assert.strictEqual(messages.length, 2, 'Free: intro text + flex');
  const flex = messages[1];
  assert.ok(flex.contents?.hero?.url?.includes('score-card'), 'Free keeps score-card hero');
  assert.ok(!flex.contents.hero.action, 'Free hero has no URI action');
  assert.ok(!flex.contents.footer, 'Free has no footer CTA');
  assert.ok(!jsonHasReportPath(messages), 'Free reply has no /r/ anywhere');
  ok('Free view_latest: poster hero, no /r (score 75)');
} catch (e) {
  fail('Free view_latest score 75', e);
}

try {
  const messages = buildViewLatestResultReply({
    job: freeJob(0),
    resultType: RESULT_TYPES.FREE_WATER_CHECK,
    resultLinkUrl: REPORT
  });
  const flex = messages[1];
  assert.ok(String(flex.altText).includes('0/100'), 'Free score 0 is real 0');
  assert.ok(!jsonHasReportPath(messages), 'Free score 0 has no /r/');
  ok('Free view_latest: score 0');
} catch (e) {
  fail('Free view_latest score 0', e);
}

try {
  const messages = buildViewLatestResultReply({
    job: freeJob(null),
    resultType: RESULT_TYPES.FREE_WATER_CHECK,
    resultLinkUrl: REPORT
  });
  const flex = messages[1];
  assert.ok(!String(flex.altText).includes('0/100'), 'Free null must not become 0/100');
  assert.ok(!jsonHasReportPath(messages), 'Free null has no /r/');
  ok('Free view_latest: null score');
} catch (e) {
  fail('Free view_latest null score', e);
}

try {
  const messages = buildViewLatestResultReply({
    job: paidJob(75),
    resultType: RESULT_TYPES.PAID_ASSESSMENT,
    resultLinkUrl: REPORT
  });
  const flex = messages[1];
  assert.strictEqual(flex.contents?.hero?.action?.uri, REPORT, 'Paid hero keeps /r');
  assert.strictEqual(
    flex.contents?.footer?.contents?.[0]?.action?.uri,
    REPORT,
    'Paid footer keeps /r'
  );
  assert.ok(jsonHasReportPath(messages), 'Paid reply includes /r/');
  ok('Paid view_latest: /r on hero + footer (score 75)');
} catch (e) {
  fail('Paid view_latest score 75', e);
}

try {
  for (const score of [0, null]) {
    const messages = buildViewLatestResultReply({
      job: paidJob(score),
      resultType: RESULT_TYPES.PAID_ASSESSMENT,
      resultLinkUrl: REPORT
    });
    assert.ok(jsonHasReportPath(messages[1]), `Paid score ${score} keeps /r/`);
  }
  ok('Paid view_latest: score 0 and null keep /r/');
} catch (e) {
  fail('Paid view_latest score 0/null', e);
}

console.log('\n=== view_latest identity / case selection ===\n');

(async () => {
try {
  const jobs = [
    {
      id: 'other-user',
      line: { userId: 'U_B' },
      result: { publicReportToken: 'tok-b' },
      workflow: { serviceCompletedAt: '2026-08-01T00:00:00.000Z' },
      notification: {}
    },
    {
      id: 'asker-old',
      line: { userId: 'U_A' },
      result: { publicReportToken: 'tok-a-old' },
      workflow: { serviceCompletedAt: '2026-06-01T00:00:00.000Z' },
      notification: {}
    },
    {
      id: 'asker-new',
      line: { userId: 'U_A' },
      campaignOffer: 'Launch Offer 2026',
      result: { publicReportToken: 'tok-a-new', waterScore: 82 },
      workflow: { serviceCompletedAt: '2026-07-01T00:00:00.000Z' },
      notification: { resultSentAt: '2026-08-02T00:00:00.000Z' }
    },
    {
      id: 'asker-incomplete',
      line: { userId: 'U_A' },
      createdTime: '2026-09-01T00:00:00.000Z',
      result: { publicReportToken: '', reportUrl: '' },
      workflow: {},
      notification: {}
    }
  ];
  const latest = await getLatestAvailableResultByLineUserId('U_A', { jobs });
  assert.strictEqual(latest.case.id, 'asker-new', 'latest with report wins by sort timestamp');
  assert.strictEqual(latest.resultType, RESULT_TYPES.FREE_WATER_CHECK);
  assert.strictEqual(
    resolveResultType(latest.case),
    RESULT_TYPES.FREE_WATER_CHECK,
    'entitlement from resolveResultType'
  );

  const wrongUser = await getLatestAvailableResultByLineUserId('U_MISSING', { jobs });
  assert.strictEqual(wrongUser.resultAvailable, false);
  assert.strictEqual(wrongUser.case, null);

  const reply = buildViewLatestResultReply({
    job: latest.case,
    resultType: latest.resultType,
    resultLinkUrl: latest.resultUrl || REPORT
  });
  assert.ok(!jsonHasReportPath(reply), 'Free latest selection → no /r in reply');
  ok('Identity: U_A gets asker-new only; incomplete newer case ignored');
} catch (e) {
  fail('Identity / case selection', e);
}

try {
  const jobs = [
    {
      id: 'cancelled-with-token',
      line: { userId: 'U_C' },
      workflow: { status: 'cancelled', serviceCompletedAt: '2026-09-01T00:00:00.000Z' },
      result: { publicReportToken: 'tok-cancel' },
      notification: {}
    },
    {
      id: 'older-paid',
      line: { userId: 'U_C' },
      workflow: { serviceCompletedAt: '2026-05-01T00:00:00.000Z' },
      result: { publicReportToken: 'tok-paid' },
      notification: {}
    }
  ];
  const latest = await getLatestAvailableResultByLineUserId('U_C', { jobs });
  // Pre-existing: cancelled with token still wins if sort timestamp is newest (CODE-TRACE only).
  assert.strictEqual(latest.case.id, 'cancelled-with-token');
  assert.strictEqual(latest.resultAvailable, true);
  ok('Case selection: cancelled with token still selectable (pre-existing behavior documented)');
} catch (e) {
  fail('Cancelled case selection', e);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})();
