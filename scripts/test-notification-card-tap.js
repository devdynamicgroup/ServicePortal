/**
 * Regression: tapping a notification (card OR its small action button) must
 * actually navigate — user report: "อยากให้แจ้งเตือนมันกดดูได้ด้วยอ่ะ ตอนนี้
 * มันโชว์เฉยๆ" (want the notification to be tappable — right now it just
 * displays with no response), and a follow-up "กดแล้วยังไม่ไปอ่ะ" (still
 * doesn't navigate) after an initial fix.
 *
 * Two real, separate bugs found here, both only visible under REAL DOM event
 * dispatch (capture -> target -> bubble), which earlier tests never modeled:
 *
 * 1. Clicking the card body only ever called markRead(), never navigated —
 *    fixed by also calling handleNotificationAction() for a card tap.
 * 2. Deeper, pre-existing bug: the notification click listener was bound on
 *    `document` in the BUBBLE phase, but `.notif-sheet` (an ancestor of
 *    every notification row) calls event.stopPropagation() on every click
 *    (src/pages/partials/modals.html) so tapping inside the modal doesn't
 *    also trigger the overlay's own backdrop-click-to-close. That
 *    stopPropagation() happens during the bubble phase BEFORE the event
 *    would reach `document`, so the bubble-phase listener never fired for
 *    ANY click inside the notification modal -- not the card, not even the
 *    small action button. Fixed by registering the document listener in the
 *    CAPTURE phase instead, which runs top-down before that
 *    stopPropagation() call has a chance to block anything.
 *
 * This test builds a minimal but REAL capture/bubble/stopPropagation event
 * dispatcher (not just "call the handler directly") specifically so it can
 * reproduce bug #2, and loads the actual notification-center.js via vm.
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

// A small DOM stand-in with real parent-chain click dispatch: capture phase
// top-down, then bubble phase bottom-up, honoring stopPropagation() exactly
// like a real browser -- the one behavior this whole bug hinged on.
function makeNode({ id = null, classes = [], dataset = {}, parent = null, onclick = null } = {}) {
  const node = {
    id,
    classList: { contains: (c) => classes.includes(c) },
    dataset,
    parentEl: parent,
    _captureListeners: [],
    _bubbleListeners: [],
    _onclick: onclick,
    addEventListener(type, handler, useCapture) {
      if (type !== 'click') return;
      (useCapture ? node._captureListeners : node._bubbleListeners).push(handler);
    },
    closest(selector) {
      let cur = node;
      while (cur) {
        if (selector.startsWith('[') && selector.endsWith(']')) {
          const key = attrToKey(selector.slice(1, -1));
          if (cur.dataset && cur.dataset[key] !== undefined) return cur;
        } else if (selector.includes('[')) {
          const [clsPart, attrPart] = selector.split('[');
          const wantClass = clsPart.replace('.', '');
          const key = attrToKey(attrPart.replace(']', ''));
          if (cur.classList.contains(wantClass) && cur.dataset && cur.dataset[key] !== undefined) return cur;
        } else if (selector.startsWith('.')) {
          if (cur.classList.contains(selector.slice(1))) return cur;
        } else if (selector.startsWith('#')) {
          if (cur.id === selector.slice(1)) return cur;
        }
        cur = cur.parentEl;
      }
      return null;
    }
  };
  return node;
}
function attrToKey(attr) {
  return attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Real capture -> bubble dispatch with stopPropagation support.
async function dispatchClick(target) {
  const chain = [];
  let cur = target;
  while (cur) { chain.push(cur); cur = cur.parentEl; }
  const fromRoot = chain.slice().reverse(); // document-ish root ... target

  let stopped = false;
  const event = {
    target,
    preventDefault() {},
    stopPropagation() { stopped = true; }
  };

  // Capture phase: root -> target
  for (const node of fromRoot) {
    if (stopped) return;
    for (const fn of node._captureListeners) await fn(event);
  }
  // Bubble phase: target -> root, including each node's own inline "onclick"
  for (const node of chain) {
    if (stopped) return;
    for (const fn of node._bubbleListeners) await fn(event);
    if (stopped) return;
    if (node._onclick) node._onclick(event);
  }
}

function buildContext() {
  const documentListeners = { capture: [], bubble: [] };
  const notifListEl = makeNode({ id: 'notif-list', dataset: {} });
  const notifSheetEl = makeNode({
    classes: ['modal-sheet', 'notif-sheet'],
    dataset: {},
    parent: null,
    onclick: (event) => event.stopPropagation() // mirrors modals.html exactly
  });
  notifListEl.parentEl = notifSheetEl;

  const documentNode = makeNode({ dataset: {} });
  documentNode.addEventListener = (type, handler, useCapture) => {
    if (type !== 'click') return;
    (useCapture ? documentListeners.capture : documentListeners.bubble).push(handler);
  };
  notifSheetEl.parentEl = documentNode;

  const domStub = {
    addEventListener: documentNode.addEventListener,
    getElementById: (id) => (id === 'notif-list' ? notifListEl : null),
    querySelectorAll: () => [],
    createElement: () => makeNode({})
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

  const code = fs.readFileSync(path.join('D:/Service Portal', 'src/js/notifications/components/notification-center.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'notification-center.js' });
  sandbox.initOperatorNotificationCenter();

  // Real DOM dispatch now routes through documentNode's registered listeners
  // via the capture/bubble arrays exactly as addEventListener recorded them.
  documentNode._captureListeners = documentListeners.capture;
  documentNode._bubbleListeners = documentListeners.bubble;

  return { notifListEl, notifSheetEl, marked, navigated };
}

async function main() {
  const { notifListEl, notifSheetEl, navigated } = buildContext();

  // Real markup shape: .notif-sheet > #notif-list > .notif-item > (message text)
  const cardEl = makeNode({
    classes: ['notif-item'],
    dataset: { notifId: 'n1' },
    parent: notifListEl
  });
  const innerSpan = makeNode({ classes: [], dataset: {}, parent: cardEl });

  await dispatchClick(innerSpan);

  assert(navigated.length === 1, 'tapping the card body (inside .notif-sheet, which stops propagation) still navigated');
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
