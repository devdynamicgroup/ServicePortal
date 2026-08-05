'use strict';

/**
 * M9.4 Care production readiness package fixture tests.
 * Usage: node scripts/test-care-production-readiness.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { getCareLifecycleFlags } = require('../services/care-lifecycle');
const {
  analyzeProductionReadiness,
  FAIL_PAUSE_RATE
} = require('./check-care-production-readiness');

const ROOT = path.join(__dirname, '..');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL  ${name}: ${error.message}`);
    return false;
  }
}

function main() {
  let passed = 0;
  let total = 0;
  function run(name, fn) {
    total += 1;
    if (test(name, fn)) passed += 1;
  }

  const docs = [
    'M9.4_CARE_PRODUCTION_RUNBOOK.md',
    'M9.4_CARE_GO_NO_GO_CHECKLIST.md',
    'M9.4_CARE_FIRST_SEND_PLAN.md',
    'M9.4_CARE_ROLLBACK_CARD.md'
  ].map((f) => path.join(ROOT, 'docs', f));

  const script = path.join(ROOT, 'scripts', 'check-care-production-readiness.js');

  run('1. Production rollout docs exist end-to-end', () => {
    for (const p of docs) {
      assert.ok(fs.existsSync(p), `missing ${p}`);
    }
    const runbook = fs.readFileSync(docs[0], 'utf8');
    assert.ok(runbook.includes('limit=10') || runbook.includes('--limit=10'));
    assert.ok(runbook.includes('Checkpoint A') || runbook.includes('Checkpoint'));
    assert.ok(/steady/i.test(runbook));
  });

  run('2. Rollback is flag-only', () => {
    const card = fs.readFileSync(docs[3], 'utf8');
    assert.ok(card.includes('CARE_LIFECYCLE_SEND=false'));
    assert.ok(card.includes('CARE_LIFECYCLE_ENABLED=false'));
    assert.ok(/Do not|do \*\*not\*\*|non-actions/i.test(card));
    assert.ok(card.includes('notificationStatus') || card.includes('Case'));
  });

  run('3. First-send plan has observe windows + fail-pause', () => {
    const plan = fs.readFileSync(docs[2], 'utf8');
    assert.ok(plan.includes('24'));
    assert.ok(plan.includes('48'));
    assert.ok(plan.includes('0.20') || plan.includes('20%'));
    assert.ok(plan.includes('reinspection_6mo'));
  });

  run('4. CARE flags default OFF; SEND false', () => {
    const flags = getCareLifecycleFlags();
    assert.strictEqual(flags.send, false);
    assert.strictEqual(flags.enabled, false);
    assert.strictEqual(flags.outcomeTracking, false);
    assert.strictEqual(flags.outcomeReport, false);
  });

  run('5. Readiness script is read-only advisory', () => {
    assert.ok(fs.existsSync(script));
    const src = fs.readFileSync(script, 'utf8');
    assert.ok(src.includes('readOnly') || src.includes('Read-only'));
    assert.ok(!src.includes('CARE_LIFECYCLE_SEND=true'));
    assert.ok(!src.includes('writeFileSync'));
    assert.ok(!src.includes('pushMessage'));
    assert.ok(!/notificationStatus\s*=/.test(src));
    assert.ok(!src.includes('care-lifecycle/sender'));
  });

  run('6. analyzeProductionReadiness never mutates inputs / detects fail-pause', () => {
    const latest = { counts: { sent: 8, failed: 3, skipped: 0, dryRun: 0 } };
    const freeze = JSON.stringify(latest);
    const result = analyzeProductionReadiness({
      flags: { enabled: false, send: false, outcomeTracking: false, outcomeReport: false },
      latest,
      outcome: null
    });
    assert.strictEqual(result.readOnly, true);
    assert.strictEqual(result.locks.neverAutoSetSend, true);
    assert.strictEqual(result.failPauseTriggered, true);
    assert.strictEqual(result.locks.failPauseRate, FAIL_PAUSE_RATE);
    assert.strictEqual(JSON.stringify(latest), freeze);
  });

  run('7. Checklist requires Checkpoint A triple sign-off', () => {
    const text = fs.readFileSync(docs[1], 'utf8');
    assert.ok(text.includes('Operator'));
    assert.ok(text.includes('Reviewer'));
    assert.ok(text.includes('On-call'));
    assert.ok(text.includes('Checkpoint A'));
  });

  run('8. No Case/Customer ownership change in package docs', () => {
    const runbook = fs.readFileSync(docs[0], 'utf8');
    assert.ok(runbook.includes('independent') || runbook.includes('Case result-send'));
    assert.ok(!runbook.includes('Customer becomes ops SSOT'));
  });

  console.log(`\n${passed}/${total} passed`);
  if (passed !== total) process.exitCode = 1;
}

main();
