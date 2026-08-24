/**
 * Regression suite for BUG-03: notification storage retention
 * (src/js/notifications/repository.js).
 *
 * Real bug: nothing ever capped how many notifications accumulated in
 * localStorage ('wm-operator-notifications-v1') -- the same unbounded-
 * growth pattern already observed to actually hit localStorage's quota for
 * 'wm-jobs' in production this session (a live QuotaExceededError).
 *
 * Fix: MemoryNotificationRepository._applyRetention() combines a count cap
 * (200) and an age cutoff (30 days) -- but ONLY against READ notifications.
 * An unread notification is never removed by either rule.
 *
 * Run: node scripts/test-notification-retention.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function makeLocalStorage(opts = {}) {
  const data = new Map();
  const quotaBytes = opts.quotaBytes ?? Infinity;
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      const str = String(v);
      if (str.length > quotaBytes) {
        const err = new Error("Failed to execute 'setItem' on 'Storage': Setting the value exceeded the quota.");
        err.name = 'QuotaExceededError';
        throw err;
      }
      data.set(k, str);
    },
    removeItem: (k) => { data.delete(k); },
    __size: () => (data.get('wm-operator-notifications-v1') || '').length
  };
}

function buildContext(localStorage) {
  const sandbox = { console, window: {}, localStorage };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join('D:/Service Portal', 'src/js/notifications/repository.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'repository.js' });
  return sandbox;
}

function makeNotification({ id, read = false, ageMs = 0, now = Date.now() }) {
  return {
    id,
    type: 'NEW_CASE',
    priority: 'INFO',
    action: 'OPEN_CASE',
    title: 'New case',
    message: `msg-${id}`,
    caseId: `case-${id}`,
    customerName: `Customer ${id}`,
    createdAt: now - ageMs,
    read,
    readAt: read ? now - ageMs : null,
    dedupeKey: `dedupe-${id}`,
    payload: {}
  };
}

async function main() {
  // --- Case: exceeding MAX_NOTIFICATIONS trims the oldest READ items ---
  {
    const sandbox = buildContext(makeLocalStorage());
    const repo = new sandbox.OperatorNotificationRepository.LocalStorageNotificationRepository();
    const now = Date.now();
    // 205 read notifications, oldest first (id 0 is oldest).
    for (let i = 0; i < 205; i++) {
      await repo.save(makeNotification({ id: i, read: true, ageMs: (205 - i) * 1000, now }));
    }
    const all = await repo.list();
    assert(all.length === 200, `over-cap read notifications are trimmed down to 200 (got ${all.length})`);
    assert(!all.some(n => n.id === 0), 'the OLDEST read notification (id 0) was the one dropped, not an arbitrary one');
    assert(all.some(n => n.id === 204), 'the newest notification survives the trim');
  }

  // --- Case: old (>30 days) READ notifications are cleaned up ---
  {
    const sandbox = buildContext(makeLocalStorage());
    const repo = new sandbox.OperatorNotificationRepository.LocalStorageNotificationRepository();
    const now = Date.now();
    const THIRTY_ONE_DAYS = 31 * 24 * 60 * 60 * 1000;
    await repo.save(makeNotification({ id: 'old-read', read: true, ageMs: THIRTY_ONE_DAYS, now }));
    await repo.save(makeNotification({ id: 'fresh-read', read: true, ageMs: 1000, now }));
    const all = await repo.list();
    assert(!all.some(n => n.id === 'old-read'), 'a read notification older than 30 days is cleaned up');
    assert(all.some(n => n.id === 'fresh-read'), 'a recent read notification is kept');
  }

  // --- Case: UNREAD notifications are never removed by age, no matter how old ---
  {
    const sandbox = buildContext(makeLocalStorage());
    const repo = new sandbox.OperatorNotificationRepository.LocalStorageNotificationRepository();
    const now = Date.now();
    const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
    await repo.save(makeNotification({ id: 'ancient-unread', read: false, ageMs: ONE_YEAR, now }));
    const all = await repo.list();
    assert(all.some(n => n.id === 'ancient-unread'), 'an unread notification is never removed by the age cutoff, even a year old');
  }

  // --- Case: UNREAD notifications are never removed by the count cap either ---
  {
    const sandbox = buildContext(makeLocalStorage());
    const repo = new sandbox.OperatorNotificationRepository.LocalStorageNotificationRepository();
    const now = Date.now();
    for (let i = 0; i < 210; i++) {
      await repo.save(makeNotification({ id: `unread-${i}`, read: false, ageMs: (210 - i) * 1000, now }));
    }
    const all = await repo.list();
    assert(all.length === 210, `210 unread notifications all survive the 200 cap rather than being silently deleted (got ${all.length})`);
  }

  // --- Case: mix of read+unread over the cap -- only read ones get trimmed ---
  {
    const sandbox = buildContext(makeLocalStorage());
    const repo = new sandbox.OperatorNotificationRepository.LocalStorageNotificationRepository();
    const now = Date.now();
    for (let i = 0; i < 150; i++) {
      await repo.save(makeNotification({ id: `read-${i}`, read: true, ageMs: (300 - i) * 1000, now }));
    }
    for (let i = 0; i < 100; i++) {
      await repo.save(makeNotification({ id: `unread-${i}`, read: false, ageMs: (150 - i) * 1000, now }));
    }
    const all = await repo.list();
    const unreadCount = all.filter(n => !n.read).length;
    const readCount = all.filter(n => n.read).length;
    assert(unreadCount === 100, `all 100 unread notifications survive (got ${unreadCount})`);
    assert(all.length === 200, `total trimmed back to the 200 cap by removing read items only (got ${all.length}, ${readCount} read remaining)`);
  }

  // --- Case: persisting after cleanup succeeds (no leftover error state) ---
  {
    const sandbox = buildContext(makeLocalStorage());
    const repo = new sandbox.OperatorNotificationRepository.LocalStorageNotificationRepository();
    const now = Date.now();
    for (let i = 0; i < 205; i++) {
      await repo.save(makeNotification({ id: i, read: true, ageMs: (205 - i) * 1000, now }));
    }
    const raw = sandbox.localStorage.getItem('wm-operator-notifications-v1');
    const parsed = JSON.parse(raw);
    assert(Array.isArray(parsed) && parsed.length === 200, `persisted localStorage snapshot reflects the trimmed 200, not the untrimmed 205 (got ${parsed?.length})`);
  }

  // --- Case: localStorage quota failure does not crash the app ---
  {
    // Quota tiny enough that even a handful of notifications overflows it.
    const sandbox = buildContext(makeLocalStorage({ quotaBytes: 50 }));
    const repo = new sandbox.OperatorNotificationRepository.LocalStorageNotificationRepository();
    let threw = false;
    try {
      await repo.save(makeNotification({ id: 'x' }));
    } catch {
      threw = true;
    }
    assert(!threw, 'saving under a full/near-full localStorage quota does not throw -- the app keeps working');
    const inMemory = await repo.list();
    assert(inMemory.length === 1, 'the notification is still usable in memory even though the localStorage write silently failed');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  process.exit(1);
});
