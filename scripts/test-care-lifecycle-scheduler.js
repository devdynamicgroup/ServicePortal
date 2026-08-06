#!/usr/bin/env node
'use strict';

/**
 * Care lifecycle scheduler — flag-off / dry-run safety tests.
 * Never hits Notion or LINE.
 */

const assert = require('assert');
const path = require('path');

function withEnv(overrides, fn) {
  const prev = {};
  for (const key of Object.keys(overrides)) {
    prev[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = String(overrides[key]);
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

async function main() {
  let passed = 0;
  const fail = (name, err) => {
    console.error(`FAIL  ${name}: ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  };
  const ok = (name) => {
    passed += 1;
    console.log(`PASS  ${name}`);
  };

  // Fresh require after env — clear cache for scheduler + flags
  function loadScheduler() {
    const schedPath = path.resolve(__dirname, '../services/care-lifecycle-scheduler.js');
    const flagsPath = path.resolve(__dirname, '../services/care-lifecycle/flags.js');
    delete require.cache[schedPath];
    delete require.cache[flagsPath];
    delete require.cache[path.resolve(__dirname, '../services/care-lifecycle/index.js')];
    return require('../services/care-lifecycle-scheduler');
  }

  // 1. Defaults: scheduler off
  try {
    await withEnv(
      {
        CARE_LIFECYCLE_SCHEDULER_ENABLED: undefined,
        CARE_LIFECYCLE_ENABLED: undefined,
        CARE_LIFECYCLE_SEND: undefined
      },
      async () => {
        const sched = loadScheduler();
        sched.stopCareLifecycleScheduler();
        const status = sched.startCareLifecycleScheduler();
        assert.strictEqual(status.schedulerEnabled, false);
        assert.strictEqual(status.active, false);
        assert.strictEqual(status.wouldRun, false);
        assert.strictEqual(status.send, false);
        assert.strictEqual(status.modeWhenActive, 'dry-run');
      }
    );
    ok('1. defaults — scheduler OFF, no interval');
  } catch (e) {
    fail('1. defaults — scheduler OFF, no interval', e);
  }

  // 2. SCHEDULER on but ENABLED off → no interval
  try {
    await withEnv(
      {
        CARE_LIFECYCLE_SCHEDULER_ENABLED: 'true',
        CARE_LIFECYCLE_ENABLED: 'false',
        CARE_LIFECYCLE_SEND: 'false'
      },
      async () => {
        const sched = loadScheduler();
        sched.stopCareLifecycleScheduler();
        const status = sched.startCareLifecycleScheduler();
        assert.strictEqual(status.schedulerEnabled, true);
        assert.strictEqual(status.lifecycleEnabled, false);
        assert.strictEqual(status.active, false);
        assert.strictEqual(status.wouldRun, false);
      }
    );
    ok('2. SCHEDULER on + ENABLED off → no interval');
  } catch (e) {
    fail('2. SCHEDULER on + ENABLED off → no interval', e);
  }

  // 3. Scheduled run with SEND false uses dry-run and does not call LINE
  try {
    await withEnv(
      {
        CARE_LIFECYCLE_SCHEDULER_ENABLED: 'true',
        CARE_LIFECYCLE_ENABLED: 'true',
        CARE_LIFECYCLE_SEND: 'false'
      },
      async () => {
        const sched = loadScheduler();
        sched.stopCareLifecycleScheduler();
        let lineCalls = 0;
        const fixtureJob = {
          notionId: 'notion-care-sched-1',
          id: 'CASE-SCHED-1',
          customer: { id: null },
          notification: {
            status: 'SENT',
            resultSentAt: '2020-01-01T00:00:00.000Z'
          },
          line: { userId: 'U_test_sched', consentLine: true },
          workflow: {
            serviceCompletedAt: '2020-01-01T00:00:00.000Z'
          }
        };
        const result = await sched.runCareLifecycleScheduled('test', {
          flags: { enabled: true, send: false, outcomeTracking: false, outcomeReport: false },
          runOptions: {
            jobs: [fixtureJob],
            allowDisabledDryRun: true,
            dir: path.join(__dirname, '../tmp/care-lifecycle-scheduler-test'),
            deps: {
              sendLinePush: async () => {
                lineCalls += 1;
                return { ok: true, status: 'should_not_run', messageId: 'x' };
              }
            }
          }
        });
        assert.ok(result);
        assert.strictEqual(result.mode, 'dry-run');
        assert.strictEqual(lineCalls, 0);
        assert.ok(result.counts.dryRun >= 1 || result.counts.skipped >= 1);
      }
    );
    ok('3. ENABLED+SEND false → dry-run, no LINE');
  } catch (e) {
    fail('3. ENABLED+SEND false → dry-run, no LINE', e);
  }

  // 4. Interval parsing
  try {
    await withEnv({ CARE_LIFECYCLE_SCAN_INTERVAL_HOURS: '12' }, () => {
      const sched = loadScheduler();
      assert.strictEqual(sched.getIntervalMs(), 12 * 60 * 60 * 1000);
    });
    ok('4. SCAN_INTERVAL_HOURS parsed');
  } catch (e) {
    fail('4. SCAN_INTERVAL_HOURS parsed', e);
  }

  // 5. ops health meta includes careLifecycle when required
  try {
    const ops = require('../api/ops-routes');
    const health = ops.buildHealthPayload();
    assert.ok(health.careLifecycle);
    assert.strictEqual(typeof health.careLifecycle.enabled, 'boolean');
    assert.strictEqual(typeof health.careLifecycle.send, 'boolean');
    assert.ok(health.careLifecycle.scheduler);
    assert.strictEqual(typeof health.careLifecycle.scheduler.schedulerEnabled, 'boolean');
    ok('5. /api/ops/health careLifecycle meta present');
  } catch (e) {
    fail('5. /api/ops/health careLifecycle meta present', e);
  }

  console.log(`\n${passed}/5 passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
