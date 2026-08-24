/**
 * Exact-boundary regression suite for BUG-03 retention
 * (src/js/notifications/repository.js MAX_NOTIFICATIONS = 200), written
 * during a Release Gate audit. test-notification-retention.js already
 * covers the general behavior (205 vs cap, mixed read/unread); this file
 * checks the precise edges the Principal QA review specifically asked for:
 * 199 (under cap), 200 (exactly at cap), 201 (one over), and 1000 (far
 * over), each for all-read, all-unread, and mixed read/unread.
 *
 * Run: node scripts/test-notification-retention-boundary.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeLocalStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); }
  };
}
function buildContext() {
  const sandbox = { console, window: {}, localStorage: makeLocalStorage() };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join('D:/Service Portal', 'src/js/notifications/repository.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'repository.js' });
  return sandbox;
}
function notif(id, read, ageMs, now) {
  return { id, type: 'NEW_CASE', title: 't', message: 'm', createdAt: now - ageMs, read, readAt: read ? now - ageMs : null, dedupeKey: `d-${id}`, payload: {} };
}

let pass = 0, fail = 0;
function check(cond, msg) { if (cond) { pass++; console.log('  ok  ' + msg); } else { fail++; console.error('  FAIL  ' + msg); } }

async function boundaryTest(n, allRead) {
  const sb = buildContext();
  const repo = new sb.OperatorNotificationRepository.LocalStorageNotificationRepository();
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    await repo.save(notif(i, allRead, (n - i) * 1000, now));
  }
  const all = await repo.list();
  return all.length;
}

async function main() {
  check(await boundaryTest(199, true) === 199, '199 read items: no trim (under cap)');
  check(await boundaryTest(200, true) === 200, '200 read items: exactly at cap, no trim');
  check(await boundaryTest(201, true) === 200, '201 read items: trimmed to exactly 200');
  check(await boundaryTest(1000, true) === 200, '1000 read items: trimmed to exactly 200');
  check(await boundaryTest(1000, false) === 1000, '1000 UNREAD items: cap does not apply, all 1000 survive');

  // Mixed: 150 read (over some threshold) + 100 unread = 250 total, cap 200 -> only read gets trimmed to leave exactly 200 total
  {
    const sb = buildContext();
    const repo = new sb.OperatorNotificationRepository.LocalStorageNotificationRepository();
    const now = Date.now();
    for (let i = 0; i < 150; i++) await repo.save(notif(`r${i}`, true, (300 - i) * 1000, now));
    for (let i = 0; i < 100; i++) await repo.save(notif(`u${i}`, false, (150 - i) * 1000, now));
    const all = await repo.list();
    check(all.filter(x => !x.read).length === 100, 'mixed 150 read + 100 unread: all 100 unread survive');
    check(all.length === 200, `mixed: total trimmed to 200 (got ${all.length})`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
