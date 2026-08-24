/**
 * Regression: tapping a Search-modal result card must open the Case.
 *
 * Found during the Final Audit pass for BUG-05 (see
 * scripts/test-notification-card-tap.js): the exact same root cause --
 * a bubble-phase document click listener whose target lives inside a
 * .modal-sheet that calls event.stopPropagation() on every click
 * (src/pages/partials/modals.html) -- also affects
 * setupDashboardClickDelegation() (src/js/flows/dashboard.js), which
 * handles clicks on #search-results (the Search modal's result list).
 * A bubble-phase listener on document never sees a click inside any modal
 * for the same reason notifications didn't: the ancestor's
 * stopPropagation() fires first.
 *
 * Fixed the same way: registered the listener in the capture phase.
 *
 * Uses the same real capture/bubble/stopPropagation event dispatcher as
 * test-notification-card-tap.js, loads the REAL dashboard.js via vm, and
 * dispatches a real click at a search-result card nested inside a
 * .modal-sheet ancestor that stops propagation.
 *
 * Run: node scripts/test-search-result-tap.js
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
        if (selector.includes('[') && selector.startsWith('.')) {
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

async function dispatchClick(target) {
  const chain = [];
  let cur = target;
  while (cur) { chain.push(cur); cur = cur.parentEl; }
  const fromRoot = chain.slice().reverse();

  let stopped = false;
  const event = {
    target,
    preventDefault() {},
    stopPropagation() { stopped = true; }
  };

  for (const node of fromRoot) {
    if (stopped) return;
    for (const fn of node._captureListeners) await fn(event);
  }
  for (const node of chain) {
    if (stopped) return;
    for (const fn of node._bubbleListeners) await fn(event);
    if (stopped) return;
    if (node._onclick) node._onclick(event);
  }
}

function buildContext() {
  const documentListeners = { capture: [], bubble: [] };
  const searchResultsEl = makeNode({ id: 'search-results', dataset: {} });
  const modalSheetEl = makeNode({
    classes: ['modal-sheet', 'center'],
    dataset: {},
    parent: null,
    onclick: (event) => event.stopPropagation() // mirrors modals.html exactly
  });
  searchResultsEl.parentEl = modalSheetEl;

  const documentNode = makeNode({ dataset: {} });
  documentNode.addEventListener = (type, handler, useCapture) => {
    if (type !== 'click') return;
    (useCapture ? documentListeners.capture : documentListeners.bubble).push(handler);
  };
  modalSheetEl.parentEl = documentNode;

  const opened = [];
  const domStub = {
    addEventListener: documentNode.addEventListener,
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => makeNode({})
  };
  const sandbox = {
    console,
    window: {},
    document: domStub,
    navigator: { userAgent: 'node' },
    showApptMenu: () => {},
    closeSearchModal: () => {},
    openJob: (jobId) => { opened.push(jobId); }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);

  const code = fs.readFileSync(path.join('D:/Service Portal', 'src/js/flows/dashboard.js'), 'utf8');
  // dashboard.js is a large file with many top-level dependencies; only the
  // click-delegation function under test needs to actually run here.
  const fnMatch = code.match(/function setupDashboardClickDelegation\(\)[\s\S]*?\r?\n {2}}, true\);\r?\n}\r?\n/);
  if (!fnMatch) throw new Error('setupDashboardClickDelegation() not found in dashboard.js -- test is out of sync with the real source');
  vm.runInContext(fnMatch[0] + '\nsetupDashboardClickDelegation();', sandbox, { filename: 'dashboard.js (delegation excerpt)' });

  documentNode._captureListeners = documentListeners.capture;
  documentNode._bubbleListeners = documentListeners.bubble;

  return { searchResultsEl, opened };
}

async function main() {
  const { searchResultsEl, opened } = buildContext();

  // Real markup shape: .modal-sheet (stops propagation) > #search-results > .appt-card
  const cardEl = makeNode({
    classes: ['appt-card'],
    dataset: { jobId: 'job-42' },
    parent: searchResultsEl
  });
  const nameEl = makeNode({ classes: [], dataset: {}, parent: cardEl });

  await dispatchClick(nameEl);

  assert(opened.length === 1, 'tapping a search-result card (inside .modal-sheet, which stops propagation) still opens the Case');
  if (opened.length === 1) {
    assert(opened[0] === 'job-42', `opened the correct job id (got ${opened[0]})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  process.exit(1);
});
