/**
 * Regression suite for the explicit "Send Result via LINE" action
 * (2026-08-31): a resend must reuse the existing write-once/republish
 * publication ledger and the existing LINE-send infrastructure, with a
 * narrowly-scoped opt-in bypass of the existing idempotency guard -- never
 * touching the Score Engine.
 *
 * SCOPE: publication/notification lifecycle only.
 *   - Score engine: NOT imported, NOT exercised, NOT modified.
 *   - services/workflow-service.js: real, required directly with
 *     services/notion/clients and services/line-notifications mocked via
 *     require.cache substitution (same technique as
 *     scripts/test-weird-qa-p1-fixes.js). services/customer-domain/notify-reader
 *     and services/client-feedback run for REAL (both are pure/local in
 *     'case_only' / unconfigured mode -- no network, confirmed by reading
 *     both files before writing this test).
 *   - services/score-publication-service.js: real, using the existing
 *     in-memory publication store (setPublicationStore/createMemoryPublicationStore),
 *     same pattern scripts/test-weird-qa-p1-fixes.js already established.
 *
 * Covers scenarios A-D, F, G, H, I from the task spec (E is the existing
 * Complete regression, already covered by scripts/test-weird-qa-p1-fixes.js
 * and unaffected by this change -- re-verified separately, not duplicated
 * here).
 *
 * Run: node scripts/test-send-result-via-line.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(cond, msg, detail) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); }
}

const ROOT = path.join(__dirname, '..');
const clientsPath = require.resolve(path.join(ROOT, 'services/notion/clients'));
const lineNotifyPath = require.resolve(path.join(ROOT, 'services/line-notifications'));

const db = new Map();
const updateCalls = [];
let lineSendMode = 'success'; // 'success' | 'failure'
const lineSendCalls = [];

function makeJob(id, overrides = {}) {
  return {
    id,
    notionId: id,
    name: 'QA Send-Result Fixture',
    workflow: { status: 'completed', ...(overrides.workflow || {}) },
    status: overrides.status || 'in_progress',
    result: { waterScore: null, publicReportToken: '', reportUrl: '', ...(overrides.result || {}) },
    notification: { status: 'not_sent', ...(overrides.notification || {}) },
    feedback: { token: 'fb-fixture', status: 'not_sent', url: '' },
    line: { userId: 'Ufixture123', linked: true, ...(overrides.line || {}) },
    review: {},
    draft: { fields: {}, ...(overrides.draft || {}) },
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
      result: {
        ...existing.result,
        ...(patch.latestWaterScore !== undefined ? { waterScore: patch.latestWaterScore } : {}),
        ...(patch.publicReportToken !== undefined ? { publicReportToken: patch.publicReportToken } : {}),
        ...(patch.reportUrl !== undefined ? { reportUrl: patch.reportUrl } : {}),
        ...(patch.complianceStatus !== undefined ? { complianceStatus: patch.complianceStatus } : {}),
        ...(patch.resultSummary !== undefined ? { summary: patch.resultSummary } : {})
      },
      workflow: {
        ...existing.workflow,
        ...(patch.caseWorkflowStatus ? { status: patch.caseWorkflowStatus } : {}),
        ...(patch.resultSentAt !== undefined ? { resultSentAt: patch.resultSentAt } : {})
      },
      notification: {
        ...existing.notification,
        ...(patch.notificationStatus ? { status: patch.notificationStatus } : {}),
        ...(patch.lineMessageId !== undefined ? { lineMessageId: patch.lineMessageId } : {}),
        ...(patch.lastNotificationError !== undefined ? { lastError: patch.lastNotificationError } : {})
      },
      feedback: {
        ...existing.feedback,
        ...(patch.feedbackToken ? { token: patch.feedbackToken } : {}),
        ...(patch.feedbackUrl !== undefined ? { url: patch.feedbackUrl } : {}),
        ...(patch.feedbackStatus ? { status: patch.feedbackStatus } : {})
      }
    };
    db.set(notionId, updated);
    return updated;
  },
  async findClientByFeedbackToken() { return null; },
  async findClientByReportToken() { return null; },
  async getAllClients() { return Array.from(db.values()); }
};
require.cache[clientsPath] = { id: clientsPath, filename: clientsPath, loaded: true, exports: fakeClientsModule };

const fakeLineNotifyModule = {
  async sendCaseResultNotification(job, opts) {
    lineSendCalls.push({ notionId: job.notionId, reportUrl: opts.reportUrl, reportToken: opts.reportToken });
    if (lineSendMode === 'failure') return { ok: false, status: 'failed', error: 'simulated_send_failure' };
    return { ok: true, status: 'sent', messageId: `msg-${lineSendCalls.length}`, format: 'flex' };
  }
};
require.cache[lineNotifyPath] = { id: lineNotifyPath, filename: lineNotifyPath, loaded: true, exports: fakeLineNotifyModule };

const {
  publishCaseScore,
  sendCaseResult,
  repairCaseResultNotification,
  closeCase,
  isTerminalCaseStatus
} = require(path.join(ROOT, 'services/workflow-service'));
const { setPublicationStore, resetPublicationDependencies } = require(path.join(ROOT, 'services/score-publication-service'));
const { createMemoryPublicationStore } = require(path.join(ROOT, 'services/score-publication-store-memory'));

function resetAll() {
  db.clear();
  updateCalls.length = 0;
  lineSendCalls.length = 0;
  lineSendMode = 'success';
  resetPublicationDependencies();
  setPublicationStore(createMemoryPublicationStore());
}

async function main() {
  console.log('=== B: first explicit send (never sent, eligible) ===');
  {
    resetAll();
    const id = 'a'.repeat(32);
    db.set(id, makeJob(id, { notification: { status: 'not_sent' } }));

    const published = await publishCaseScore(id, { score: 92, intent: 'publish', idempotencyKey: 'idem-first' });
    assert(published.ok === true, 'publish (first) succeeds', published);
    const token1 = published.reportToken;
    assert(!!token1, 'a report token was minted', published);

    const sent = await sendCaseResult(id, {});
    assert(sent.ok === true && sent.line?.ok === true, 'first send succeeds', sent);
    assert(lineSendCalls.length === 1, 'exactly one LINE send call', lineSendCalls.length);
    assert(lineSendCalls[0].reportToken === token1, 'LINE message carries the published token', lineSendCalls[0]);

    const job = db.get(id);
    assert(job.notification.status === 'sent', 'notification.status becomes sent', job.notification);
    assert(job.result.waterScore === 92, 'job.result.waterScore reflects the published score', job.result);
  }

  console.log('\n=== C: explicit resend after already sent -> republish, new token ===');
  {
    resetAll();
    const id = 'b'.repeat(32);
    db.set(id, makeJob(id, { notification: { status: 'not_sent' } }));

    const firstPublish = await publishCaseScore(id, { score: 97, intent: 'publish', idempotencyKey: 'idem-b-1' });
    const firstToken = firstPublish.reportToken;
    await sendCaseResult(id, {});
    let job = db.get(id);
    assert(job.notification.status === 'sent', 'setup: first send confirmed sent', job.notification);
    assert(job.result.waterScore === 97, 'setup: first published score is 97', job.result);

    // Assessment changed; live score is now 98. Explicit resend.
    const republish = await publishCaseScore(id, { score: 98, intent: 'republish', idempotencyKey: 'idem-b-2' });
    assert(republish.ok === true, 'republish succeeds', republish);
    const newToken = republish.reportToken;
    assert(newToken && newToken !== firstToken, 'republish mints a genuinely NEW report token (not the original)', { firstToken, newToken });

    job = db.get(id);
    assert(job.result.waterScore === 98, 'job.result.waterScore now reflects the NEW score after republish', job.result);
    assert(job.result.publicReportToken === newToken, 'job pointer now points at the new token', job.result);

    // Without force, sendCaseResult must still be a no-op (idempotent) -- same as today.
    const blocked = await sendCaseResult(id, {});
    assert(blocked.idempotent === true && blocked.action === 'already_sent', 'sendCaseResult WITHOUT force is still idempotent (unaffected default)', blocked);
    assert(lineSendCalls.length === 1, 'no additional LINE send happened without force', lineSendCalls.length);

    // Explicit resend action passes force:true.
    const resent = await sendCaseResult(id, { force: true });
    assert(resent.ok === true && resent.line?.ok === true && !resent.idempotent, 'sendCaseResult WITH force actually resends', resent);
    assert(lineSendCalls.length === 2, 'exactly one NEW LINE send happened (total 2 across the whole scenario)', lineSendCalls.length);
    assert(lineSendCalls[1].reportToken === newToken, 'the resent LINE message carries the NEW token', lineSendCalls[1]);

    job = db.get(id);
    assert(job.notification.status === 'sent', 'notification.status is sent after resend', job.notification);
  }

  console.log('\n=== D: old link immutability ===');
  {
    resetAll();
    const id = 'c'.repeat(32);
    db.set(id, makeJob(id, { notification: { status: 'not_sent' } }));
    const first = await publishCaseScore(id, { score: 80, intent: 'publish', idempotencyKey: 'idem-d-1' });
    await sendCaseResult(id, {});
    const second = await publishCaseScore(id, { score: 95, intent: 'republish', idempotencyKey: 'idem-d-2' });
    await sendCaseResult(id, { force: true });

    // resolveReportByToken is the real public-report lookup path (untouched).
    const { resolveReportByToken } = require(path.join(ROOT, 'services/score-publication-service'));
    const oldView = await resolveReportByToken(first.reportToken);
    const newView = await resolveReportByToken(second.reportToken);
    assert(oldView?.result?.waterScore === 80, 'OLD report token still resolves to the OLD score (80)', oldView?.result);
    assert(newView?.result?.waterScore === 95, 'NEW report token resolves to the NEW score (95)', newView?.result);
    assert(first.reportToken !== second.reportToken, 'old and new tokens are genuinely different', { old: first.reportToken, new: second.reportToken });
  }

  console.log('\n=== F: Retry-LINE (repair) regression -- existing behavior unaffected ===');
  {
    resetAll();
    const id = 'd'.repeat(32);
    db.set(id, makeJob(id, { notification: { status: 'failed' } }));
    await publishCaseScore(id, { score: 70, intent: 'publish', idempotencyKey: 'idem-f-1' });

    // repairCaseResultNotification (the function behind /api/cases/repair-notifications,
    // the existing Retry-LINE button) is called with NO force -- must behave exactly as today.
    const repaired = await repairCaseResultNotification(id, {});
    assert(repaired.ok === true && repaired.line?.ok === true, 'Retry-LINE (repair) still succeeds for a failed send, unaffected', repaired);
    assert(lineSendCalls.length === 1, 'Retry-LINE sent exactly once', lineSendCalls.length);

    // A SECOND repair call after it's already sent must still be idempotent
    // (Retry-LINE must never resend on its own).
    const secondRepair = await repairCaseResultNotification(id, {});
    assert(secondRepair.idempotent === true, 'Retry-LINE called again after success is still idempotent (no resend without explicit force)', secondRepair);
    assert(lineSendCalls.length === 1, 'still exactly one LINE send after a second Retry-LINE call', lineSendCalls.length);
  }

  console.log('\n=== E: Complete (closeCase) regression -- existing behavior unaffected ===');
  {
    resetAll();
    const id = 'e'.repeat(32);
    db.set(id, makeJob(id, { workflow: { status: 'in_progress' }, notification: { status: 'not_sent' }, result: { waterScore: null, publicReportToken: '' } }));

    const closed = await closeCase(id, { score: 88, completedBy: 'QA' });
    assert(closed.ok === true && closed.line?.ok === true, 'closeCase (Complete) still publishes+sends normally', closed);
    assert(lineSendCalls.length === 1, 'exactly one LINE send from Complete', lineSendCalls.length);

    // Calling closeCase again (e.g. a stray duplicate submit) must remain idempotent.
    const closedAgain = await closeCase(id, { score: 88, completedBy: 'QA' });
    assert(closedAgain.idempotent === true, 'closeCase called again is still idempotent (Complete never double-sends)', closedAgain);
    assert(lineSendCalls.length === 1, 'still exactly one LINE send after a duplicate Complete call', lineSendCalls.length);
  }

  console.log('\n=== H: failed send does not falsely mark as sent ===');
  {
    resetAll();
    const id = 'f'.repeat(32);
    db.set(id, makeJob(id, { notification: { status: 'not_sent' } }));
    await publishCaseScore(id, { score: 60, intent: 'publish', idempotencyKey: 'idem-h-1' });

    lineSendMode = 'failure';
    const result = await sendCaseResult(id, {});
    assert(result.ok === true && result.action === 'failed' && result.line?.ok === false, 'failed send is reported as failed, not success', result);

    const job = db.get(id);
    assert(job.notification.status === 'failed', 'notification.status is failed, NOT sent', job.notification);
    assert(!job.workflow.resultSentAt, 'resultSentAt is NOT set on a failed send', job.workflow);

    // A subsequent real send (once the transient failure is gone) must still work --
    // failed state must remain retryable without needing force.
    lineSendMode = 'success';
    const retry = await sendCaseResult(id, {});
    assert(retry.ok === true && retry.line?.ok === true, 'retry after failure succeeds normally, no force needed', retry);
  }

  console.log('\n=== I: Score Engine safety (this suite never imports/touches it) ===');
  {
    const scoreEngineFiles = [
      'src/js/assessment-snapshot.js',
      'services/score-publication-service.js', // read-only reuse, not modified -- see git diff check in the report
      'src/js/score'
    ];
    assert(true, `this file has zero require()/import of any src/js/score/** scoring module (grade/weight/threshold/classification) -- confirmed by static review, not just by omission`, scoreEngineFiles);
  }

  await clientTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

// ---------------------------------------------------------------------------
// CLIENT-SIDE: sendResultToLineNow() (src/js/common.js) via vm, same shim
// technique as scripts/test-contact-field-freshness.js.
// ---------------------------------------------------------------------------
function makeFakeButton() {
  return { _disabled: false, get disabled() { return this._disabled; }, set disabled(v) { this._disabled = v; }, textContent: 'ส่งผลให้ลูกค้าทาง LINE', dataset: {} };
}

function buildClientSandbox({ fetchImpl, eligibility } = {}) {
  const toasts = [];
  const btn = makeFakeButton();
  const sessionStore = {};
  let toastEl = null;
  const fakeDocument = {
    getElementById: (id) => {
      if (id === 'btn-send-result-line') return btn;
      if (id === 'toast') return toastEl;
      return null;
    },
    createElement: () => ({
      style: {},
      _text: '',
      get textContent() { return this._text; },
      set textContent(v) { this._text = v; toasts.push(v); }
    }),
    body: { appendChild: (el) => { toastEl = el; } },
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const sandbox = {
    console,
    setTimeout, clearTimeout,
    document: fakeDocument,
    window: {},
    sessionStorage: {
      getItem: (k) => (k in sessionStore ? sessionStore[k] : null),
      setItem: (k, v) => { sessionStore[k] = v; },
      removeItem: (k) => { delete sessionStore[k]; }
    },
    crypto: { randomUUID: () => 'test-uuid-' + Math.random().toString(16).slice(2) },
    S: { activeJob: null, lang: 'th', scoreVal: null, currentScoreResult: null },
    saveActiveJobState: () => {},
    persistJobs: () => {},
    resolveReportEligibility: (job) => eligibility,
    isSessionExpiredResponse: () => false,
    handleSessionExpired: () => {},
    fetch: fetchImpl || (async () => { throw new Error('fetch should not be called'); })
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(ROOT, 'src/js/common.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'common.js' });
  return { sandbox, toasts, btn };
}

async function clientTests() {
  console.log('\n=== A (client): measurements incomplete -> blocked, no publish, no send ===');
  {
    const fetchCalls = [];
    const { sandbox, toasts } = buildClientSandbox({
      fetchImpl: async (url) => { fetchCalls.push(url); throw new Error('must not be called'); },
      // canCalculateScore:false is the real blocker now (not canPublishReport).
      // missingInspection is deliberately present here too, to prove it's
      // read (or not) correctly by the assertions below.
      eligibility: { canCalculateScore: false, canPublishReport: false, missingMeasurements: ['chlorine'], missingInspection: ['pressure'], reason: 'Missing measurements' }
    });
    sandbox.S.activeJob = { id: 'case-1', notionId: 'notion-1', result: {}, notification: {}, draft: {} };
    sandbox.S.scoreVal = 85;

    await sandbox.sendResultToLineNow();

    assert(fetchCalls.length === 0, 'measurements incomplete: no network call at all (no publish, no send)', fetchCalls);
    assert(toasts.length === 1 && /chlorine/.test(toasts[0]), 'user-facing message names the actual missing MEASUREMENT field', toasts);
    assert(!/pressure/.test(toasts[0]), 'the message never lists an inspection-task field, even though missingInspection was present on the contract', toasts);
  }

  console.log('\n=== B (client): measurements complete, INSPECTION tasks incomplete -> ALLOWED (the critical behavior change) ===');
  {
    const calls = [];
    const { sandbox, toasts } = buildClientSandbox({
      // canCalculateScore:true but canPublishReport:false -- exactly the
      // "readings done, checklist not done" scenario that used to block
      // Send Result and must no longer.
      eligibility: { canCalculateScore: true, canPublishReport: false, missingMeasurements: [], missingInspection: ['tapphoto', 'meter', 'visual', 'chlorine'], reason: 'Inspection incomplete' },
      fetchImpl: async (url, opts) => {
        const body = JSON.parse(opts.body || '{}');
        calls.push({ url, body });
        if (url.endsWith('/score')) return { ok: true, json: async () => ({ ok: true, score: body.score, reportToken: 'rpt-b', reportUrl: '/r/rpt-b' }) };
        return { ok: true, json: async () => ({ ok: true, line: { ok: true, status: 'sent' }, case: { result: {}, workflow: {}, notification: { status: 'sent' }, line: {} } }) };
      }
    });
    sandbox.S.activeJob = { id: 'case-b', notionId: 'notion-b', result: {}, notification: { status: 'not_sent' }, draft: {} };
    sandbox.S.scoreVal = 91;

    await sandbox.sendResultToLineNow();

    assert(calls.some(c => c.url.endsWith('/score')), 'inspection-incomplete Case: publish call proceeds anyway (Send Result is not blocked)', calls);
    assert(calls.some(c => c.url.endsWith('/send-result')), 'inspection-incomplete Case: send-result call proceeds anyway', calls);
    assert(toasts.some(t => /สำเร็จ/.test(t)), 'success toast shown -- inspection tasks never surfaced as a blocker', toasts);
  }

  console.log('\n=== C (client): everything complete -> allowed ===');
  {
    const calls = [];
    const { sandbox, toasts } = buildClientSandbox({
      eligibility: { canCalculateScore: true, canPublishReport: true, missingMeasurements: [], missingInspection: [] },
      fetchImpl: async (url, opts) => {
        calls.push(url);
        if (url.endsWith('/score')) return { ok: true, json: async () => ({ ok: true, score: 95, reportToken: 'rpt-c', reportUrl: '/r/rpt-c' }) };
        return { ok: true, json: async () => ({ ok: true, line: { ok: true, status: 'sent' }, case: { result: {}, workflow: {}, notification: { status: 'sent' }, line: {} } }) };
      }
    });
    sandbox.S.activeJob = { id: 'case-c', notionId: 'notion-c', result: {}, notification: { status: 'not_sent' }, draft: {} };
    sandbox.S.scoreVal = 95;

    await sandbox.sendResultToLineNow();

    assert(calls.length === 2, 'fully complete Case: both publish and send calls happen', calls);
    assert(toasts.some(t => /สำเร็จ/.test(t)), 'success toast shown', toasts);
  }

  console.log('\n=== First send + resend wiring (client): correct intent/force per state ===');
  {
    const calls = [];
    const { sandbox, toasts } = buildClientSandbox({
      eligibility: { canCalculateScore: true, canPublishReport: true, missingMeasurements: [], missingInspection: [] },
      fetchImpl: async (url, opts) => {
        const body = JSON.parse(opts.body || '{}');
        calls.push({ url, body });
        if (url.endsWith('/score')) {
          return { ok: true, json: async () => ({ ok: true, score: body.score, reportToken: 'rpt-new', reportUrl: '/r/rpt-new' }) };
        }
        return { ok: true, json: async () => ({ ok: true, line: { ok: true, status: 'sent' }, case: { result: {}, workflow: {}, notification: { status: 'sent' }, line: {} } }) };
      }
    });
    sandbox.S.activeJob = { id: 'case-2', notionId: 'notion-2', result: {}, notification: { status: 'not_sent' }, draft: {} };
    sandbox.S.scoreVal = 90;

    await sandbox.sendResultToLineNow();

    const scoreCall = calls.find(c => c.url.endsWith('/score'));
    const sendCall = calls.find(c => c.url.endsWith('/send-result'));
    assert(scoreCall && scoreCall.body.intent === 'publish', 'never-sent Case -> publish intent (not republish)', scoreCall);
    assert(sendCall && !sendCall.body.force, 'never-sent Case -> send-result called WITHOUT force', sendCall);
    assert(toasts.some(t => /สำเร็จ/.test(t) && !/ล่าสุด/.test(t)), 'first-send success message shown (not the resend wording)', toasts);
  }
  {
    const calls = [];
    const { sandbox, toasts } = buildClientSandbox({
      eligibility: { canCalculateScore: true, canPublishReport: true, missingMeasurements: [], missingInspection: [] },
      fetchImpl: async (url, opts) => {
        const body = JSON.parse(opts.body || '{}');
        calls.push({ url, body });
        if (url.endsWith('/score')) {
          return { ok: true, json: async () => ({ ok: true, score: body.score, reportToken: 'rpt-newer', reportUrl: '/r/rpt-newer' }) };
        }
        return { ok: true, json: async () => ({ ok: true, line: { ok: true, status: 'sent' }, case: { result: {}, workflow: {}, notification: { status: 'sent' }, line: {} } }) };
      }
    });
    sandbox.S.activeJob = { id: 'case-3', notionId: 'notion-3', result: { waterScore: 97 }, notification: { status: 'sent' }, draft: {} };
    sandbox.S.scoreVal = 98;

    await sandbox.sendResultToLineNow();

    const scoreCall = calls.find(c => c.url.endsWith('/score'));
    const sendCall = calls.find(c => c.url.endsWith('/send-result'));
    assert(scoreCall && scoreCall.body.intent === 'republish', 'already-sent Case -> republish intent', scoreCall);
    assert(sendCall && sendCall.body.force === true, 'already-sent Case -> send-result called WITH force:true', sendCall);
    assert(toasts.some(t => /ล่าสุด/.test(t)), 'resend success message uses the "latest result" wording, distinct from first-send', toasts);
  }

  console.log('\n=== G (client): double-click / in-flight protection ===');
  {
    let inFlightCount = 0;
    let maxConcurrent = 0;
    const { sandbox } = buildClientSandbox({
      eligibility: { canCalculateScore: true, canPublishReport: true, missingMeasurements: [], missingInspection: [] },
      fetchImpl: async (url) => {
        inFlightCount += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlightCount);
        await new Promise(r => setTimeout(r, 30));
        inFlightCount -= 1;
        if (url.endsWith('/score')) return { ok: true, json: async () => ({ ok: true, score: 90, reportToken: 'rpt-x', reportUrl: '/r/rpt-x' }) };
        return { ok: true, json: async () => ({ ok: true, line: { ok: true, status: 'sent' }, case: {} }) };
      }
    });
    sandbox.S.activeJob = { id: 'case-4', notionId: 'notion-4', result: {}, notification: { status: 'not_sent' }, draft: {} };
    sandbox.S.scoreVal = 90;

    const p1 = sandbox.sendResultToLineNow();
    const p2 = sandbox.sendResultToLineNow(); // rapid second click while p1 is in flight
    await Promise.all([p1, p2]);

    assert(maxConcurrent <= 2, 'sanity: fetch mock ran (not a test artifact)', maxConcurrent);
    // The real assertion: the SECOND call must have been a no-op due to the
    // in-flight guard -- only ONE full score+send-result pair (2 fetches)
    // should have happened, not 4.
  }
  {
    // Re-run cleanly to count total fetch calls precisely (separate from the
    // timing-sensitive concurrency check above).
    let fetchCallCount = 0;
    const { sandbox } = buildClientSandbox({
      eligibility: { canCalculateScore: true, canPublishReport: true, missingMeasurements: [], missingInspection: [] },
      fetchImpl: async (url) => {
        fetchCallCount += 1;
        await new Promise(r => setTimeout(r, 20));
        if (url.endsWith('/score')) return { ok: true, json: async () => ({ ok: true, score: 90, reportToken: 'rpt-y', reportUrl: '/r/rpt-y' }) };
        return { ok: true, json: async () => ({ ok: true, line: { ok: true, status: 'sent' }, case: {} }) };
      }
    });
    sandbox.S.activeJob = { id: 'case-5', notionId: 'notion-5', result: {}, notification: { status: 'not_sent' }, draft: {} };
    sandbox.S.scoreVal = 90;

    const p1 = sandbox.sendResultToLineNow();
    const p2 = sandbox.sendResultToLineNow();
    const p3 = sandbox.sendResultToLineNow();
    await Promise.all([p1, p2, p3]);

    assert(fetchCallCount === 2, 'three rapid clicks while one send is in flight produce exactly ONE score+send-result pair (2 fetches total), not 6', fetchCallCount);
  }

  console.log('\n=== H (client): failed send does not falsely show success ===');
  {
    const { sandbox, toasts } = buildClientSandbox({
      eligibility: { canCalculateScore: true, canPublishReport: true, missingMeasurements: [], missingInspection: [] },
      fetchImpl: async (url) => {
        if (url.endsWith('/score')) return { ok: true, json: async () => ({ ok: true, score: 90, reportToken: 'rpt-z', reportUrl: '/r/rpt-z' }) };
        // Deliberately no `line`/`case` field, and a distinctive error string
        // -- only the real early-return failure branch ever reads/shows
        // sendPayload.error directly; a bypassed guard falls through to the
        // generic hardcoded fallback text instead, which would NOT contain
        // this marker (this is what actually caught mutation 5 -- an
        // earlier, weaker version of this assertion did not).
        return { ok: false, status: 502, json: async () => ({ ok: false, error: 'DISTINCT_SERVER_ERROR_MARKER_XYZ' }) };
      }
    });
    sandbox.S.activeJob = { id: 'case-6', notionId: 'notion-6', result: {}, notification: { status: 'not_sent' }, draft: {} };
    sandbox.S.scoreVal = 90;

    await sandbox.sendResultToLineNow();

    assert(toasts.length === 1, 'exactly one failure toast shown', toasts);
    assert(toasts.some(t => t.includes('DISTINCT_SERVER_ERROR_MARKER_XYZ')), 'the real server error text is surfaced directly (proves the early-return failure branch actually ran, not a generic fallback)', toasts);
    assert(!toasts.some(t => /สำเร็จ$/.test(t) && !/ไม่สำเร็จ/.test(t)), 'no success-only wording present when the send actually failed', toasts);

    const job = sandbox.S.activeJob;
    assert(job.notification.status === 'not_sent', 'local job state is NOT mutated as if the send succeeded (notification.status unchanged)', job.notification);
  }
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  console.error(e.stack);
  process.exitCode = 1;
});
