/**
 * Boundary smoke: OCR_INVALID_RESPONSE / Python NaN JSON compatibility.
 * Run: node scripts/test-ocr-client-invalid-response.js
 */
const path = require('path');
const {
  sanitizePythonJsonText,
  parseOcrServiceBody
} = require(path.join(__dirname, '..', 'services', 'ocrClient.js'));

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${msg}`);
  }
}

console.log('ocrClient OCR_INVALID_RESPONSE boundary');

{
  const raw = '{"success":true,"data":{"ph":7.29},"confidence":NaN,"meter_type":"ph"}';
  let threw = false;
  try {
    JSON.parse(raw);
  } catch {
    threw = true;
  }
  assert(threw, 'Node rejects Python-style NaN JSON');

  const sanitized = sanitizePythonJsonText(raw);
  assert(sanitized.changed, 'sanitize marks NaN change');
  const parsed = JSON.parse(sanitized.text);
  assert(parsed.success === true, 'sanitized JSON parses');
  assert(parsed.confidence === null, 'NaN becomes null');
  assert(parsed.data.ph === 7.29, 'measurement values preserved');
}

{
  const raw = '{"success":true,"data":{},"confidence":Infinity}';
  const result = parseOcrServiceBody(raw, 200);
  assert(result.ok === true, 'Infinity body accepted after sanitize');
  assert(result.usedSanitize === true, 'sanitize flag set');
  assert(result.body.confidence === null, 'Infinity → null');
}

{
  const raw = '{"success":true,"data":{"tds":450},"confidence":0.91,"meter_type":"ph"}';
  const result = parseOcrServiceBody(raw, 200);
  assert(result.ok === true, 'valid JSON still accepted');
  assert(result.usedSanitize === false, 'no sanitize for valid JSON');
  assert(result.body.data.tds === 450, 'valid data preserved');
}

{
  const result = parseOcrServiceBody('', 200);
  assert(result.ok === false, 'empty body rejected');
  assert(result.error.error === 'OCR_INVALID_RESPONSE', 'empty → OCR_INVALID_RESPONSE');
}

{
  const result = parseOcrServiceBody('<html>bad gateway</html>', 200);
  assert(result.ok === false, 'HTML body rejected');
  assert(result.error.error === 'OCR_INVALID_RESPONSE', 'HTML → OCR_INVALID_RESPONSE');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
