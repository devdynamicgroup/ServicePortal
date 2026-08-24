/**
 * Regression: tapping a notification CARD (not just its small action button)
 * must trigger the same navigation as the button — user report: "อยากให้
 * แจ้งเตือนมันกดดูได้ด้วยอ่ะ ตอนนี้มันโชว์เฉยๆ" (want the notification itself
 * to be tappable — right now it just displays with no response).
 *
 * Before this fix, clicking anywhere on `.notif-item` that wasn't the small
 * `.notif-action-btn` only called markRead() — no navigation, no visible
 * effect, which reads as "broken" from a tap.
 *
 * Loads the REAL notification-center.js via vm with a minimal but functional
 * DOM stub (real addEventListener + closest()), and dispatches a real click
 * event at the card body to prove the actual wired behavior, not just the
 * helper function in isolation.
 *
 * Run: node scripts/test-notification-card-tap.js
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

// Minimal fake element supporting the one DOM API bindNotificationCenter
// actually needs: closest(selector) walking up a parent chain, plus dataset.
function makeEl({ classes = [], dataset = {}, parent = null } = {}) {
  const el = {
    classList: { contains: (c) => classes.includes(c) },
    dataset,
    parentEl: parent,
    closest(selector) {
      let node = el;
      while (node) {
        if (selector.startsWith('[') && selector.endsWith(']')) {
          const attr = selector.slice(1, -1);
          const key = attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          if (node.dataset && node.dataset[key] !== undefined) return node;
        } else if (selector.includes('[')) {
          const [cls, attrPart] = selector.split('[');
          const wantClass = cls.replace('.', '');
          const attr = attrPart.replace(']', '');
          const key = attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          if (node.classList.contains(wantClass) && node.dataset && node.dataset[key] !== undefined) return node;
        } else if (selector.startsWith('.')) {
          if (node.classList.contains(selector.slice(1))) return node;
        } else if (selector.startsWith('#')) {
          if (node.id === selector.slice(1)) return node;
        }
        node = node.parentEl;
      }
      return null;
    }
  };
  return el;
}

function buildContext() {
  let clickHandler = null;
  const notifListEl = makeEl({ dataset: {} });
  notifListEl.id = 'notif-list';

  const domStub = {
    addEventListener: (type, handler) => {
      if (type === 'click') clickHandler = handler;
    },
    getElementById: (id) => (id === 'notif-list' ? notifListEl : null),
    querySelectorAll: () => [],
    createElement: () => makeEl({})
  };

  const marked = [];
  const navigated = [];
  const sandbox = {
    console,
    window: {},
    document: domStub,
    navigator: { userAgent: 'node' },
    S: { lang: 'en' },
    JOBS: [{ id: 'job-1', notionId: 'case-1', date: '2026-08-20' }],
    OperatorNotificationTypes: {
      NOTIFICATION_ACTION: Object.freeze({
        OPEN_CASE: 'OPEN_CASE',
        OPEN_CASE_LIST: 'OPEN_CASE_LIST',
        RETRY_LINE: 'RETRY_LINE',
        VIEW_SCHEDULE: 'VIEW_SCHEDULE',
        NONE: 'NONE'
      })
    },
    OperatorNotificationStore: {
      getState: () => ({
        items: [
          { id: 'n1', caseId: 'case-1', action: 'OPEN_CASE', payload: {} }
        ]
      }),
      subscribe: () => {}
    },
    OperatorNotificationService: {
      markRead: async (id) => { marked.push(id); },
      list: async () => [],
      unreadCount: async () => 0
    },
    navigateToCalendarDate: (date, jobId) => { navigated.push({ date, jobId }); },
    goScreen: () => {},
    showToast: () => {}
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);

  const files = [
    'src/js/notifications/components/notification-center.js'
  ];
  for (const rel of files) {
    const code = fs.readFileSync(path.join('D:/Service Portal', rel), 'utf8');
    vm.runInContext(code, sandbox, { filename: rel });
  }

  sandbox.initOperatorNotificationCenter();
  return { sandbox, notifListEl, getClickHandler: () => clickHandler, marked, navigated };
}

async function main() {
  const { notifListEl, getClickHandler, marked, navigated } = buildContext();

  // Simulate a real DOM click landing on an inner span inside the card body
  // (not the action button) — this is what "tapping the notification" means
  // to a real user, since most of the card is message text, not the button.
  const cardEl = makeEl({
    classes: ['notif-item'],
    dataset: { notifId: 'n1' },
    parent: notifListEl
  });
  const innerSpan = makeEl({ classes: [], dataset: {}, parent: cardEl });

  const handler = getClickHandler();
  assert(typeof handler === 'function', 'click listener was registered on document');

  await handler({ target: innerSpan, preventDefault() {}, stopPropagation() {} });

  assert(navigated.length === 1, 'tapping the card body navigated (not just marked read silently)');
  if (navigated.length === 1) {
    assert(navigated[0].date === '2026-08-20', `navigated to the notification's case date (got ${navigated[0].date})`);
    assert(navigated[0].jobId === 'job-1', `navigated to the resolved job id (got ${navigated[0].jobId})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  process.exit(1);
});
