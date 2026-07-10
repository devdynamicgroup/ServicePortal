#!/usr/bin/env node
const { createTestCase } = require('../services/case-creation-service');

async function main() {
  const overrides = {};
  const nameArg = process.argv.find(arg => arg.startsWith('--name='));
  if (nameArg) overrides.fullName = nameArg.slice('--name='.length);

  const result = await createTestCase(overrides);
  console.log(JSON.stringify({
    ok: true,
    caseId: result.case?.id || null,
    notionId: result.case?.notionId || null,
    name: result.case?.name || null,
    feedbackToken: result.tokens?.feedbackToken || null,
    reportToken: result.tokens?.reportToken || null,
    reportUrl: result.tokens?.reportUrl || null,
    feedbackUrl: result.tokens?.feedbackUrl || null,
    workflow: result.case?.workflow || null,
    notification: result.case?.notification || null
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
