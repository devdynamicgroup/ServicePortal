'use strict';

/**
 * M9.5 Care steady-state governance fixture tests.
 * Usage: node scripts/test-care-steady-state.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { getCareLifecycleFlags } = require('../services/care-lifecycle');
const { analyzeSteadyState } = require('./check-care-steady-state');

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
    'M9.5_CARE_STEADY_STATE_HANDBOOK.md',
    'M9.5_CARE_METRICS_OWNERSHIP.md',
    'M9.5_CARE_CDR_OPERATIONS.md',
    'M9.5_CARE_INCIDENT_OPERATIONS.md'
  ].map((f) => path.join(ROOT, 'docs', f));

  const script = path.join(ROOT, 'scripts', 'check-care-steady-state.js');
  const careDir = path.join(ROOT, 'services', 'care-lifecycle');

  run('1. Handbook exists with ownership + review loop', () => {
    assert.ok(fs.existsSync(docs[0]));
    const text = fs.readFileSync(docs[0], 'utf8');
    assert.ok(text.includes('Case'));
    assert.ok(text.includes('Customer'));
    assert.ok(text.includes('Care'));
    assert.ok(/Monitor|monitor/.test(text));
    assert.ok(text.includes('CDR'));
    assert.ok(/never enables|Never enables|never enable/i.test(text));
  });

  run('2. Metrics ownership documented', () => {
    const text = fs.readFileSync(docs[1], 'utf8');
    assert.ok(text.includes('sent'));
    assert.ok(text.includes('failed'));
    assert.ok(text.includes('Operator'));
    assert.ok(text.includes('On-call') || text.includes('On-call'));
  });

  run('3. CDR process preserved (lifecycle + 7-day spacing)', () => {
    const text = fs.readFileSync(docs[2], 'utf8');
    assert.ok(text.includes('approved'));
    assert.ok(text.includes('7'));
    assert.ok(text.includes('M9.3') || text.includes('Care Decision'));
    assert.ok(/never.*auto-create|Never.*auto-create|must \*\*never\*\* auto/i.test(text));
    assert.ok(/Human approval is mandatory/i.test(text));
  });

  run('4. Incident rollback is flag-only', () => {
    const text = fs.readFileSync(docs[3], 'utf8');
    assert.ok(text.includes('CARE_LIFECYCLE_SEND=false'));
    assert.ok(text.includes('CARE_LIFECYCLE_ENABLED=false'));
    assert.ok(/flag-only|Flag-only/.test(text));
    assert.ok(text.includes('notificationStatus') || text.includes('Case'));
  });

  run('5. CARE flags default OFF; SEND false', () => {
    const flags = getCareLifecycleFlags();
    assert.strictEqual(flags.send, false);
    assert.strictEqual(flags.enabled, false);
    assert.strictEqual(flags.outcomeTracking, false);
    assert.strictEqual(flags.outcomeReport, false);
  });

  run('6. Steady-state script is read-only', () => {
    assert.ok(fs.existsSync(script));
    const src = fs.readFileSync(script, 'utf8');
    assert.ok(src.includes('readOnly') || src.includes('Read-only'));
    assert.ok(!src.includes('CARE_LIFECYCLE_SEND=true'));
    assert.ok(!src.includes('writeFileSync'));
    assert.ok(!src.includes('pushMessage'));
    assert.ok(!src.includes('care-lifecycle/sender'));
  });

  run('7. analyzeSteadyState does not mutate inputs', () => {
    const latest = { counts: { sent: 10, failed: 0 } };
    const freeze = JSON.stringify(latest);
    const result = analyzeSteadyState({
      flags: { enabled: false, send: false, outcomeTracking: false, outcomeReport: false },
      latest,
      outcome: null
    });
    assert.strictEqual(result.readOnly, true);
    assert.strictEqual(result.locks.neverAutoEnableSend, true);
    assert.strictEqual(result.locks.sameLeverMinDays, 7);
    assert.strictEqual(JSON.stringify(latest), freeze);
  });

  run('8. No Care runtime tree modified by this package (sender still present)', () => {
    assert.ok(fs.existsSync(path.join(careDir, 'sender.js')));
    assert.ok(fs.existsSync(path.join(careDir, 'eligibility.js')));
    // Package must not be required as a dependency of sender
    const sender = fs.readFileSync(path.join(careDir, 'sender.js'), 'utf8');
    assert.ok(!sender.includes('check-care-steady-state'));
  });

  console.log(`\n${passed}/${total} passed`);
  if (passed !== total) process.exitCode = 1;
}

main();
