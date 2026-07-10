#!/usr/bin/env node
/**
 * Pre-commit verification for case creation workflow changes.
 * Run: node scripts/verify-case-creation.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const MODIFIED_FILES = [
  'api/case-flow-routes.js',
  'api/line-routes.js',
  'services/case-flow.js',
  'services/notion/clients.js',
  'services/workflow-service.js',
  'src/js/flows/job.js',
  'services/case-creation-service.js',
  'services/case-tokens.js',
  'scripts/create-test-case.js'
];

const REQUIRED_ROUTES = [
  { method: 'POST', path: '/api/cases', file: 'api/case-flow-routes.js' },
  { method: 'POST', path: '/api/test/create-case', file: 'api/case-flow-routes.js' },
  { method: 'POST', path: '/api/cases/:id/preassessment', file: 'api/case-flow-routes.js' },
  { method: 'POST', path: '/api/cases/:id/close', file: 'api/case-flow-routes.js' },
  { method: 'POST', path: '/api/cases/:id/send-result', file: 'api/case-flow-routes.js' }
];

const issues = [];
const passes = [];

function pass(msg) { passes.push(msg); }
function fail(msg) { issues.push(msg); }

function checkSyntax() {
  MODIFIED_FILES.forEach((rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      fail(`Syntax: missing file ${rel}`);
      return;
    }
    try {
      const src = fs.readFileSync(abs, 'utf8');
      // eslint-disable-next-line no-new-func
      new Function(src);
      pass(`Syntax OK: ${rel}`);
    } catch (error) {
      fail(`Syntax error in ${rel}: ${error.message}`);
    }
  });
}

function checkRouteRegistration() {
  const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  if (!serverSrc.includes('handleCaseFlowRoute')) {
    fail('server.js does not register handleCaseFlowRoute');
  } else {
    pass('server.js registers handleCaseFlowRoute');
  }

  const routesSrc = fs.readFileSync(path.join(ROOT, 'api/case-flow-routes.js'), 'utf8');
  REQUIRED_ROUTES.forEach((route) => {
    const needle = route.path.includes(':id')
      ? route.path.replace(':id', '[^/]+')
      : route.path;
    const pattern = route.path.includes(':id')
      ? new RegExp(route.path.replace(':id', '[^/]+'))
      : null;
    const found = pattern
      ? pattern.test(routesSrc) || routesSrc.includes(route.path.replace(':id', ''))
      : routesSrc.includes(`'${route.path}'`) || routesSrc.includes(`"${route.path}"`);
    if (!found && route.path === '/api/cases/:id/preassessment') {
      if (routesSrc.includes('/preassessment$')) pass(`Route handler present: ${route.method} ${route.path}`);
      else fail(`Route handler missing: ${route.method} ${route.path}`);
    } else if (!found && route.path.includes(':id')) {
      if (routesSrc.includes(route.path.split('/:id')[1])) pass(`Route handler present: ${route.method} ${route.path}`);
      else fail(`Route handler missing: ${route.method} ${route.path}`);
    } else if (found) {
      pass(`Route handler present: ${route.method} ${route.path}`);
    } else {
      fail(`Route handler missing: ${route.method} ${route.path}`);
    }
  });
}

function checkWorkflowNotificationExports() {
  const wf = require(path.join(ROOT, 'services/workflow-service'));
  const required = ['closeCase', 'sendCaseResult', 'repairCaseResultNotification', 'executeSendCaseResult'];
  required.forEach((name) => {
    if (name === 'executeSendCaseResult') {
      const src = fs.readFileSync(path.join(ROOT, 'services/workflow-service.js'), 'utf8');
      if (!src.includes('async function executeSendCaseResult')) {
        fail('workflow-service: executeSendCaseResult missing');
      } else {
        pass('workflow-service: executeSendCaseResult present');
      }
      return;
    }
    if (typeof wf[name] !== 'function') fail(`workflow-service export missing: ${name}`);
    else pass(`workflow-service export OK: ${name}`);
  });

  const src = fs.readFileSync(path.join(ROOT, 'services/workflow-service.js'), 'utf8');
  const notificationMarkers = [
    "notificationStatus: 'sending'",
    "notificationStatus: 'sent'",
    "notificationStatus: 'failed'",
    "notificationStatus: 'ready'",
    'sendCaseResultNotification',
    '[line_close_notify]'
  ];
  notificationMarkers.forEach((marker) => {
    if (!src.includes(marker)) fail(`workflow notification marker missing: ${marker}`);
    else pass(`workflow notification marker present: ${marker}`);
  });
}

async function checkLinkLineUserDisplayName() {
  const { linkLineUser } = require(path.join(ROOT, 'services/workflow-service'));
  if (linkLineUser.length < 3) {
    fail('linkLineUser should accept lineDisplayName as 3rd parameter');
    return;
  }
  pass('linkLineUser accepts lineDisplayName parameter');

  const lineRoutes = fs.readFileSync(path.join(ROOT, 'api/line-routes.js'), 'utf8');
  if (!lineRoutes.includes('fetchLineDisplayName')) fail('line-routes: fetchLineDisplayName missing');
  else pass('line-routes: fetchLineDisplayName present');
  if (!lineRoutes.includes('บัญชี LINE นี้เชื่อมกับข้อมูลการรับบริการเรียบร้อยแล้ว')) {
    fail('line-routes: Thai already-linked message missing');
  } else {
    pass('line-routes: Thai messages present');
  }
}

async function checkNotionCreateCase() {
  require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
  const { isNotionConfigured } = require(path.join(ROOT, 'services/notion/client'));
  if (!isNotionConfigured()) {
    pass('Notion createCase: skipped (NOTION not configured in .env)');
    return;
  }

  const { createTestCase } = require(path.join(ROOT, 'services/case-creation-service'));
  const { getClient } = require(path.join(ROOT, 'services/notion/clients'));
  const { feedbackTokenExists, reportTokenExists } = require(path.join(ROOT, 'services/case-tokens'));

  const suffix = Date.now().toString().slice(-6);
  let result;
  try {
    result = await createTestCase({
      fullName: `Verify Test ${suffix}`,
      email: `verify${suffix}@example.com`
    });
  } catch (error) {
    fail(`createTestCase threw: ${error.message}`);
    return;
  }

  if (!result?.ok) fail('createTestCase returned ok:false');
  else pass('createTestCase returned ok:true');

  const notionId = result.case?.notionId;
  if (!notionId) {
    fail('createTestCase: missing notionId in response');
    return;
  }
  pass(`createTestCase: notionId=${notionId}`);

  const fb = result.tokens?.feedbackToken;
  const rpt = result.tokens?.reportToken;
  if (!/^fb-[a-z0-9]{4}$/i.test(fb || '')) fail(`Invalid feedback token format: ${fb}`);
  else pass(`Feedback token format OK: ${fb}`);
  if (!/^rpt-[a-z0-9]{4}$/i.test(rpt || '')) fail(`Invalid report token format: ${rpt}`);
  else pass(`Report token format OK: ${rpt}`);

  let page;
  try {
    page = await getClient(notionId);
  } catch (error) {
    fail(`getClient after create failed: ${error.message}`);
    return;
  }
  if (!page) {
    fail('Notion page not found after create');
    return;
  }
  pass('Notion record retrievable after create');

  const checks = [
    ['feedback.token', page.feedback?.token, fb],
    ['result.publicReportToken', page.result?.publicReportToken, rpt],
    ['workflow.status', page.workflow?.status, 'scheduled'],
    ['notification.status', page.notification?.status, 'not_sent'],
    ['feedback.status', page.feedback?.status, 'not_sent'],
    ['review.status', page.review?.status, 'not_requested'],
    ['line.linked', page.line?.linked, false]
  ];
  checks.forEach(([label, actual, expected]) => {
    if (String(actual) !== String(expected)) {
      fail(`Notion field mismatch ${label}: expected ${expected}, got ${actual}`);
    } else {
      pass(`Notion field OK: ${label}=${actual}`);
    }
  });

  if (page.result?.reportUrl && !page.result.reportUrl.includes(rpt)) {
    fail(`Report URL does not contain token: ${page.result.reportUrl}`);
  } else if (page.result?.reportUrl) {
    pass(`Report URL OK: ${page.result.reportUrl}`);
  }

  const fbExists = await feedbackTokenExists(fb);
  const rptExists = await reportTokenExists(rpt);
  if (!fbExists) fail('feedbackTokenExists returned false for new token');
  else pass('feedbackTokenExists confirms token in Notion');
  if (!rptExists) fail('reportTokenExists returned false for new token');
  else pass('reportTokenExists confirms token in Notion');
}

async function main() {
  console.log('=== Case Creation Pre-Commit Verification ===\n');
  checkSyntax();
  checkRouteRegistration();
  checkWorkflowNotificationExports();
  await checkLinkLineUserDisplayName();
  await checkNotionCreateCase();

  console.log('\n--- PASSED ---');
  passes.forEach((p) => console.log(`  ✓ ${p}`));
  if (issues.length) {
    console.log('\n--- ISSUES ---');
    issues.forEach((i) => console.log(`  ✗ ${i}`));
    console.log(`\n${issues.length} issue(s), ${passes.length} pass(es)`);
    process.exit(1);
  }
  console.log(`\nAll ${passes.length} checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
