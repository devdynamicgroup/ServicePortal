'use strict';

const assert = require('assert');
const {
  listOpsAlertTargets,
  buildOpsCaseAlertText,
  notifyAdminsOfNewCase,
  setOpsCaseAlertDependencies,
  resetOpsCaseAlertDependencies
} = require('../../services/ops-case-alert');
const {
  processBookingCreated,
  setCalBookingAdapterDependencies,
  resetCalBookingAdapterDependencies
} = require('../../services/cal-booking-adapter');
const { handleLineEvent } = require('../../api/line-routes');
const { isPlaceholderCaseName } = require('../../services/case-creation-service');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok  ${name}`); }
function fail(name, detail) { failed += 1; console.error(`  FAIL  ${name}: ${detail}`); }

function sampleJob() {
  return {
    id: 'case123',
    notionId: 'notion-1',
    name: 'Ann A.',
    addr: 'Address to confirm',
    date: '2026-10-22',
    timeStart: '09:00',
    timeEnd: '10:00',
    draft: {
      fields: {
        'ci-fname': 'Ann',
        'ci-lname': 'Ada',
        'ci-phone': '0812345678',
        'ci-addr': '12 Test Road',
        'ci-source': 'cal.com',
        'ci-line': 'ann.line'
      }
    },
    notification: { status: 'not_sent', lineMessageId: '' }
  };
}

async function run(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (error) {
    fail(name, error.message);
  }
}

(async () => {
  await run('no targets skips and does not send', async () => {
    const previous = process.env.OPS_ALERT_LINE_TO;
    delete process.env.OPS_ALERT_LINE_TO;
    let calls = 0;
    setOpsCaseAlertDependencies({
      sendLinePush: async () => { calls += 1; return { ok: true, status: 'sent' }; }
    });
    try {
      const result = await notifyAdminsOfNewCase(sampleJob());
      assert.strictEqual(result.skipped, true);
      assert.strictEqual(calls, 0);
      assert.deepStrictEqual(listOpsAlertTargets(''), []);
    } finally {
      if (previous === undefined) delete process.env.OPS_ALERT_LINE_TO;
      else process.env.OPS_ALERT_LINE_TO = previous;
      resetOpsCaseAlertDependencies();
    }
  });

  await run('message carries case facts and leaves notification status untouched', async () => {
    const job = sampleJob();
    const text = buildOpsCaseAlertText(job, { source: 'cal.com' });
    assert.ok(text.includes('WATER MOTION | NEW CASE'));
    assert.ok(text.includes('Ann Ada'));
    assert.ok(text.includes('0812345678'));
    assert.ok(text.includes('12 Test Road'));
    assert.ok(text.includes('2026-10-22'));
    assert.ok(text.includes('09:00'));
    assert.ok(!text.includes('ช่องทางที่มา'), 'channel/source field is removed from the message');
    assert.ok(text.includes('ann.line'));
    assert.ok(text.includes('หน้าเว็บ/ระบบจองคิว'));
    assert.strictEqual(job.notification.status, 'not_sent');
  });

  await run('created-from label distinguishes portal vs cal.com', async () => {
    const job = sampleJob();
    const portalText = buildOpsCaseAlertText(job, { source: 'portal' });
    const calText = buildOpsCaseAlertText(job, { source: 'cal.com' });
    const unknownText = buildOpsCaseAlertText(job, {});
    assert.ok(/สร้างจาก: \S+/.test(portalText), 'portal source shows a host, not blank');
    assert.ok(!portalText.includes('สร้างจาก: -'), 'portal source is not the blank fallback');
    assert.ok(calText.includes('หน้าเว็บ/ระบบจองคิว'));
    assert.ok(unknownText.includes('สร้างจาก: -'));
  });

  await run('sends once per configured target and survives a push failure', async () => {
    const previous = process.env.OPS_ALERT_LINE_TO;
    process.env.OPS_ALERT_LINE_TO = 'U_admin_a, U_admin_b';
    const sentTo = [];
    setOpsCaseAlertDependencies({
      sendLinePush: async (to) => {
        sentTo.push(to);
        if (to === 'U_admin_b') throw new Error('line down');
        return { ok: true, status: 'sent' };
      }
    });
    try {
      const job = sampleJob();
      const result = await notifyAdminsOfNewCase(job, { source: 'portal' });
      assert.deepStrictEqual(sentTo, ['U_admin_a', 'U_admin_b']);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.results[1].ok, false);
      assert.strictEqual(job.notification.status, 'not_sent');
      assert.strictEqual(job.notification.lineMessageId, '');
    } finally {
      if (previous === undefined) delete process.env.OPS_ALERT_LINE_TO;
      else process.env.OPS_ALERT_LINE_TO = previous;
      resetOpsCaseAlertDependencies();
    }
  });

  await run('a repeated Cal booking alerts once', async () => {
    const previous = process.env.OPS_ALERT_LINE_TO;
    process.env.OPS_ALERT_LINE_TO = 'U_self';
    const sent = [];
    const byBookingId = new Map();
    setOpsCaseAlertDependencies({
      sendLinePush: async (to, messages) => {
        sent.push({ to, text: messages[0].text });
        return { ok: true, status: 'sent' };
      }
    });
    setCalBookingAdapterDependencies({
      findClientByCalBookingId: async (id) => byBookingId.get(id) || null,
      createCase: async (payload) => {
        const job = {
          notionId: 'mem-1',
          id: 'mem-1',
          draft: { fields: { 'ci-fname': payload.fullName, 'ci-source': payload.source } }
        };
        byBookingId.set(payload.calBookingId, job);
        return { case: job };
      }
    });
    const payload = {
      triggerEvent: 'BOOKING_CREATED',
      payload: {
        uid: 'uid-ops',
        attendees: [{ name: 'Fern Test' }],
        startTime: '2026-10-22T02:00:00.000Z',
        endTime: '2026-10-22T03:00:00.000Z',
        eventTypeId: 1
      }
    };
    try {
      await processBookingCreated(payload, 'cid-1');
      await processBookingCreated(payload, 'cid-2');
      assert.strictEqual(sent.length, 1);
      assert.strictEqual(sent[0].to, 'U_self');
      assert.ok(sent[0].text.includes('Fern Test'));
    } finally {
      if (previous === undefined) delete process.env.OPS_ALERT_LINE_TO;
      else process.env.OPS_ALERT_LINE_TO = previous;
      resetOpsCaseAlertDependencies();
      resetCalBookingAdapterDependencies();
    }
  });

  await run('isPlaceholderCaseName recognizes the quick-create default and blanks', async () => {
    assert.strictEqual(isPlaceholderCaseName('New Client'), true);
    assert.strictEqual(isPlaceholderCaseName('New Client 3'), true);
    assert.strictEqual(isPlaceholderCaseName(''), true);
    assert.strictEqual(isPlaceholderCaseName(undefined), true);
    assert.strictEqual(isPlaceholderCaseName('   '), true);
    assert.strictEqual(isPlaceholderCaseName('Ann Ada'), false);
    assert.strictEqual(isPlaceholderCaseName('Newark Client'), false);
  });

  await run('group chat is ignored and not treated as a customer message', async () => {
    const result = await handleLineEvent({
      type: 'message',
      webhookEventId: 'ops-group-1',
      message: { type: 'text', text: 'จัดรถได้ไหม' },
      source: { type: 'group', groupId: 'C_admin_group', userId: 'U_admin' }
    });
    assert.strictEqual(result.action, 'ops_chat_ignored');
    assert.strictEqual(result.sourceType, 'group');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
