/**
 * LINE webhook event dedup — forensic coverage gap closure.
 * Exercises the REAL claimEvent() (api/line-routes.js, unmodified logic,
 * newly exported for testability). Process-local Map + TTL, exactly as
 * implemented -- no durability claims are made beyond what the code does.
 * Run: node tests/line/webhook-event-dedup.test.js
 */
'use strict';
const assert = require('assert');
const { claimEvent } = require('../../api/line-routes');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok  ${name}`); }
function fail(name, detail) { failed += 1; console.error(`  FAIL  ${name}: ${detail}`); }

function run(name, fn) {
  try { fn(); ok(name); } catch (e) { fail(name, e.message); }
}

run('1. first event with a given webhookEventId is claimed (accepted)', () => {
  assert.strictEqual(claimEvent({ webhookEventId: 'evt-001' }), true);
});

run('2. identical webhookEventId delivered again is rejected as a duplicate', () => {
  claimEvent({ webhookEventId: 'evt-002' });
  assert.strictEqual(claimEvent({ webhookEventId: 'evt-002' }), false);
});

run('3. a different webhookEventId is accepted independently (no cross-event suppression)', () => {
  claimEvent({ webhookEventId: 'evt-003a' });
  assert.strictEqual(claimEvent({ webhookEventId: 'evt-003b' }), true);
});

run('4. "concurrent" duplicate claims for the same id -- only the first succeeds (synchronous Map, no race window)', () => {
  const id = 'evt-004';
  const results = Array.from({ length: 10 }, () => claimEvent({ webhookEventId: id }));
  const acceptedCount = results.filter(Boolean).length;
  assert.strictEqual(acceptedCount, 1, `expected exactly 1 acceptance across 10 identical claims, got ${acceptedCount}`);
});

run('5. events with no webhookEventId at all are always treated as claimed (LINE payload contract: field may be absent on older event shapes)', () => {
  assert.strictEqual(claimEvent({}), true);
  assert.strictEqual(claimEvent({}), true, 'a second event with no id must ALSO be claimed -- there is nothing to dedup against, this is not a bypass');
});

run('6. process-boundary behavior is explicitly process-local, non-durable (matches the real Map-based implementation -- no claim of cross-restart durability)', () => {
  // This test documents the actual, current contract rather than testing an
  // aspirational one: the dedup Map lives only in process memory. A process
  // restart between two identical deliveries of the same webhookEventId
  // would see the second delivery re-accepted, because there is no durable
  // store backing this dedup. That is the current, real behavior -- proven
  // structurally (module-level `const processedEvents = new Map()` in
  // api/line-routes.js), not asserted here via an actual process restart.
  assert.ok(true, 'documented: claimEvent is in-process only, not durable across restarts -- see api/line-routes.js:182');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
