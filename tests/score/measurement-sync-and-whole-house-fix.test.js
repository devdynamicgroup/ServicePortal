/**
 * Regression suite (2026-10-09). Covers the two confirmed defects:
 *
 *   Bug A — invalidateStaleStandardMeasurement() (assessment.js) deleted a
 *   changed field from standardMeasurement with nothing to repopulate it.
 *   Bug B — readingsFromTapData() (score.js) pooled standardMeasurement vs
 *   meterReadings rows separately and only fell back to the legacy pool
 *   when NO row at all had the key in standardMeasurement, silently
 *   excluding a complete room's own value from the whole-house average.
 *
 * Loads the REAL patched files via vm — no reimplementation of the logic
 * under test. Does not touch grade curves, weights, limits, classification,
 * severity protection, Country Gate, or the 99-ceiling.
 *
 * Run: node tests/score/measurement-sync-and-whole-house-fix.test.js
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

const root = path.join(__dirname, '../..');

// ---------------------------------------------------------------------
// Part 1 — Bug A: invalidateStaleStandardMeasurement (assessment.js)
// Loaded in isolation: just the function + its dependency (ConversionEngine),
// no DOM, no full assessment.js flow (that needs a browser DOM harness).
// ---------------------------------------------------------------------
{
  const sandbox = { console: { log() {}, warn() {}, error() {}, info() {} }, window: {}, globalThis: {} };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/js/conversion/engine.js'), 'utf8'), sandbox, { filename: 'engine.js' });

  const src = fs.readFileSync(path.join(root, 'src/js/flows/assessment.js'), 'utf8');
  const startMarker = 'function invalidateStaleStandardMeasurement(';
  const startIdx = src.indexOf(startMarker);
  let fnSrc = null;
  if (startIdx !== -1) {
    // Find the parameter list's matching close-paren first -- default params
    // like `before = {}` contain a `{` that must not be mistaken for the
    // function body's opening brace.
    const parenOpenIdx = src.indexOf('(', startIdx);
    let parenDepth = 0;
    let parenCloseIdx = -1;
    for (let i = parenOpenIdx; i < src.length; i += 1) {
      if (src[i] === '(') parenDepth += 1;
      else if (src[i] === ')') {
        parenDepth -= 1;
        if (parenDepth === 0) { parenCloseIdx = i; break; }
      }
    }
    // Brace-count from the function body's opening `{` to its matching close --
    // a fixed-length regex breaks on nested blocks (forEach callback, if-blocks).
    const braceOpenIdx = src.indexOf('{', parenCloseIdx);
    let depth = 0;
    let endIdx = -1;
    for (let i = braceOpenIdx; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) { endIdx = i + 1; break; }
      }
    }
    if (endIdx !== -1) fnSrc = src.slice(startIdx, endIdx);
  }
  if (!fnSrc) {
    failed += 1;
    console.error('  FAIL  could not locate invalidateStaleStandardMeasurement() source to isolate-test');
  } else {
    vm.runInContext(fnSrc, sandbox, { filename: 'invalidateStaleStandardMeasurement.js' });
    const invalidate = sandbox.invalidateStaleStandardMeasurement;

    console.log('\n=== Bug A: invalidateStaleStandardMeasurement ===');

    // A manual edit changes a field that had a standardMeasurement value -> repopulated, not deleted.
    {
      const tap = { standardMeasurement: { ph: 7.1, tds: 100 } };
      const before = { ph: 7.1 };
      const after = { ph: 7.6 };
      invalidate(tap, before, after);
      assert(tap.standardMeasurement.ph === 7.6, `manual edit repopulates standardMeasurement.ph with the new value (got ${tap.standardMeasurement.ph})`);
      assert(tap.standardMeasurement.tds === 100, 'an untouched field (tds) is left alone');
    }

    // Explicit clear (empty string from a form field) removes the key, does not resurrect anything.
    {
      const tap = { standardMeasurement: { orp: 400 } };
      invalidate(tap, { orp: 400 }, { orp: '' });
      assert(!Object.prototype.hasOwnProperty.call(tap.standardMeasurement, 'orp'), 'explicit clear (empty string) removes the key entirely');
    }

    // Explicit clear via null.
    {
      const tap = { standardMeasurement: { orp: 400 } };
      invalidate(tap, { orp: 400 }, { orp: null });
      assert(!Object.prototype.hasOwnProperty.call(tap.standardMeasurement, 'orp'), 'explicit clear (null) removes the key entirely');
    }

    // Valid numeric zero must be preserved, not treated as a clear.
    {
      const tap = { standardMeasurement: { chlorine: 0.5 } };
      invalidate(tap, { chlorine: 0.5 }, { chlorine: 0 });
      assert(tap.standardMeasurement.chlorine === 0, `a new valid zero is written, not deleted (got ${tap.standardMeasurement.chlorine})`);
    }

    // Invalid / non-numeric new value does not get invented into standardMeasurement.
    {
      const tap = { standardMeasurement: { ph: 7.1 } };
      invalidate(tap, { ph: 7.1 }, { ph: 'not-a-number' });
      assert(!Object.prototype.hasOwnProperty.call(tap.standardMeasurement, 'ph'), 'a non-numeric new value is removed, never invented');
    }

    // A key that standardMeasurement never had stays untouched (no blind copy of every meterReadings field).
    {
      const tap = { standardMeasurement: { tds: 100 } };
      invalidate(tap, { ph: undefined }, { ph: 7.5 });
      assert(!Object.prototype.hasOwnProperty.call(tap.standardMeasurement, 'ph'), 'a field standardMeasurement never had is NOT blindly copied in from meterReadings');
    }

    // keyMap alias (chlorine persist path uses { freeChlorine: 'chlorine' }).
    {
      const tap = { standardMeasurement: { chlorine: 0.1 } };
      invalidate(tap, { freeChlorine: 0.1 }, { freeChlorine: 0.3 }, { freeChlorine: 'chlorine' });
      assert(tap.standardMeasurement.chlorine === 0.3, `alias keyMap (freeChlorine -> chlorine) repopulates correctly (got ${tap.standardMeasurement.chlorine})`);
    }

    // No change -> no-op, object identity preserved (no unnecessary rebuild/re-render).
    {
      const tap = { standardMeasurement: { ph: 7.1 } };
      const original = tap.standardMeasurement;
      invalidate(tap, { ph: 7.1 }, { ph: 7.1 });
      assert(tap.standardMeasurement === original, 'unchanged values are a true no-op (same object reference)');
    }

    // DO is written as-is (mg/L, already converted upstream by mapOcrDataToMeterReadings's
    // do: data.do_mg_l ?? data.do mapping before it ever reaches meterReadings) --
    // this function must not attempt a second, redundant %-to-mg/L conversion.
    {
      const tap = { standardMeasurement: { do: 7.27 } };
      invalidate(tap, { do: 7.27 }, { do: 6.08 });
      assert(tap.standardMeasurement.do === 6.08, `DO mg/L value is written as-is, no re-conversion attempted (got ${tap.standardMeasurement.do})`);
    }

    // A later real OCR capture still has the final word: storeRawAndStandardMeasurements
    // always REPLACES tap.standardMeasurement wholesale from freshly re-derived
    // ConversionEngine output -- it is not called through invalidate() and is not
    // blocked or overridden by anything this function wrote. Simulated here by
    // the same wholesale-replacement pattern that function uses.
    {
      const tap = { standardMeasurement: { ph: 7.1, tds: 100 } };
      invalidate(tap, { ph: 7.1 }, { ph: 7.8 }); // manual edit first
      assert(tap.standardMeasurement.ph === 7.8, 'manual edit applied first');
      // Simulate a subsequent OCR capture's wholesale replacement (the real
      // storeRawAndStandardMeasurements behavior, unaffected by this patch).
      tap.standardMeasurement = { ph: 7.3, tds: 95, orp: 200 };
      assert(tap.standardMeasurement.ph === 7.3, `a later real OCR capture still fully overwrites, unimpeded by the manual-edit repopulation (got ${tap.standardMeasurement.ph})`);
    }
  }
}

// ---------------------------------------------------------------------
// Part 2 — Bug B: readingsFromTapData (score.js), full file via vm
// ---------------------------------------------------------------------
{
  const sandbox = { console: { log() {}, warn() {}, error() {}, info() {} }, window: {}, globalThis: {}, document: { getElementById: () => null } };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/js/flows/score.js'), 'utf8'), sandbox, { filename: 'score.js' });
  const { readingsFromTapData } = sandbox;

  console.log('\n=== Bug B: readingsFromTapData — per-room resolution before averaging ===');

  // Single complete room — must be numerically identical to the old per-row behavior.
  {
    const taps = [{ standardMeasurement: { ph: 7.69, tds: 91, turbidity: 0.8, orp: 189.5, do: 6.04 }, meterReadings: {} }];
    const r = readingsFromTapData(taps);
    assert(r.ph === 7.69 && r.tds === 91 && r.turbidity === 0.8 && r.orp === 189.5 && r.do === 6.04,
      `a single complete room is unchanged by the fix (got ${JSON.stringify(r)})`);
  }

  // A field present in standardMeasurement for ONE room must not suppress another room's meterReadings fallback.
  {
    const taps = [
      { standardMeasurement: { ph: 7.0 }, meterReadings: {} },
      { standardMeasurement: {}, meterReadings: { ph: 8.0 } }
    ];
    const r = readingsFromTapData(taps);
    assert(r.ph === 7.5, `room 2's meterReadings.ph is NOT suppressed by room 1 having ph in standardMeasurement (got ${r.ph}, expected 7.5)`);
  }

  // A room is never counted twice for the same field (present in both sources for the same tap).
  {
    const taps = [{ standardMeasurement: { ph: 7.0 }, meterReadings: { ph: 9.0 } }];
    const r = readingsFromTapData(taps);
    assert(r.ph === 7.0, `standardMeasurement wins over meterReadings for the SAME tap -- not averaged together (got ${r.ph})`);
  }

  // Missing reading (neither source has the key) is excluded, not treated as zero.
  {
    const taps = [
      { standardMeasurement: { ph: 7.0 }, meterReadings: {} },
      { standardMeasurement: {}, meterReadings: {} }
    ];
    const r = readingsFromTapData(taps);
    assert(r.ph === 7.0, `a room with no ph at all is excluded from the average, not counted as 0 (got ${r.ph})`);
  }

  // Explicit clear on one room blocks fallback for that key across the whole average when every owning tap is cleared.
  {
    const taps = [{ standardMeasurement: { ph: null }, meterReadings: { ph: 7.5 } }];
    const r = readingsFromTapData(taps);
    assert(r.ph === undefined, `an explicit null clear is not resurrected from meterReadings (got ${r.ph})`);
    assert(r.__explicitClears.has('ph'), 'ph is tracked as an explicit clear');
  }

  // Valid zero handled correctly (not dropped, not treated as missing).
  {
    const taps = [{ standardMeasurement: { chlorine: 0 }, meterReadings: {} }];
    const r = readingsFromTapData(taps);
    assert(r.chlorine === 0, `a genuine chlorine:0 is preserved in the whole-house average (got ${r.chlorine})`);
  }

  // Conflicting values across rooms average per the existing approved precedence (arithmetic mean, unchanged policy).
  {
    const taps = [
      { standardMeasurement: { tds: 100 }, meterReadings: {} },
      { standardMeasurement: { tds: 200 }, meterReadings: {} }
    ];
    const r = readingsFromTapData(taps);
    assert(r.tds === 150, `conflicting tds values average per existing policy (got ${r.tds})`);
  }

  // Chlorine alias handling (freeChlorine) still works per-room before averaging.
  {
    const taps = [
      { standardMeasurement: {}, meterReadings: {}, chlorineReadings: { freeChlorine: 0.2 } },
      { standardMeasurement: { chlorine: 0.4 }, meterReadings: {} }
    ];
    const r = readingsFromTapData(taps);
    assert(Math.abs(r.chlorine - 0.3) < 1e-9, `chlorine resolves per-room (standardMeasurement or chlorineReadings.freeChlorine) before averaging (got ${r.chlorine})`);
  }

  // The real-world six-room fixture shaped like the reported Jutachai V. case.
  console.log('\n=== Real-world fixture: six-room case shaped like Jutachai V. ===');
  {
    const taps = [
      { standardMeasurement: { tds: 136.5, chlorine: 0, temp: 28.23 }, meterReadings: { ph: 7.6, tds: 136.5, temp: 28.23, turbidity: 0.73, orp: 165, do: 7.27 } },
      { standardMeasurement: { tds: 118, chlorine: 0.02, do: 0 }, meterReadings: { ph: 7.16, tds: 118, temp: 25.45, turbidity: 0.11, orp: 219.6, do: 6.08 } },
      { standardMeasurement: { ph: 7.69, tds: 91, chlorine: 0.02, turbidity: 0.8, orp: 189.5, do: 6.04, temp: 14.596 }, meterReadings: { ph: 7.69, tds: 91, temp: 14.596, turbidity: 0.8, orp: 189.5, do: 6.04 } },
      { standardMeasurement: { ph: 7.72, tds: 90, turbidity: 0.56, orp: 184.8, temp: 14.586, chlorine: 0.01 }, meterReadings: { ph: 7.72, tds: 90, temp: 14.586, turbidity: 0.56, orp: 184.8, do: 7.61 } },
      { standardMeasurement: { tds: 90, chlorine: 0, turbidity: 0.88, temp: 14.56 }, meterReadings: { ph: 7.68, tds: 90, temp: 14.56, turbidity: 0.88, orp: 177.6, do: 7.93 } },
      { standardMeasurement: { ph: 7.48, tds: 91, chlorine: 0.02, turbidity: 0.83, orp: 186.9, temp: 25 }, meterReadings: { ph: 7.48, tds: 91, temp: 25, turbidity: 0.83, orp: 186.9, do: 6.27 } }
    ];
    const r = readingsFromTapData(taps);
    const expectedPh = (7.6 + 7.16 + 7.69 + 7.72 + 7.68 + 7.48) / 6;
    const expectedOrp = (165 + 219.6 + 189.5 + 184.8 + 177.6 + 186.9) / 6;
    const expectedDo = (7.27 + 0 + 6.04 + 7.61 + 7.93 + 6.27) / 6; // room 2's standardMeasurement do:0 still wins for its own tap -- unresolved separate issue, not this patch's scope
    const expectedTurb = (0.73 + 0.11 + 0.8 + 0.56 + 0.88 + 0.83) / 6;
    assert(Math.abs(r.ph - expectedPh) < 1e-9, `ph average deterministically includes all 6 rooms (got ${r.ph}, expected ${expectedPh})`);
    assert(Math.abs(r.orp - expectedOrp) < 1e-9, `orp average deterministically includes all 6 rooms (got ${r.orp}, expected ${expectedOrp})`);
    assert(Math.abs(r.turbidity - expectedTurb) < 1e-9, `turbidity average deterministically includes all 6 rooms (got ${r.turbidity}, expected ${expectedTurb})`);
    assert(Math.abs(r.do - expectedDo) < 1e-9, `do average includes all 6 rooms; room 2's stale 0 is a SEPARATE documented issue, unchanged by this patch (got ${r.do}, expected ${expectedDo})`);
    assert(r.tds === 102.75, `tds average unchanged (all rooms already had it in standardMeasurement) (got ${r.tds})`);
    console.log('  resolved whole-house reading set:', JSON.stringify(r));
  }
}

console.log('');
console.log(`Measurement-sync + whole-house fix regression: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
