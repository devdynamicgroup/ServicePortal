'use strict';

/**
 * M9.2 Care outcome fixture tests.
 * Usage: node scripts/test-care-outcomes.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  mapDeliveryStatus,
  measureCareOutcome,
  findRebookCase,
  parseUtmFromUrl,
  buildCareOutcomeReport,
  getCareLifecycleFlags,
  createCareAuditEvent,
  recordCareAudit,
  RESPONSE_STATUS
} = require('../services/care-lifecycle');

function daysFrom(iso, days) {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000).toISOString();
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-care-out-'));

  await run('1. map audit sent → deliveryStatus sent', async () => {
    assert.strictEqual(mapDeliveryStatus('sent'), 'sent');
    assert.strictEqual(mapDeliveryStatus('failed'), 'failed');
  });

  await run('2. no later Case → no_response after 7d window', async () => {
    const sentAt = daysFrom(new Date().toISOString(), -10);
    const audit = createCareAuditEvent({
      id: 'care_a1',
      status: 'sent',
      sentAt,
      caseNotionId: 'notion-a',
      customerId: 'cust_1'
    });
    const outcome = measureCareOutcome(audit, {
      jobs: [],
      now: new Date()
    });
    assert.strictEqual(outcome.deliveryStatus, 'sent');
    assert.strictEqual(outcome.responseStatus, RESPONSE_STATUS.NO_RESPONSE);
    assert.strictEqual(outcome.rebookWithin30d, false);
  });

  await run('3. later Case same customerId within 30d → rebooked', async () => {
    const sentAt = daysFrom(new Date().toISOString(), -5);
    const audit = createCareAuditEvent({
      id: 'care_a2',
      status: 'sent',
      sentAt,
      caseNotionId: 'notion-a',
      customerId: 'cust_1'
    });
    const jobs = [
      {
        notionId: 'notion-a',
        customer: { id: 'cust_1' },
        line: { userId: 'U_LINE_A' },
        createdTime: daysFrom(sentAt, -100)
      },
      {
        notionId: 'notion-b',
        customer: { id: 'cust_1' },
        line: { userId: 'U_LINE_A' },
        createdTime: daysFrom(sentAt, 3)
      }
    ];
    const outcome = measureCareOutcome(audit, {
      jobs,
      sourceLineUserId: 'U_LINE_A',
      now: new Date()
    });
    assert.strictEqual(outcome.responseStatus, RESPONSE_STATUS.REBOOKED);
    assert.strictEqual(outcome.rebookWithin30d, true);
    assert.strictEqual(outcome.linkedCaseIdAfter, 'notion-b');
  });

  await run('4. name-only Case must not attribute', async () => {
    const sentAt = daysFrom(new Date().toISOString(), -5);
    const audit = createCareAuditEvent({
      id: 'care_a3',
      status: 'sent',
      sentAt,
      caseNotionId: 'notion-a',
      customerId: 'cust_1'
    });
    const jobs = [
      {
        notionId: 'notion-c',
        name: 'Same Person',
        customer: { id: '' },
        line: { userId: '' },
        createdTime: daysFrom(sentAt, 2)
      }
    ];
    const found = findRebookCase(audit, jobs, { sourceLineUserId: 'U_X' });
    assert.strictEqual(found, null);
  });

  await run('5. flags default OFF; SEND false', async () => {
    const flags = getCareLifecycleFlags();
    assert.strictEqual(flags.send, false);
    assert.strictEqual(flags.outcomeTracking, false);
    assert.strictEqual(flags.outcomeReport, false);
  });

  await run('6. report CLI helpers do not need LINE send', async () => {
    await recordCareAudit(createCareAuditEvent({
      id: 'care_r1',
      status: 'dry_run',
      caseNotionId: 'n1'
    }), { dir: tmpDir, writeNotion: false });
    const report = buildCareOutcomeReport({ dir: tmpDir, jobs: [] });
    assert.ok(report.delivery.dry_run >= 1);
    assert.ok(report.note.includes('Read-only'));
  });

  await run('7. UTM parse', async () => {
    const utm = parseUtmFromUrl(
      'https://www.water-motion.co/book?utm_source=care&utm_campaign=reinspection_6mo&care_audit_id=care_x'
    );
    assert.strictEqual(utm.utmSource, 'care');
    assert.strictEqual(utm.careAuditIdFromUtm, 'care_x');
  });

  await run('8. Case notification fields not part of outcome write API', async () => {
    const audit = createCareAuditEvent({ status: 'sent', sentAt: new Date().toISOString() });
    assert.strictEqual(audit.notificationStatus, undefined);
    const outcome = measureCareOutcome(audit, { jobs: [] });
    assert.ok(!('notificationStatus' in outcome));
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
