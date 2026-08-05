'use strict';

/**
 * M9.0 Care Lifecycle fixture tests.
 * Usage: node scripts/test-care-lifecycle.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  evaluateReinspection6mo,
  evaluateCarePlan,
  runCareLifecycle,
  getCareLifecycleFlags,
  CARE_EVENT_TYPES,
  CARE_AUDIT_STATUS,
  hasTerminalSend,
  DEFAULT_DIR
} = require('../services/care-lifecycle');

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function job(partial = {}) {
  return {
    notionId: partial.notionId || 'notion-care-1',
    id: partial.id || 'case-care-1',
    line: { userId: partial.lineUserId !== undefined ? partial.lineUserId : 'U_CARE_LINE_AAAA' },
    customer: { id: partial.customerId || '', pageId: '' },
    notification: {
      status: partial.notificationStatus || 'sent',
      resultSentAt: partial.resultSentAt !== undefined ? partial.resultSentAt : daysAgo(200)
    },
    workflow: {
      serviceCompletedAt: partial.serviceCompletedAt || null
    },
    ...partial
  };
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL  ${name}: ${error.message}`);
    return false;
  }
}

async function main() {
  let passed = 0;
  let total = 0;
  async function run(name, fn) {
    total += 1;
    if (await test(name, fn)) passed += 1;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-care-'));

  await run('1. flags default OFF', async () => {
    const flags = getCareLifecycleFlags();
    assert.strictEqual(flags.enabled, false);
    assert.strictEqual(flags.send, false);
  });

  await run('2. dry-run eligible Case — audit dry_run, no LINE, notification untouched', async () => {
    let lineCalls = 0;
    const j = job();
    const before = j.notification.status;
    const result = await runCareLifecycle({
      mode: 'dry-run',
      allowDisabledDryRun: true,
      dir: tmpDir,
      jobs: [j],
      flags: { enabled: true, send: false },
      deps: {
        sendLinePush: async () => {
          lineCalls += 1;
          return { ok: true, status: 'mock' };
        }
      }
    });
    assert.strictEqual(lineCalls, 0);
    assert.strictEqual(result.counts.dryRun, 1);
    assert.strictEqual(j.notification.status, before);
    assert.strictEqual(result.results[0].notificationStatusAfter, before);
  });

  await run('3. missing anchor → skipped', async () => {
    const el = evaluateReinspection6mo(job({
      resultSentAt: '',
      serviceCompletedAt: null,
      notification: { status: 'not_sent', resultSentAt: '' }
    }));
    assert.strictEqual(el.eligible, false);
    assert.strictEqual(el.reason, 'missing_anchor');
  });

  await run('4. duplicate idempotency — second send skipped', async () => {
    const dir = path.join(tmpDir, 'idemp');
    const j = job({ notionId: 'notion-idemp' });
    let lineCalls = 0;
    const sendDeps = {
      sendLinePush: async () => {
        lineCalls += 1;
        return { ok: true, status: 'mock_sent', messageId: 'm1' };
      }
    };
    await runCareLifecycle({
      mode: 'write',
      dir,
      jobs: [j],
      flags: { enabled: true, send: true },
      deps: sendDeps
    });
    assert.strictEqual(lineCalls, 1);
    assert.ok(hasTerminalSend(
      evaluateReinspection6mo(j).idempotencyKey,
      dir
    ));
    await runCareLifecycle({
      mode: 'write',
      dir,
      jobs: [j],
      flags: { enabled: true, send: true },
      deps: sendDeps
    });
    assert.strictEqual(lineCalls, 1, 'second run must not send again');
  });

  await run('5. SEND without ENABLED refused by runCareLifecycle', async () => {
    await assert.rejects(
      () => runCareLifecycle({
        mode: 'write',
        dir: tmpDir,
        jobs: [job()],
        flags: { enabled: false, send: true }
      }),
      /CARE_LIFECYCLE_ENABLED/
    );
  });

  await run('6. consentLine false → skipped', async () => {
    const plan = await evaluateCarePlan(job({ customerId: 'cust_no' }), {
      dir: tmpDir,
      deps: {
        findByCustomerId: async () => ({ customerId: 'cust_no', consentLine: false })
      }
    });
    assert.strictEqual(plan.status, CARE_AUDIT_STATUS.SKIPPED);
    assert.strictEqual(plan.reason, 'consent_line_false');
  });

  await run('7. READ_NOTIFY OFF → destination case_line', async () => {
    const plan = await evaluateCarePlan(job(), {
      dir: tmpDir,
      customerDomainFlags: {
        enabled: false,
        readNotify: false,
        readNotifyShadow: false,
        readLine: false,
        readLineShadow: false,
        dualWrite: false,
        mergeEnabled: false
      }
    });
    assert.strictEqual(plan.status, CARE_AUDIT_STATUS.PLANNED);
    assert.strictEqual(plan.destination.destinationType, 'case_line');
  });

  await run('8. care send does not change Case notificationStatus', async () => {
    const j = job({ notificationStatus: 'sent', notionId: 'notion-notif' });
    const before = j.notification.status;
    await runCareLifecycle({
      mode: 'write',
      dir: path.join(tmpDir, 'notif'),
      jobs: [j],
      flags: { enabled: true, send: true },
      deps: {
        sendLinePush: async () => ({ ok: true, status: 'mock_sent', messageId: 'x' })
      }
    });
    assert.strictEqual(j.notification.status, before);
  });

  await run('9. too_recent not eligible', async () => {
    const el = evaluateReinspection6mo(job({ resultSentAt: daysAgo(30) }), {
      reinspectionDays: 182
    });
    assert.strictEqual(el.eligible, false);
    assert.strictEqual(el.reason, 'too_recent');
  });

  await run('10. event type constant', async () => {
    assert.strictEqual(CARE_EVENT_TYPES.REINSPECTION_6MO, 'care.reinspection_6mo');
    assert.ok(DEFAULT_DIR.includes('care-lifecycle'));
  });

  console.log(`\n${passed}/${total} passed`);
  if (passed !== total) process.exitCode = 1;

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
