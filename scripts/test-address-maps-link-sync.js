'use strict';

/**
 * Regression suite for the Address -> Maps Link sync fix (2026-09-08).
 *
 * Covers the 3 low-priority Maps Link findings from the earlier review,
 * traced end-to-end before fixing (see conversation record):
 *  1. wireMapsLinkPlaceSearch()'s docstring must no longer claim a lazy
 *     "on first focus" load -- initMapsLinkField() calls it eagerly.
 *  2. applyGooglePlaceSelection() (dead code, zero callers, confirmed via
 *     repo-wide grep including comments) must be fully removed.
 *  3. selectAddressSuggestion() must fill an EMPTY ci-maps with
 *     buildMapsPlaceLink(label) -- using the exact same label already used
 *     for ci-addr, no coordinates/geocoding needed -- and must NEVER
 *     overwrite a Maps Link the user already set.
 *
 * Extracts the REAL functions out of preassessment.js via regex, not a
 * reimplementation (same approach as test-maps-link-field.js).
 *
 * Run: node scripts/test-address-maps-link-sync.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const ROOT = 'D:/Service Portal';
const src = fs.readFileSync(path.join(ROOT, 'src/js/flows/preassessment.js'), 'utf8');

console.log('\n=== Documentation regressions (findings #1 and #2) ===');
{
  assert(!src.includes('applyGooglePlaceSelection'),
    'applyGooglePlaceSelection is fully gone from the source (function + every reference, including comments)');

  const docBlockMatch = src.match(/\/\*\*[\s\S]*?Wires real Google Places Autocomplete[\s\S]*?\*\//);
  assert(!!docBlockMatch, 'wireMapsLinkPlaceSearch() doc comment found (test in sync)');
  assert(docBlockMatch && !/lazily on first focus/i.test(docBlockMatch[0]),
    'doc comment no longer claims a lazy "on first focus" load (matches the real eager-call behavior)');
  assert(docBlockMatch && /eagerly/i.test(docBlockMatch[0]),
    'doc comment now describes the real eager-load behavior');
}

function makeInputEl(initial = '') {
  return { value: initial };
}

function buildSandbox() {
  const elements = {
    'ci-addr': makeInputEl(),
    'ci-postal': makeInputEl(),
    'ci-maps': makeInputEl(),
    'address-dropdown': { classList: { add() {}, remove() {} } }
  };
  const sandbox = {
    console,
    S: { lang: 'en' },
    METRO_CITIES: new Set(['Bangkok']),
    getSelectedProvince: () => 'Bangkok',
    setProvinceValue: () => {},
    setPostalForProvince: () => {},
    extractPostalCode: (label, code) => code || '',
    updatePreassessmentCompletionState: () => {},
    document: {
      getElementById: (id) => elements[id] || null
    },
    window: {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return { sandbox, elements };
}

function extract(name, pattern) {
  const m = src.match(pattern);
  assert(!!m, `${name}() found in preassessment.js (test in sync)`);
  return m ? m[0] : null;
}

const buildPlaceLinkSrc = extract('buildMapsPlaceLink', /function buildMapsPlaceLink\(address, placeId\) \{[\s\S]*?\n\}/);
const selectAddressSrc = extract('selectAddressSuggestion', /function selectAddressSuggestion\(label, code, city\) \{[\s\S]*?\n\}/);

console.log('\n=== selectAddressSuggestion(label, code, city): Maps Link sync (finding #3) ===');
{
  // Empty ci-maps -> filled with a named-place link built from the same label.
  {
    const { sandbox, elements } = buildSandbox();
    vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
    vm.runInContext(selectAddressSrc, sandbox, { filename: 'preassessment.js (selectAddressSuggestion excerpt)' });

    sandbox.selectAddressSuggestion('99 Sukhumvit Rd, Khlong Tan, Watthana, Bangkok 10110', '10110', 'Bangkok');

    assert(elements['ci-addr'].value === '99 Sukhumvit Rd, Khlong Tan, Watthana, Bangkok 10110',
      `ci-addr still fills as before (got "${elements['ci-addr'].value}")`);
    assert(elements['ci-maps'].value === 'https://www.google.com/maps/search/?api=1&query=99%20Sukhumvit%20Rd%2C%20Khlong%20Tan%2C%20Watthana%2C%20Bangkok%2010110',
      `empty ci-maps gets auto-filled with a named-place link from the same label (got ${elements['ci-maps'].value})`);
  }

  // Non-empty ci-maps (user already set it) -> must NEVER be overwritten.
  {
    const { sandbox, elements } = buildSandbox();
    elements['ci-maps'].value = 'https://www.google.com/maps/search/?api=1&query=13.7563,100.5018';
    vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
    vm.runInContext(selectAddressSrc, sandbox, { filename: 'preassessment.js (selectAddressSuggestion excerpt)' });

    sandbox.selectAddressSuggestion('456 Silom Rd, Bangkok', '10500', 'Bangkok');

    assert(elements['ci-maps'].value === 'https://www.google.com/maps/search/?api=1&query=13.7563,100.5018',
      `existing user-set Maps Link is NEVER overwritten by an Address selection (got ${elements['ci-maps'].value})`);
  }

  // Whitespace-only ci-maps counts as empty (must still fill).
  {
    const { sandbox, elements } = buildSandbox();
    elements['ci-maps'].value = '   ';
    vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
    vm.runInContext(selectAddressSrc, sandbox, { filename: 'preassessment.js (selectAddressSuggestion excerpt)' });

    sandbox.selectAddressSuggestion('789 Sathorn Rd, Bangkok', '10120', 'Bangkok');

    assert(elements['ci-maps'].value.startsWith('https://www.google.com/maps/search/'),
      `whitespace-only ci-maps still counts as empty and gets filled (got "${elements['ci-maps'].value}")`);
  }

  // Thai-script label round-trips through the URL encoder without throwing.
  {
    const { sandbox, elements } = buildSandbox();
    vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
    vm.runInContext(selectAddressSrc, sandbox, { filename: 'preassessment.js (selectAddressSuggestion excerpt)' });

    let threw = null;
    try { sandbox.selectAddressSuggestion('เทศบาลเมืองปทุมธานี', '', 'Bangkok'); } catch (e) { threw = e; }

    assert(!threw, `Thai-script label does not throw (got ${threw && threw.message})`);
    assert(elements['ci-maps'].value.includes(encodeURIComponent('เทศบาลเมืองปทุมธานี')),
      `Thai-script label is correctly URL-encoded into the Maps Link (got ${elements['ci-maps'].value})`);
  }

  // No label at all -- must not write a broken/empty query.
  {
    const { sandbox, elements } = buildSandbox();
    vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
    vm.runInContext(selectAddressSrc, sandbox, { filename: 'preassessment.js (selectAddressSuggestion excerpt)' });

    sandbox.selectAddressSuggestion('', '', 'Bangkok');

    assert(elements['ci-maps'].value === '', `empty label => ci-maps stays empty, no garbage link written (got "${elements['ci-maps'].value}")`);
  }
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
