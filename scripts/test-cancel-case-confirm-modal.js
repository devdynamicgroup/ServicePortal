/**
 * Regression test for the custom "Cancel case?" confirm modal (2026-08-27),
 * replacing the browser's native confirm() dialog (couldn't be styled,
 * looked out of place next to the app's other custom modals).
 *
 * showCancelCaseConfirm()/resolveCancelCase() are extracted verbatim from
 * src/js/flows/dashboard.js via regex + vm (this file is a browser
 * <script>, not a CommonJS module -- matches this codebase's established
 * testing convention for UI-internal helpers).
 *
 * Run: node scripts/test-cancel-case-confirm-modal.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const ROOT = 'D:/Service Portal';
const dashboardSrc = fs.readFileSync(`${ROOT}/src/js/flows/dashboard.js`, 'utf8');

function extract(fnName) {
  const match = dashboardSrc.match(new RegExp(`function ${fnName}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`${fnName}() not found in dashboard.js -- test out of sync with source`);
  return match[0];
}

console.log('=== source-level guards ===');
{
  const cancelCaseMatch = dashboardSrc.match(/async function cancelCase\([^)]*\) \{[\s\S]*?\n\}/);
  assert(!!cancelCaseMatch, 'cancelCase() found in dashboard.js');
  assert(!/\bconfirm\(/.test(cancelCaseMatch[0]), 'cancelCase() no longer calls the native browser confirm() dialog');
  assert(/showCancelCaseConfirm/.test(cancelCaseMatch[0]), 'cancelCase() awaits the custom showCancelCaseConfirm() modal instead');
}

const showCancelCaseConfirmSrc = extract('showCancelCaseConfirm');
const resolveCancelCaseSrc = extract('resolveCancelCase');

function makeEl() {
  const el = {
    _classes: new Set(['hidden']),
    _text: '',
    classList: {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      contains: (c) => el._classes.has(c)
    },
    set textContent(v) { el._text = v; },
    get textContent() { return el._text; }
  };
  return el;
}

function buildSandbox() {
  const elements = {
    'cancel-case-message': makeEl(),
    'cancel-case-overlay': makeEl()
  };
  const document = { getElementById: (id) => elements[id] || null };
  const sandbox = { document, console };
  vm.createContext(sandbox);
  vm.runInContext('let _cancelCaseResolve = null;\n' + showCancelCaseConfirmSrc + '\n' + resolveCancelCaseSrc, sandbox, { filename: 'dashboard.js (cancel-case-confirm excerpt)' });
  return { sandbox, elements };
}

console.log('\n=== showCancelCaseConfirm() / resolveCancelCase() ===');
(async () => {
  {
    const { sandbox, elements } = buildSandbox();
    const promise = sandbox.showCancelCaseConfirm('Cancel case for Somchai?');
    assert(!elements['cancel-case-overlay'].classList.contains('hidden'), 'opening the confirm shows the overlay (hidden class removed)');
    assert(elements['cancel-case-message'].textContent === 'Cancel case for Somchai?', 'the dynamic job-name message is written into the modal');
    sandbox.resolveCancelCase(true);
    const result = await promise;
    assert(result === true, 'tapping the confirm button resolves the promise true');
    assert(elements['cancel-case-overlay'].classList.contains('hidden'), 'confirming re-hides the overlay');
  }
  {
    const { sandbox, elements } = buildSandbox();
    const promise = sandbox.showCancelCaseConfirm('Cancel case for Somchai?');
    sandbox.resolveCancelCase(false);
    const result = await promise;
    assert(result === false, 'tapping "keep case" (or the overlay backdrop) resolves the promise false');
    assert(elements['cancel-case-overlay'].classList.contains('hidden'), 'dismissing re-hides the overlay too');
  }
  {
    // Two sequential confirms must not resolve each other's stale promise.
    const { sandbox } = buildSandbox();
    const first = sandbox.showCancelCaseConfirm('Case A');
    sandbox.resolveCancelCase(true);
    const firstResult = await first;
    const second = sandbox.showCancelCaseConfirm('Case B');
    sandbox.resolveCancelCase(false);
    const secondResult = await second;
    assert(firstResult === true && secondResult === false, 'sequential confirms each resolve independently with their own answer');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
