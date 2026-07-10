#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const { createTestCase } = require('../services/case-creation-service');
const { resolveJob } = require('../services/workflow-service');
const { compactNotionId } = require('../services/notion/mapper');

async function main() {
  const a = await createTestCase({ fullName: 'ID Verify A' });
  const b = await createTestCase({ fullName: 'ID Verify B' });

  const idA = a.case?.id;
  const idB = b.case?.id;
  const notionA = a.case?.notionId;
  const notionB = b.case?.notionId;

  const errors = [];
  if (!idA || !idB) errors.push('missing id in create response');
  if (idA === idB) errors.push(`duplicate ids: ${idA}`);
  if (idA === 1001 || idB === 1001) errors.push('hardcoded 1001 still returned');
  if (idA !== compactNotionId(notionA)) errors.push(`id A does not match compact notion id: ${idA} vs ${compactNotionId(notionA)}`);
  if (idB !== compactNotionId(notionB)) errors.push(`id B does not match compact notion id`);

  const resolvedA = await resolveJob(idA);
  if (!resolvedA || resolvedA.notionId !== notionA) errors.push('resolveJob(id) failed');

  const jobs = await require('../services/notion/clients').getAllClients();
  const legacySample = jobs.find((job) => job.legacyNumericId === 1005);
  if (legacySample) {
    const resolvedLegacy = await resolveJob(String(legacySample.legacyNumericId));
    if (!resolvedLegacy || resolvedLegacy.notionId !== legacySample.notionId) {
      errors.push('resolveJob(legacyNumericId) failed for existing case 1005');
    }
  }

  console.log(JSON.stringify({
    ok: errors.length === 0,
    errors,
    caseA: { id: idA, notionId: notionA, legacyNumericId: a.case?.legacyNumericId || null, feedbackToken: a.tokens?.feedbackToken },
    caseB: { id: idB, notionId: notionB, legacyNumericId: b.case?.legacyNumericId || null, feedbackToken: b.tokens?.feedbackToken },
    preassessmentUrlA: `/?preassessment=${idA}`
  }, null, 2));

  if (errors.length) process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
