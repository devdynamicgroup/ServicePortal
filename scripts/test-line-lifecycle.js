#!/usr/bin/env node
'use strict';

/**
 * LINE lifecycle — contact identity, result resolver, Free/Paid templates.
 * No real LINE send. No Notion required (fixture deps).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  recordLineFollow,
  touchLineContact,
  findContactByLineUserId
} = require('../services/line-contacts');
const {
  getLatestAvailableResultByLineUserId,
  hasLinkedCasesByLineUserId,
  resolveResultType,
  RESULT_TYPES,
  WAITING_RESULT_MESSAGE
} = require('../services/line-result-resolver');
const {
  buildCaseResultFlexMessageForType
} = require('../services/line-notifications');

function extractBodyTexts(flex) {
  const body = flex?.contents?.body?.contents || [];
  const texts = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node.type === 'text' && node.text) texts.push(node.text);
      if (node.contents) walk(node.contents);
    }
  };
  walk(body);
  return texts.join('\n');
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-contacts-'));

  // —— 1. Identity: display name change still matches by userId ——
  try {
    recordLineFollow(
      { lineUserId: 'U_SAME', lineDisplayName: 'Old Name' },
      { dir: tmpDir, now: '2026-01-01T00:00:00.000Z' }
    );
    touchLineContact('U_SAME', { lineDisplayName: 'New Name' }, {
      dir: tmpDir,
      now: '2026-02-01T00:00:00.000Z'
    });
    const found = findContactByLineUserId('U_SAME', { dir: tmpDir });
    assert.ok(found);
    assert.strictEqual(found.lineUserId, 'U_SAME');
    assert.strictEqual(found.lineDisplayName, 'New Name');
    assert.strictEqual(found.followedAt, '2026-01-01T00:00:00.000Z');
    ok('1. display name changed → still matches by lineUserId');
  } catch (e) {
    fail('1. display name changed → still matches by lineUserId', e);
  }

  // —— 2. same display name, different userId → not matched ——
  try {
    recordLineFollow(
      { lineUserId: 'U_A', lineDisplayName: 'Same Person' },
      { dir: tmpDir }
    );
    recordLineFollow(
      { lineUserId: 'U_B', lineDisplayName: 'Same Person' },
      { dir: tmpDir }
    );
    const a = findContactByLineUserId('U_A', { dir: tmpDir });
    const b = findContactByLineUserId('U_B', { dir: tmpDir });
    const wrong = findContactByLineUserId('U_MISSING', { dir: tmpDir });
    assert.strictEqual(a.lineDisplayName, 'Same Person');
    assert.strictEqual(b.lineDisplayName, 'Same Person');
    assert.notStrictEqual(a.lineUserId, b.lineUserId);
    assert.strictEqual(wrong, null);
    ok('2. same display name different userId → separate contacts; no name match');
  } catch (e) {
    fail('2. same display name different userId → separate contacts; no name match', e);
  }

  // —— 3. Resolver: latest completed with report ——
  try {
    const jobs = [
      {
        id: 'old',
        line: { userId: 'U_R1' },
        campaignOffer: '',
        createdTime: '2025-01-01T00:00:00.000Z',
        workflow: { serviceCompletedAt: '2025-01-02T00:00:00.000Z' },
        result: { publicReportToken: 'tok-old', reportUrl: '', waterScore: 70 },
        notification: {}
      },
      {
        id: 'new',
        line: { userId: 'U_R1' },
        campaignOffer: 'Launch Offer 2026',
        createdTime: '2026-01-01T00:00:00.000Z',
        workflow: { serviceCompletedAt: '2026-06-01T00:00:00.000Z' },
        result: { publicReportToken: 'tok-new', reportUrl: '', waterScore: 88 },
        notification: { resultSentAt: '2026-06-02T00:00:00.000Z' }
      },
      {
        id: 'incomplete',
        line: { userId: 'U_R1' },
        campaignOffer: '',
        createdTime: '2026-07-01T00:00:00.000Z',
        workflow: {},
        result: { publicReportToken: '', reportUrl: '' },
        notification: {}
      }
    ];
    const latest = await getLatestAvailableResultByLineUserId('U_R1', { jobs });
    assert.strictEqual(latest.resultAvailable, true);
    assert.strictEqual(latest.case.id, 'new');
    assert.strictEqual(latest.resultType, RESULT_TYPES.FREE_WATER_CHECK);
    assert.ok(String(latest.resultUrl || '').includes('tok-new') || latest.resultUrl);
    ok('3. latest completed case with report returned; incomplete ignored');
  } catch (e) {
    fail('3. latest completed case with report returned; incomplete ignored', e);
  }

  // —— 4. no report → waiting (linked but unavailable) ——
  try {
    const jobs = [
      {
        id: 'pending',
        line: { userId: 'U_WAIT' },
        campaignOffer: '',
        result: { publicReportToken: '', reportUrl: '' },
        workflow: {},
        notification: {}
      }
    ];
    const latest = await getLatestAvailableResultByLineUserId('U_WAIT', { jobs });
    assert.strictEqual(latest.resultAvailable, false);
    assert.strictEqual(latest.resultUrl, '');
    const linked = await hasLinkedCasesByLineUserId('U_WAIT', { jobs });
    assert.strictEqual(linked, true);
    assert.ok(WAITING_RESULT_MESSAGE.includes('กำลังดำเนินการตรวจสอบและจัดทำผลตรวจครับ'));
    assert.ok(WAITING_RESULT_MESSAGE.includes('ระบบจะส่งแจ้งเตือนให้ทาง LINE อัตโนมัติ'));
    ok('4. no report → waiting message path');
  } catch (e) {
    fail('4. no report → waiting message path', e);
  }

  // —— 5. different userId with same name on Cases → not matched ——
  try {
    const jobs = [
      {
        id: 'other',
        name: 'Same Name',
        line: { userId: 'U_OTHER' },
        result: { publicReportToken: 'tok-x', reportUrl: '' },
        workflow: { serviceCompletedAt: '2026-01-01T00:00:00.000Z' },
        notification: {}
      }
    ];
    const latest = await getLatestAvailableResultByLineUserId('U_ASKER', { jobs });
    assert.strictEqual(latest.resultAvailable, false);
    assert.strictEqual(latest.case, null);
    ok('5. Case with same name different userId → not matched');
  } catch (e) {
    fail('5. Case with same name different userId → not matched', e);
  }

  // —— 6. Free vs Paid templates ——
  try {
    const freeType = resolveResultType({ campaignOffer: 'Launch Offer 2026' });
    const paidType = resolveResultType({ campaignOffer: '' });
    assert.strictEqual(freeType, RESULT_TYPES.FREE_WATER_CHECK);
    assert.strictEqual(paidType, RESULT_TYPES.PAID_ASSESSMENT);

    const freeFlex = buildCaseResultFlexMessageForType({
      resultLinkUrl: 'https://example.com/r',
      feedbackUrl: 'https://example.com/f',
      clientName: 'Test',
      waterScore: 80
    }, freeType);
    const paidFlex = buildCaseResultFlexMessageForType({
      resultLinkUrl: 'https://example.com/r',
      feedbackUrl: 'https://example.com/f',
      clientName: 'Test',
      waterScore: 80
    }, paidType);

    const freeBody = extractBodyTexts(freeFlex);
    const paidBody = extractBodyTexts(paidFlex);
    assert.ok(freeBody.includes('Free Water Check') || freeBody.includes('เบื้องต้น') || freeBody.includes('แพ็กเกจ') || freeBody.includes('ภาพสรุป'));
    assert.ok(paidBody.includes('รายละเอียดผลตรวจ') || paidBody.includes('Google'));
    assert.ok(!paidBody.includes('Free Water Check'));
    // Layer 3: Free must not expose /r even if caller passes a report URL.
    assert.ok(!freeFlex.contents?.footer, 'Free Complete push has no /r footer');
    assert.ok(!freeFlex.contents?.hero?.action, 'Free Complete push hero has no /r action');
    assert.ok(
      paidFlex.contents?.footer?.contents?.[0]?.action?.uri === 'https://example.com/r',
      'Paid keeps /r footer CTA'
    );
    ok('6. Free Water Check vs Paid Assessment message variants');
  } catch (e) {
    fail('6. Free Water Check vs Paid Assessment message variants', e);
  }

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  console.log(`\n${passed}/6 passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
