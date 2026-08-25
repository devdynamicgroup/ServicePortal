/**
 * Regression suite for the Water Score null-coercion bug found via the
 * "silent Complete success, score never persisted" forensic investigation
 * (2026-08-25). Covers every site verified in that investigation:
 *
 *   score-publication-service.js:246  hasPointer            (presence)
 *   score-publication-service.js:173  freezeLegacyPointer    (presence)
 *   score-publication-service.js:105  casePointerMatchesPublication (equality)
 *   line-notifications.js:401         buildScoreHistoryFlexMessage  (presence)
 *   line-notifications.js:531         buildCaseResultFlexMessage    (presence)
 *   line-notifications.js:701         sendCaseResultNotification's own
 *                                     call site -- must NOT pre-coerce, or
 *                                     the presence fix at line 531 is a
 *                                     dead fix (caller chain check)
 *   workflow-service.js:470           hasPublishedPointer   (presence, tested
 *                                     as the literal source expression --
 *                                     see WORKFLOW_SERVICE_EXPRESSION_TEST)
 *
 * Real bug: `Number(null) === 0` and `Number.isFinite(0) === true`, so
 * `Number.isFinite(Number(job.result?.waterScore))` treated a brand-new
 * Case (waterScore still null, but publicReportToken already minted at
 * creation) as "already has a published score" -- routing every first-time
 * Complete into the legacy-pointer-freeze path, which then froze 0 as the
 * "score" instead of the real value the operator/client submitted.
 *
 * Uses the REAL production functions (required directly, CommonJS, no vm
 * needed since these are server-side Node modules) with the module's own
 * existing dependency-injection hooks (setPublicationStore,
 * setPublicationCaseAdapter) and the already-existing in-memory store used
 * elsewhere for tests -- not a reimplementation.
 *
 * Run: node scripts/test-score-publication-null-coercion.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const {
  createOrReusePublication,
  casePointerMatchesPublication,
  freezeLegacyPointer,
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies
} = require('../services/score-publication-service');
const { createMemoryPublicationStore } = require('../services/score-publication-store-memory');
const {
  buildScoreHistoryFlexMessage,
  buildCaseResultFlexMessage
} = require('../services/line-notifications');

function makeJob(overrides = {}) {
  return {
    id: 'case-1',
    notionId: 'notion-case-1',
    name: 'Test Customer',
    result: { waterScore: null, publicReportToken: 'rpt-test1', reportUrl: '', ...overrides }
  };
}

function makeStoreAndAdapter() {
  const store = createMemoryPublicationStore();
  const updates = [];
  const caseAdapter = {
    async getClient() { return makeJob(); },
    async updateClient(notionId, patch) {
      updates.push({ notionId, patch });
      return makeJob({ waterScore: patch.latestWaterScore ?? null });
    },
    async findClientByReportToken() { return null; }
  };
  setPublicationStore(store);
  setPublicationCaseAdapter(caseAdapter);
  return { store, updates, caseAdapter };
}

async function main() {
  console.log('=== casePointerMatchesPublication: equality, not presence ===');
  {
    const cases = [
      { caseScore: null, pubScore: 0, expect: false, label: 'null vs 0' },
      { caseScore: null, pubScore: 80, expect: false, label: 'null vs 80' },
      { caseScore: undefined, pubScore: 0, expect: false, label: 'undefined vs 0' },
      { caseScore: 0, pubScore: null, expect: false, label: '0 vs null (reverse)' },
      { caseScore: 0, pubScore: 0, expect: true, label: '0 vs 0' },
      { caseScore: 80, pubScore: 80, expect: true, label: '80 vs 80' },
      { caseScore: 80, pubScore: 0, expect: false, label: '80 vs 0' }
    ];
    for (const c of cases) {
      const job = { result: { waterScore: c.caseScore, publicReportToken: 'rpt-x' } };
      const publication = { snapshot: { publishedScore: c.pubScore, publicReportToken: 'rpt-x' } };
      const got = casePointerMatchesPublication(job, publication);
      assert(got === c.expect, `${c.label} => ${c.expect} (got ${got})`);
    }
  }

  console.log('\n=== freezeLegacyPointer: strict presence ===');
  {
    resetPublicationDependencies();
    const { store } = makeStoreAndAdapter();
    const jobNull = makeJob({ waterScore: null });
    const resultNull = await freezeLegacyPointer(store, jobNull, { caseId: 'case-1' });
    assert(resultNull === null, 'waterScore=null => freezeLegacyPointer returns null (does not freeze/reuse)');

    const jobZero = makeJob({ waterScore: 0, publicReportToken: 'rpt-zero' });
    const resultZero = await freezeLegacyPointer(store, jobZero, { caseId: 'case-2' });
    assert(resultZero !== null && resultZero.publishedScore === 0, `waterScore=0 (valid) => freezeLegacyPointer freezes it as 0 (got ${JSON.stringify(resultZero && resultZero.publishedScore)})`);

    const jobEighty = makeJob({ waterScore: 80, publicReportToken: 'rpt-eighty' });
    const resultEighty = await freezeLegacyPointer(store, jobEighty, { caseId: 'case-3' });
    assert(resultEighty !== null && resultEighty.publishedScore === 80, `waterScore=80 => freezeLegacyPointer freezes it as 80 (got ${JSON.stringify(resultEighty && resultEighty.publishedScore)})`);
    resetPublicationDependencies();
  }

  console.log('\n=== createOrReusePublication: the actual end-to-end reproduction ===');
  {
    resetPublicationDependencies();
    const { store, updates } = makeStoreAndAdapter();
    // Fresh Case: publicReportToken already minted at creation (real product
    // behavior), waterScore still null. This is the exact shape that
    // triggered the real bug.
    const job = makeJob({ waterScore: null, publicReportToken: 'rpt-fresh' });
    const published = await createOrReusePublication({ job, payload: { score: 80, intent: 'publish' }, caseId: 'case-1' });
    assert(published.score === 80, `a fresh Case (waterScore=null) publishes the REAL submitted score, not 0 (got ${published.score})`);
    assert(published.scoreType !== 'legacy-publication', `does NOT take the legacy-freeze path for a fresh Case (got scoreType=${published.scoreType})`);
    resetPublicationDependencies();
  }

  console.log('\n=== createOrReusePublication: hasPointer source-level expression check ===');
  console.log('(the end-to-end test above cannot isolate this site: freezeLegacyPointer\'s');
  console.log(' own guard neutralizes a wrongly-true hasPointer downstream, so this site');
  console.log(' needs its own direct check to prove it is not silently unprotected.)');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'score-publication-service.js'), 'utf8');
    const exprMatch = src.match(/const hasPointer = rawWaterScore !== null[\s\S]*?String\(job\.result\?\.publicReportToken \|\| ''\)\.trim\(\);/);
    assert(!!exprMatch, 'hasPointer strict-presence expression found in source (test is in sync)');
    if (exprMatch) {
      for (const c of [
        { rawWaterScore: null, publicReportToken: 'rpt-x', expect: false, label: 'null score, token present' },
        { rawWaterScore: undefined, publicReportToken: 'rpt-x', expect: false, label: 'undefined score, token present' },
        { rawWaterScore: 0, publicReportToken: 'rpt-x', expect: true, label: '0 (valid) score, token present' },
        { rawWaterScore: 80, publicReportToken: 'rpt-x', expect: true, label: '80 score, token present' },
        { rawWaterScore: 80, publicReportToken: '', expect: false, label: '80 score, no token yet' }
      ]) {
        const job = { result: { waterScore: c.rawWaterScore, publicReportToken: c.publicReportToken } };
        // eslint-disable-next-line no-new-func
        const fn = new Function('job', `const rawWaterScore = job.result?.waterScore;\n${exprMatch[0]}\nreturn Boolean(hasPointer);`);
        const got = fn(job);
        assert(got === c.expect, `${c.label} => ${c.expect} (got ${got})`);
      }
    }
  }

  console.log('\n=== buildScoreHistoryFlexMessage: presence in history rows ===');
  {
    const msg = buildScoreHistoryFlexMessage([
      { waterScore: null, dateLabel: '2026-01-01', clientName: 'A' },
      { waterScore: 0, dateLabel: '2026-01-02', clientName: 'B' },
      { waterScore: 80, dateLabel: '2026-01-03', clientName: 'C' }
    ]);
    const text = JSON.stringify(msg);
    assert(text.includes('"—"') || /—/.test(text), 'a history entry with waterScore=null renders as a dash, not swallowed');
    // Extract the three score text values in order from the flex contents.
    const rows = msg.contents.body.contents;
    const scoreOf = (row) => JSON.stringify(row).match(/"text":"(—|\d+)"[^}]*"align":"end"/)?.[1];
    assert(scoreOf(rows[0]) === '—', `null entry shows "—", not "0" (got ${scoreOf(rows[0])})`);
    assert(scoreOf(rows[1]) === '0', `0 entry shows "0" (a real valid score), not "—" (got ${scoreOf(rows[1])})`);
    assert(scoreOf(rows[2]) === '80', `80 entry shows "80" (got ${scoreOf(rows[2])})`);
  }

  console.log('\n=== buildCaseResultFlexMessage: presence in the result-ready message ===');
  {
    const withNull = buildCaseResultFlexMessage({ resultLinkUrl: 'https://x/r/t', clientName: 'A', waterScore: null, resultType: 'paid_assessment' });
    assert(!withNull.altText.includes('Water Score'), `waterScore=null => generic "ready" message, not "Water Score 0/100" (got "${withNull.altText}")`);

    const withZero = buildCaseResultFlexMessage({ resultLinkUrl: 'https://x/r/t', clientName: 'A', waterScore: 0, resultType: 'paid_assessment' });
    assert(withZero.altText.includes('Water Score 0/100'), `waterScore=0 (valid) => "Water Score 0/100" is shown, not swallowed (got "${withZero.altText}")`);

    const withEighty = buildCaseResultFlexMessage({ resultLinkUrl: 'https://x/r/t', clientName: 'A', waterScore: 80, resultType: 'paid_assessment' });
    assert(withEighty.altText.includes('Water Score 80/100'), `waterScore=80 => "Water Score 80/100" is shown (got "${withEighty.altText}")`);
  }

  console.log('\n=== Caller-chain guard: sendCaseResultNotification must not pre-coerce waterScore ===');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'line-notifications.js'), 'utf8');
    const fnMatch = src.match(/async function sendCaseResultNotification[\s\S]*?\n}\r?\n/);
    assert(!!fnMatch, 'sendCaseResultNotification() found in source (test is in sync with real source)');
    const fnBody = fnMatch ? fnMatch[0] : '';
    assert(
      !/waterScore:\s*Number\(/.test(fnBody),
      'sendCaseResultNotification does NOT wrap waterScore in Number(...) before handing it to buildCaseResultFlexMessage -- otherwise the presence fix there is a dead fix'
    );
    assert(
      /waterScore:\s*job\.result\?\.waterScore/.test(fnBody),
      'sendCaseResultNotification passes job.result?.waterScore through raw (null stays null)'
    );
  }

  console.log('\n=== workflow-service.js hasPublishedPointer: source-level expression check ===');
  console.log('(closeCase() itself needs Notion/session mocking beyond this suite\'s scope --');
  console.log(' this proves the literal fixed expression, not the full closeCase() integration.)');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'workflow-service.js'), 'utf8');
    const exprMatch = src.match(/const rawWaterScore = job\.result\?\.waterScore;\r?\n\s*const hasPublishedPointer = rawWaterScore !== null[\s\S]*?String\(job\.result\?\.publicReportToken \|\| ''\)\.trim\(\);/);
    assert(!!exprMatch, 'hasPublishedPointer strict-presence expression found in source (test is in sync)');
    if (exprMatch) {
      for (const c of [
        { rawWaterScore: null, publicReportToken: 'rpt-x', expect: false, label: 'null score, token present' },
        { rawWaterScore: undefined, publicReportToken: 'rpt-x', expect: false, label: 'undefined score, token present' },
        { rawWaterScore: 0, publicReportToken: 'rpt-x', expect: true, label: '0 (valid) score, token present' },
        { rawWaterScore: 80, publicReportToken: 'rpt-x', expect: true, label: '80 score, token present' },
        { rawWaterScore: 80, publicReportToken: '', expect: false, label: '80 score, no token yet' }
      ]) {
        const job = { result: { waterScore: c.rawWaterScore, publicReportToken: c.publicReportToken } };
        // eslint-disable-next-line no-new-func
        const fn = new Function('job', `${exprMatch[0]}\nreturn Boolean(hasPublishedPointer);`);
        const got = fn(job);
        assert(got === c.expect, `${c.label} => ${c.expect} (got ${got})`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  console.error(e.stack);
  process.exit(1);
});
