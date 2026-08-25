/**
 * Regression suite for the 2 P1 bugs found in the weird-user-behavior QA
 * pass (2026-08-25):
 *
 *   P1-1  GET /api/public/score-card/:token  (api/public-routes.js:105,
 *         services/score-share-card.js:645 cardOptionsFromJob) --
 *         Number.isFinite(Number(job.result?.waterScore)) treated a fresh
 *         Case (waterScore still null, but publicReportToken already
 *         minted at creation) as "has a published score", serving a public
 *         "Water Score 0/100" share-card PNG for an unscored Case. Same
 *         bug class as bb304360, at a site that patch didn't cover.
 *
 *   P1-2  closeCase() / submitCaseAssessment() (services/workflow-service.js,
 *         services/assessment-persistence-service.js) -- neither had the
 *         terminal-state guard startCase() already has (isTerminalCaseStatus),
 *         so a cancelled/closed Case could still be scored, marked
 *         completed, and trigger a LINE "your results are ready" push, or
 *         accept new assessment measurements.
 *
 * Uses real, unmodified production functions:
 *  - cardOptionsFromJob, isTerminalCaseStatus: required directly (pure,
 *    already exported).
 *  - The route-level score-card guard (not a standalone function): tested
 *    via source-level expression extraction + eval, same technique used
 *    earlier this session for workflow-service's hasPublishedPointer.
 *  - closeCase() / submitCaseAssessment(): required directly, with
 *    services/notion/clients mocked via require.cache substitution (an
 *    in-memory fake getClient/updateClient) so the real functions run
 *    against a controlled Case shape without needing live Notion config.
 *
 * Run: node scripts/test-weird-qa-p1-fixes.js
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

// ---------------------------------------------------------------------------
// Mock services/notion/clients BEFORE anything requires workflow-service.js,
// so every module that does require('./notion/clients') gets this fake.
// ---------------------------------------------------------------------------
const ROOT = path.join(__dirname, '..');
const clientsPath = require.resolve(path.join(ROOT, 'services/notion/clients'));

const db = new Map(); // notionId -> job
const updateCalls = [];

function makeJob(id, overrides = {}) {
  return {
    id,
    notionId: id,
    name: 'QA Weird-Case Fixture',
    workflow: { status: 'in_progress', ...(overrides.workflow || {}) },
    result: { waterScore: null, publicReportToken: 'rpt-fixture', ...(overrides.result || {}) },
    feedback: { token: 'fb-fixture', status: 'not_sent' },
    line: {},
    review: {},
    draft: {},
    ...overrides
  };
}

const fakeClientsModule = {
  async getClient(notionId) {
    const job = db.get(notionId);
    if (!job) throw new Error('not found');
    return job;
  },
  async updateClient(notionId, patch) {
    updateCalls.push({ notionId, patch });
    const existing = db.get(notionId) || makeJob(notionId);
    const updated = {
      ...existing,
      workflow: { ...existing.workflow, ...(patch.caseWorkflowStatus ? { status: patch.caseWorkflowStatus } : {}) },
      result: { ...existing.result },
      feedback: { ...existing.feedback, ...(patch.feedbackStatus ? { status: patch.feedbackStatus } : {}) }
    };
    db.set(notionId, updated);
    return updated;
  },
  async findClientByFeedbackToken() { return null; },
  async findClientByReportToken() { return null; },
  async getAllClients() { return Array.from(db.values()); }
};

require.cache[clientsPath] = {
  id: clientsPath,
  filename: clientsPath,
  loaded: true,
  exports: fakeClientsModule
};

const { closeCase, isTerminalCaseStatus } = require(path.join(ROOT, 'services/workflow-service'));
const { submitCaseAssessment } = require(path.join(ROOT, 'services/assessment-persistence-service'));
const { cardOptionsFromJob } = require(path.join(ROOT, 'services/score-share-card'));
const { setPublicationStore } = require(path.join(ROOT, 'services/score-publication-service'));
const { createMemoryPublicationStore } = require(path.join(ROOT, 'services/score-publication-store-memory'));

// The "no regression for a legitimate Case" sanity test (P1-2c) exercises
// closeCase()'s normal completion path, which calls into
// createOrReusePublication() -- give it the same in-memory ledger double
// already established this session (test-score-publication-null-coercion.js)
// instead of requiring live NOTION_SCORE_PUBLICATIONS_DATABASE_ID config.
setPublicationStore(createMemoryPublicationStore());

async function main() {
  console.log('=== P1-2a: isTerminalCaseStatus() -- pure function correctness ===');
  {
    const cases = [
      { workflow: { status: 'cancelled' }, expect: true, label: 'workflow.status=cancelled' },
      { workflow: { status: 'closed' }, expect: true, label: "workflow.status=closed" },
      { workflow: { status: 'scheduled' }, expect: false, label: 'workflow.status=scheduled' },
      { workflow: { status: 'in_progress' }, expect: false, label: 'workflow.status=in_progress' },
      { workflow: { status: 'completed' }, expect: false, label: 'workflow.status=completed' },
      { workflow: { status: 'result_sent' }, expect: false, label: 'workflow.status=result_sent' }
    ];
    for (const c of cases) {
      const got = isTerminalCaseStatus({ workflow: c.workflow, status: c.workflow.status });
      assert(got === c.expect, `${c.label} => terminal=${c.expect} (got ${got})`);
    }
  }

  console.log('\n=== P1-2b: closeCase() rejects a cancelled Case (real execution) ===');
  {
    db.clear();
    updateCalls.length = 0;
    const id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    db.set(id, makeJob(id, { workflow: { status: 'cancelled' } }));

    const result = await closeCase(id, { score: 80, completedBy: 'QA' });
    assert(result.ok === true && result.idempotent === true, `cancelled Case: closeCase returns idempotent no-op (got ${JSON.stringify({ ok: result.ok, idempotent: result.idempotent })})`);
    assert(result.case.workflow.status === 'cancelled', `cancelled Case: workflow.status stays 'cancelled', not overwritten (got ${result.case.workflow.status})`);
    const completedWrite = updateCalls.find(c => c.patch.caseWorkflowStatus === 'completed');
    assert(!completedWrite, 'cancelled Case: updateClient was NEVER called with caseWorkflowStatus:completed (no completion write happened)');
    assert(updateCalls.length === 0, `cancelled Case: no Notion write of any kind happened (got ${updateCalls.length} calls)`);
  }

  console.log('\n=== P1-2c: closeCase() still works normally for a non-terminal Case (no regression) ===');
  {
    db.clear();
    updateCalls.length = 0;
    const id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    db.set(id, makeJob(id, { workflow: { status: 'in_progress' }, result: { waterScore: null, publicReportToken: 'rpt-active' } }));

    const result = await closeCase(id, { score: 80, completedBy: 'QA' });
    assert(result.ok === true && !result.idempotent, `active Case: closeCase proceeds normally, not treated as idempotent no-op (got ${JSON.stringify({ ok: result.ok, idempotent: result.idempotent })})`);
    const completedWrite = updateCalls.find(c => c.patch.caseWorkflowStatus === 'completed');
    assert(!!completedWrite, 'active Case: updateClient WAS called with caseWorkflowStatus:completed (guard does not block legitimate Cases)');
  }

  console.log('\n=== P1-2d: submitCaseAssessment() rejects a cancelled Case (real execution) ===');
  {
    db.clear();
    updateCalls.length = 0;
    const id = 'cccccccccccccccccccccccccccccccc';
    db.set(id, makeJob(id, { workflow: { status: 'cancelled' } }));

    const snapshot = {
      version: 1,
      updatedAt: new Date().toISOString(),
      revision: 1,
      taps: [{ index: 0, name: 'Tap 1', standardMeasurement: { ph: 7.2, tds: 150, chlorine: 1.0, turbidity: 0.5, orp: 200, do: 7.0 } }]
    };

    let result;
    let threw = null;
    try {
      result = await submitCaseAssessment(id, { snapshot });
    } catch (error) {
      threw = error;
    }
    assert(!threw, `cancelled Case: submitCaseAssessment does not throw (got ${threw && threw.message})`);
    assert(result && result.skipped === true && result.reason === 'terminal_case', `cancelled Case: submitCaseAssessment returns skipped:true, reason:terminal_case (got ${JSON.stringify(result)})`);
    const snapshotWrite = updateCalls.find(c => c.patch.assessmentSnapshot);
    assert(!snapshotWrite, 'cancelled Case: updateClient was NEVER called with an assessmentSnapshot write');
  }

  console.log('\n=== P1-2e: submitCaseAssessment() still works normally for a non-terminal Case (no regression) ===');
  {
    db.clear();
    updateCalls.length = 0;
    const id = 'dddddddddddddddddddddddddddddddd';
    db.set(id, makeJob(id, { workflow: { status: 'in_progress' } }));

    const snapshot = {
      version: 1,
      updatedAt: new Date().toISOString(),
      revision: 1,
      taps: [{ index: 0, name: 'Tap 1', standardMeasurement: { ph: 7.2, tds: 150, chlorine: 1.0, turbidity: 0.5, orp: 200, do: 7.0 } }]
    };
    const result = await submitCaseAssessment(id, { snapshot });
    assert(result.ok === true && result.skipped === false, `active Case: submitCaseAssessment proceeds normally (got ${JSON.stringify({ ok: result.ok, skipped: result.skipped })})`);
    const snapshotWrite = updateCalls.find(c => c.patch.assessmentSnapshot);
    assert(!!snapshotWrite, 'active Case: updateClient WAS called with an assessmentSnapshot write (guard does not block legitimate Cases)');
  }

  console.log('\n=== P1-1a: cardOptionsFromJob() -- null/undefined score never renders as a false positive ===');
  {
    const withNull = cardOptionsFromJob({ result: { waterScore: null, summary: '' } });
    assert(withNull.score === 0, `waterScore=null => rendering fallback score is 0 (numeric field required for SVG; got ${withNull.score})`);
    assert(!/meets international standards|Clean water for daily use/.test(withNull.note), `waterScore=null => note is NOT a false "good score" message (got "${withNull.note}")`);

    const withZero = cardOptionsFromJob({ result: { waterScore: 0, summary: '' } });
    assert(withZero.score === 0, `waterScore=0 (valid) => score is 0 (got ${withZero.score})`);

    const withReal = cardOptionsFromJob({ result: { waterScore: 85, summary: '' } });
    assert(withReal.score === 85, `waterScore=85 => score is 85 (got ${withReal.score})`);
  }

  console.log('\n=== P1-1b: score-card route guard -- source-level expression check ===');
  console.log('(the guard is inline in api/public-routes.js, not a standalone export --');
  console.log(' extracting the literal fixed expression from source and evaluating it directly,');
  console.log(' same technique used earlier this session for workflow-service.js.)');
  {
    const src = fs.readFileSync(path.join(ROOT, 'api/public-routes.js'), 'utf8');
    const exprMatch = src.match(/const rawWaterScore = job\?\.result\?\.waterScore;\r?\n\s*const hasPublishedScore = rawWaterScore !== null[\s\S]*?Number\.isFinite\(Number\(rawWaterScore\)\);/);
    assert(!!exprMatch, 'hasPublishedScore strict-presence expression found in source (test is in sync)');
    if (exprMatch) {
      for (const c of [
        { rawWaterScore: null, expect: false, label: 'null score (fresh Case) => reject (404)' },
        { rawWaterScore: undefined, expect: false, label: 'undefined score => reject (404)' },
        { rawWaterScore: 0, expect: true, label: '0 (valid real score) => accept, serve card' },
        { rawWaterScore: 85, expect: true, label: '85 (valid score) => accept, serve card' }
      ]) {
        const job = { result: { waterScore: c.rawWaterScore } };
        // eslint-disable-next-line no-new-func
        const fn = new Function('job', `${exprMatch[0]}\nreturn Boolean(hasPublishedScore);`);
        const got = fn(job);
        assert(got === c.expect, `${c.label} (got ${got})`);
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
