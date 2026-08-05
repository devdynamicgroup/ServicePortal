'use strict';

/**
 * M9.3 Care governance fixture tests.
 * Usage: node scripts/test-care-governance.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { getCareLifecycleFlags } = require('../services/care-lifecycle');
const { analyzeCarePatterns } = require('./check-care-patterns');

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

  const cdrDoc = path.join(ROOT, 'docs', 'M9.3_CARE_DECISION_RECORDS.md');
  const runbook = path.join(ROOT, 'docs', 'M9.3_POLICY_REVIEW_RUNBOOK.md');
  const effectiveness = path.join(ROOT, 'docs', 'M9.3_EFFECTIVENESS_GOVERNANCE.md');
  const patternScript = path.join(ROOT, 'scripts', 'check-care-patterns.js');
  const sender = path.join(ROOT, 'services', 'care-lifecycle', 'sender.js');

  run('1. CDR schema doc exists and is separate from CareAudit', () => {
    assert.ok(fs.existsSync(cdrDoc), 'CDR doc missing');
    const text = fs.readFileSync(cdrDoc, 'utf8');
    assert.ok(text.includes('never') || text.includes('Never') || text.includes('separate'), 'separation language');
    assert.ok(text.includes('events.jsonl') || text.includes('CareAuditEvent'), 'mentions audit boundary');
    assert.ok(text.includes('CDR-YYYYMMDD'), 'id schema');
    assert.ok(!cdrDoc.includes('events.jsonl'));
  });

  run('2. Review runbook + effectiveness governance exist', () => {
    assert.ok(fs.existsSync(runbook));
    assert.ok(fs.existsSync(effectiveness));
    const eff = fs.readFileSync(effectiveness, 'utf8');
    assert.ok(eff.includes('Human') || eff.includes('human'), 'human approval');
    assert.ok(eff.includes('auto-tuning') || eff.includes('ML'), 'forbids auto/ML');
    assert.ok(eff.includes('CARE_LIFECYCLE_SEND') || eff.includes('SEND'), 'SEND boundary');
  });

  run('3. CARE flags default OFF; SEND false', () => {
    const flags = getCareLifecycleFlags();
    assert.strictEqual(flags.send, false);
    assert.strictEqual(flags.enabled, false);
    assert.strictEqual(flags.outcomeTracking, false);
    assert.strictEqual(flags.outcomeReport, false);
  });

  run('4. Pattern scanner is read-only advisory', () => {
    assert.ok(fs.existsSync(patternScript));
    const src = fs.readFileSync(patternScript, 'utf8');
    assert.ok(src.includes('readOnly') || src.includes('Read-only'));
    assert.ok(!src.includes('CARE_LIFECYCLE_SEND=true'));
    assert.ok(!src.includes('writeFileSync') || src.includes('Never'));
    // No LINE send / notificationStatus writes
    assert.ok(!/notificationStatus\s*=/.test(src));
    assert.ok(!src.includes('pushMessage'));
    assert.ok(!src.includes("require('./sender"));
  });

  run('5. analyzeCarePatterns warns without mutating inputs', () => {
    const latest = { sent: 8, failed: 3, skipped: 1, dryRun: 0 };
    const freeze = JSON.stringify(latest);
    const result = analyzeCarePatterns({ latest, outcome: null });
    assert.strictEqual(result.readOnly, true);
    assert.ok(result.warningCount >= 1);
    assert.ok(result.warnings.some((w) => w.code === 'high_failed_share' || w.code === 'missing_outcome_report'));
    assert.strictEqual(JSON.stringify(latest), freeze, 'input must not be mutated');
  });

  run('6. No auto policy mutation API in governance scripts', () => {
    const gov = fs.readFileSync(patternScript, 'utf8');
    assert.ok(!gov.includes('process.env.CARE_REINSPECTION_DAYS='));
    assert.ok(!gov.includes('applyPolicy'));
    assert.ok(!gov.includes('autoTune'));
  });

  run('7. Care sender module unchanged by governance (exists; not required by scanner)', () => {
    assert.ok(fs.existsSync(sender));
    const scannerReq = fs.readFileSync(patternScript, 'utf8');
    assert.ok(!scannerReq.includes("care-lifecycle/sender"));
    assert.ok(!scannerReq.includes('require("./sender")'));
    assert.ok(!scannerReq.includes("services/notion/clients"));
  });

  run('8. Effectiveness doc forbids Case notification writes', () => {
    const text = fs.readFileSync(effectiveness, 'utf8');
    assert.ok(text.includes('notificationStatus') || text.includes('resultSentAt'));
    assert.ok(/Never|never|Forbidden/.test(text));
  });

  console.log(`\n${passed}/${total} passed`);
  if (passed !== total) process.exitCode = 1;
}

main();
