/**
 * Meter Readings multi-device OCR request — forensic fix regression.
 *
 * Real bug (user-reported, live production testing): detectMeterReadingsFromImage()
 * hardcoded meter_type:'ph' for every photo captured through the "Meter
 * Readings" task, forcing the OCR service to route every image -- HANNA,
 * HACH DR300, HACH 2100Q alike -- through the hanna_hi98194 profile
 * regardless of which physical meter was actually photographed. Fixed by
 * sending meter_type:'multi', which lets ocr-service's existing
 * unrestricted match_hints scan pick the profile from the photo's own
 * content (see ocr-service/tests/parser/test_multi_device_routing.py for
 * the backend-side proof).
 *
 * This test loads the REAL src/js/flows/assessment.js (unmodified logic)
 * via vm and intercepts the real fetch() call to prove the request body
 * the client actually sends, rather than asserting against source text.
 *
 * Run: node tests/assessment/multi-device-ocr-request.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function fakeEl() {
  return {
    value: '', checked: false, style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {}, textContent: '', tagName: 'DIV', options: [],
    querySelectorAll: () => [], querySelector: () => null,
    removeAttribute() {}, setAttribute() {}, addEventListener() {}, appendChild() {}
  };
}

const domStub = {
  getElementById: () => fakeEl(),
  addEventListener: () => {},
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => fakeEl()
};

const sandbox = {
  console,
  window: {},
  document: domStub,
  navigator: { userAgent: 'node' },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  S: { activeJob: null, tapData: [], taps: [] },
  t: (k) => k
};
sandbox.window = sandbox;
vm.createContext(sandbox);

let capturedRequest = null;
sandbox.fetch = async (url, opts) => {
  capturedRequest = { url, body: JSON.parse(opts.body) };
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: {} })
  };
};

const noisyWarn = console.warn;
console.warn = () => {};
const code = fs.readFileSync(path.join('D:/Service Portal', 'src', 'js', 'flows', 'assessment.js'), 'utf8');
vm.runInContext(code, sandbox, { filename: 'assessment.js' });
console.warn = noisyWarn;

async function main() {
  await sandbox.detectMeterReadingsFromImage('data:image/png;base64,AAAA');

  check(capturedRequest !== null, 'detectMeterReadingsFromImage actually called fetch');
  check(capturedRequest.url === '/api/ocr/read-meter', 'request hit the real OCR proxy endpoint');
  check(capturedRequest.body.meter_type === 'multi', `meter_type sent is 'multi', not hardcoded 'ph' (got '${capturedRequest.body.meter_type}')`);
  check(capturedRequest.body.image_url === 'data:image/png;base64,AAAA', 'image_url passed through unchanged');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  process.exit(1);
});
