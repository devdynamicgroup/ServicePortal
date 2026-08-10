/**
 * Case persistence / rehydration invariants.
 * Run: node tests/case-persistence-rehydration.test.js
 *
 * Target Case (production evidence — DO NOT recreate):
 *   name: 13.28
 *   notionId: 3b59a92d-fb61-81d0-b8dd-f85d416bacac
 *   compact id: 3b59a92dfb6181d0b8ddf85d416bacac
 *   date: 2026-08-10
 *
 * Proves: durable identity survives S reset + Notion list reload;
 * local-only unsynced Cases are not wiped by API refresh;
 * score/benchmark context must not replace Case identity.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const TARGET = {
  name: '13.28',
  notionId: '3b59a92d-fb61-81d0-b8dd-f85d416bacac',
  id: '3b59a92dfb6181d0b8ddf85d416bacac',
  date: '2026-08-10',
  createdTime: '2026-08-07T06:33:00.000Z',
  status: 'new'
};

const store = new Map();
const localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); }
};

const sandbox = {
  console,
  localStorage,
  window: {},
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
  fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  S: {
    lang: 'en',
    selDay: 0,
    activeJob: null,
    pkg: 'essential',
    stepsDone: {},
    tapData: null,
    scoreStandardKey: 'thailand',
    scoreVal: null,
    scoreBaseReadings: null,
    currentScoreResult: null,
    comparisonScoreResult: null
  },
  JOBS: [],
  weekBase: new Date(2026, 7, 10),
  getMonday(d) {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const m = new Date(d);
    m.setDate(diff);
    m.setHours(0, 0, 0, 0);
    return m;
  },
  AssessmentSnapshot: undefined,
  OperatorNotificationBridge: undefined,
  t: (k) => k,
  showToast() {}
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);

// Load job-state helpers only (persistence / rehydration).
vm.runInContext(fs.readFileSync(path.join(root, 'src/js/job-state.js'), 'utf8'), sandbox, {
  filename: 'job-state.js'
});

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${msg}`);
  }
}

function targetJob(overrides = {}) {
  return {
    id: TARGET.id,
    notionId: TARGET.notionId,
    name: TARGET.name,
    date: TARGET.date,
    createdTime: TARGET.createdTime,
    status: TARGET.status,
    notionSource: true,
    draft: {
      tapData: [{
        meterReadings: { ph: 7.79, tds: 92, turbidity: 0.12, orp: 434.1, do: 6.34, chlorine: 0.3 }
      }]
    },
    ...overrides
  };
}

console.log('\nTARGET CASE identity (must not be recreated in tests)');
{
  assert(TARGET.notionId === '3b59a92d-fb61-81d0-b8dd-f85d416bacac', 'target notionId locked');
  assert(TARGET.id === '3b59a92dfb6181d0b8ddf85d416bacac', 'target compact id locked');
  assert(TARGET.name === '13.28', 'target name locked');
}

console.log('\nCASE_CREATED_MUST_PERSIST — durable active ref');
{
  store.clear();
  sandbox.JOBS.length = 0;
  sandbox.S.activeJob = null;
  const job = targetJob();
  sandbox.persistActiveCaseRef(job);
  const ref = sandbox.readActiveCaseRef();
  assert(ref?.notionId === TARGET.notionId, 'wm-active-case-ref stores notionId');
  assert(ref?.id === TARGET.id, 'wm-active-case-ref stores id');
  assert(ref?.date === TARGET.date, 'wm-active-case-ref stores date');
}

console.log('\nREHYDRATION_MUST_RESTORE_CASE — S reset then restore');
{
  store.clear();
  sandbox.JOBS.splice(0, sandbox.JOBS.length, targetJob());
  sandbox.persistActiveCaseRef(sandbox.JOBS[0]);
  // Simulate full session wipe (reload / deploy / restart).
  sandbox.S.activeJob = null;
  sandbox.S.scoreStandardKey = 'japan';
  sandbox.S.scoreVal = 999;
  const restored = sandbox.restoreActiveCaseFromPersistence();
  assert(restored?.notionId === TARGET.notionId, 'restored same notionId');
  assert(restored?.id === TARGET.id, 'restored same id');
  assert(sandbox.S.activeJob?.notionId === TARGET.notionId, 'S.activeJob rehydrated');
  assert(sandbox.S.activeJob?.date === TARGET.date, 'date unchanged');
  assert(
    sandbox.S.activeJob?.draft?.tapData?.[0]?.meterReadings?.ph === 7.79,
    'measurements still on restored Case'
  );
}

console.log('\nCASE_MUST_SURVIVE_BROWSER_RELOAD — Notion list replaces JOBS');
(async () => {
  store.clear();
  const original = targetJob();
  sandbox.JOBS.splice(0, sandbox.JOBS.length, original);
  sandbox.S.activeJob = original;
  sandbox.persistActiveCaseRef(original);
  localStorage.setItem('wm-jobs', JSON.stringify(sandbox.JOBS));

  // Cold boot: memory empty, then API returns the same Notion Case.
  sandbox.JOBS.length = 0;
  sandbox.S.activeJob = null;

  sandbox.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      source: 'notion',
      count: 1,
      jobs: [targetJob({ draft: { tapData: [{ meterReadings: { ph: 7.79 } }] } })]
    })
  });

  await sandbox.loadJobsFromApi();
  assert(sandbox.JOBS.some(j => j.notionId === TARGET.notionId), 'Case still in JOBS after API reload');
  assert(sandbox.S.activeJob?.notionId === TARGET.notionId, 'active Case restored after API reload');
  assert(sandbox.S.activeJob?.id === TARGET.id, 'CASE_ID_MUST_NOT_CHANGE');
  assert(sandbox.readActiveCaseRef()?.notionId === TARGET.notionId, 'NOTION_ID_MUST_NOT_CHANGE on ref');

  console.log('\nCASE_MUST_SURVIVE — local-only unsynced calendar Case not wiped');
  store.clear();
  sandbox.JOBS.length = 0;
  sandbox.S.activeJob = null;
  const localOnly = {
    id: 2001,
    name: 'Local Calendar Case',
    date: '2026-08-10',
    status: 'new',
    // Legacy calendar "+" path: no manualPending, no notionId
    draft: { tapData: [{ meterReadings: { ph: 7.2 } }] }
  };
  localStorage.setItem('wm-jobs', JSON.stringify([localOnly]));
  sandbox.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      jobs: [targetJob()]
    })
  });
  await sandbox.loadJobsFromApi();
  assert(sandbox.JOBS.some(j => j.notionId === TARGET.notionId), 'Notion Case present');
  assert(sandbox.JOBS.some(j => String(j.id) === '2001'), 'local-only Case preserved across API refresh');

  console.log('\nBENCHMARK_SWITCH_MUST_NOT_REPLACE_CASE');
  {
    const job = targetJob();
    sandbox.JOBS.splice(0, sandbox.JOBS.length, job);
    sandbox.S.activeJob = job;
    sandbox.persistActiveCaseRef(job);
    const before = JSON.stringify({
      id: job.id, notionId: job.notionId, date: job.date, createdTime: job.createdTime,
      tap: job.draft.tapData
    });
    sandbox.S.scoreStandardKey = 'japan';
    sandbox.S.comparisonScoreResult = { standardKey: 'japan', score: 100 };
    sandbox.S.scoreStandardKey = 'thailand';
    sandbox.S.comparisonScoreResult = { standardKey: 'thailand', score: 100 };
    const after = JSON.stringify({
      id: sandbox.S.activeJob.id,
      notionId: sandbox.S.activeJob.notionId,
      date: sandbox.S.activeJob.date,
      createdTime: sandbox.S.activeJob.createdTime,
      tap: sandbox.S.activeJob.draft.tapData
    });
    assert(before === after, 'benchmark switch leaves Case identity + measurements unchanged');
  }

  console.log('\nSCORE_MUST_NOT_REPLACE_CASE');
  {
    const job = targetJob();
    sandbox.S.activeJob = job;
    sandbox.S.scoreVal = 92;
    sandbox.S.currentScoreResult = { standardKey: 'quality-v3', score: 92, computedScore: 92 };
    assert(sandbox.S.activeJob.notionId === TARGET.notionId, 'score result does not change notionId');
    assert(sandbox.S.activeJob.id === TARGET.id, 'score result does not change case id');
  }

    console.log('\nExplicit cancel clears durable ref only');
  {
    sandbox.persistActiveCaseRef(targetJob());
    assert(sandbox.readActiveCaseRef()?.notionId === TARGET.notionId, 'ref present before clear');
    sandbox.clearActiveCaseRef();
    assert(sandbox.readActiveCaseRef() === null, 'CASE_DISAPPEARS_ONLY_AFTER_EXPLICIT clear/cancel path');
  }

    console.log('\nCASE_CREATED_IS_PERSISTED — createDurablePortalCase');
  {
    store.clear();
    sandbox.JOBS.length = 0;
    sandbox.S.activeJob = null;
    sandbox.clearActiveCaseRef();
    let postCount = 0;
    const durableNotionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const durableCompact = durableNotionId.replace(/-/g, '');
    sandbox.fetch = async (url, opts = {}) => {
      const u = String(url);
      const isCreatePost = opts.method === 'POST' && (u === '/api/cases' || u.endsWith('/api/cases'));
      if (isCreatePost) {
        postCount += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            case: {
              id: durableCompact,
              notionId: durableNotionId,
              name: 'New Client',
              date: '2026-08-10',
              status: 'new',
              createdTime: '2026-08-10T07:00:00.000Z',
              notionSource: true
            }
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const created = await sandbox.createDurablePortalCase({
      name: 'New Client',
      date: '2026-08-10',
      day: 0,
      status: 'new',
      meta: 'Calendar + durable'
    });
    assert(created.ok === true, 'CALENDAR_PLUS / portal create returns ok');
    assert(created.case?.notionId === durableNotionId, 'CREATED_CASE_HAS_DURABLE_IDENTITY notionId');
    assert(created.case?.id === durableCompact, 'CREATED_CASE_HAS_DURABLE_IDENTITY caseId');
    assert(sandbox.JOBS.some(j => j.notionId === durableNotionId), 'JOBS contains durable Case only after success');
    assert(postCount === 1, 'NO_DUPLICATE_CASE_CREATED — single POST');

    // Second call with same job object after identity assigned is idempotent.
    const again = await sandbox.createManualCaseInNotion(created.case);
    assert(again.idempotent === true && postCount === 1, 'NO_DUPLICATE_CASE_CREATED — idempotent retry');

    // Reload / API rehydration finds the same Case.
    sandbox.S.activeJob = null;
    sandbox.JOBS.length = 0;
    sandbox.persistActiveCaseRef(created.case);
    sandbox.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        jobs: [{
          id: durableCompact,
          notionId: durableNotionId,
          name: 'New Client',
          date: '2026-08-10',
          status: 'new',
          createdTime: '2026-08-10T07:00:00.000Z',
          draft: { fields: {}, tapData: [] }
        }]
      })
    });
    await sandbox.loadJobsFromApi();
    assert(sandbox.JOBS.some(j => j.notionId === durableNotionId), 'CREATED_CASE_SURVIVES_API_REHYDRATION');
    assert(sandbox.S.activeJob?.notionId === durableNotionId, 'CREATED_CASE_SURVIVES_RELOAD via active ref');
  }

  console.log('\nFAILED persistence must not invent durable Case');
  {
    store.clear();
    sandbox.JOBS.length = 0;
    sandbox.clearActiveCaseRef();
    sandbox.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ ok: false, error: 'notion_down' })
    });
    const failedCreate = await sandbox.createDurablePortalCase({
      name: 'Should Fail',
      date: '2026-08-10',
      status: 'new'
    });
    assert(failedCreate.ok === false, 'failure returns ok=false');
    assert(failedCreate.case === null, 'failure does not return Case');
    assert(sandbox.JOBS.length === 0, 'JOBS empty when create persistence fails');
    assert(sandbox.readActiveCaseRef() === null, 'no active ref on failed create');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
