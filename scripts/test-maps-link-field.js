/**
 * Regression suite for the "Google Maps Link" field usability fix
 * (src/js/flows/preassessment.js, 2026-08-25).
 *
 * Direct feedback: the dashboard Directions/Locate buttons (db19bb1f) were
 * the wrong place for this feature -- reverted (0a7cda92). The actual ask
 * was to make the preassessment form's existing "Google Maps Link" field
 * (ci-maps) easy + accurate: a "use my location" button, and Google Places
 * search wired directly onto the field (GOOGLE_MAPS_API_KEY /
 * /api/maps-config already existed for exactly this, just never connected).
 *
 * Covers:
 *  - applyGooglePlaceToMapsField(place): fills ONLY ci-maps, never
 *    ci-addr/ci-postal (deliberately narrower than the pre-existing
 *    applyGooglePlaceSelection(), which does touch those).
 *  - useMyLocationForMaps(): success fills an accurate coordinate-based
 *    link; denied/unavailable/timeout/unsupported all fall back to the
 *    same graceful toast, never a crash, never a partial/garbage value.
 *
 * Extracts the REAL functions out of preassessment.js via regex, not a
 * reimplementation.
 *
 * Run: node scripts/test-maps-link-field.js
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

const ROOT = 'D:/Service Portal';
const src = fs.readFileSync(path.join(ROOT, 'src/js/flows/preassessment.js'), 'utf8');

function makeInputEl(initial = '') {
  return { value: initial };
}

function buildSandbox() {
  const elements = { 'ci-maps': makeInputEl() };
  const toasts = [];
  const sandbox = {
    console,
    S: { lang: 'en' },
    t: (key) => key,
    showToast: (msg) => toasts.push(msg),
    document: {
      getElementById: (id) => elements[id] || null
    },
    updatePreassessmentCompletionState: () => {},
    navigator: {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return { sandbox, elements, toasts };
}

console.log('=== applyGooglePlaceToMapsField(place): scoped to ci-maps only ===');
{
  const { sandbox, elements } = buildSandbox();
  elements['ci-addr'] = makeInputEl('Original Address Typed By User');
  elements['ci-postal'] = makeInputEl('10110');

  const fnMatch = src.match(/function applyGooglePlaceToMapsField\(place\) \{[\s\S]*?\n\}/);
  assert(!!fnMatch, 'applyGooglePlaceToMapsField() found in preassessment.js (test in sync)');
  if (fnMatch) {
    vm.runInContext(fnMatch[0], sandbox, { filename: 'preassessment.js (applyGooglePlaceToMapsField excerpt)' });

    const place = {
      formatted_address: '999 Should Not Be Used Rd',
      address_components: [{ types: ['postal_code'], long_name: '99999' }],
      geometry: { location: { lat: () => 13.7563, lng: () => 100.5018 } }
    };
    sandbox.applyGooglePlaceToMapsField(place);

    assert(elements['ci-maps'].value === 'https://www.google.com/maps/search/?api=1&query=13.7563,100.5018',
      `ci-maps filled with an accurate coordinate link (got ${elements['ci-maps'].value})`);
    assert(elements['ci-addr'].value === 'Original Address Typed By User',
      `ci-addr is NOT touched -- stays exactly what the user already typed (got "${elements['ci-addr'].value}")`);
    assert(elements['ci-postal'].value === '10110',
      `ci-postal is NOT touched either (got "${elements['ci-postal'].value}")`);
  }

  // A place with no geometry (e.g. a partial/ambiguous search result) must not crash or clear the field.
  const { sandbox: sandbox2, elements: elements2 } = buildSandbox();
  elements2['ci-maps'] = makeInputEl('https://existing-link');
  if (fnMatch) {
    vm.runInContext(fnMatch[0], sandbox2, { filename: 'preassessment.js (applyGooglePlaceToMapsField excerpt, no-geometry case)' });
    let threw = null;
    try { sandbox2.applyGooglePlaceToMapsField({}); } catch (e) { threw = e; }
    assert(!threw, `a place with no geometry does not throw (got ${threw && threw.message})`);
    assert(elements2['ci-maps'].value === 'https://existing-link',
      `a place with no geometry does not clear/overwrite an existing link (got "${elements2['ci-maps'].value}")`);
  }
}

console.log('\n=== useMyLocationForMaps(): GPS success + graceful fallback ===');
{
  const fnMatch = src.match(/function useMyLocationForMaps\(\) \{[\s\S]*?\n\}/);
  assert(!!fnMatch, 'useMyLocationForMaps() found in preassessment.js (test in sync)');
  if (!fnMatch) {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(1);
  }

  // --- success: valid coordinates fill an accurate link ---
  {
    const { sandbox, elements, toasts } = buildSandbox();
    sandbox.navigator.geolocation = {
      getCurrentPosition: (onSuccess) => onSuccess({ coords: { latitude: 13.7563, longitude: 100.5018 } })
    };
    vm.runInContext(fnMatch[0], sandbox, { filename: 'preassessment.js (useMyLocationForMaps excerpt)' });
    sandbox.useMyLocationForMaps();
    assert(elements['ci-maps'].value === 'https://www.google.com/maps/search/?api=1&query=13.7563,100.5018',
      `success => ci-maps filled with an accurate coordinate link (got ${elements['ci-maps'].value})`);
    assert(toasts.length === 0, 'success => no error toast shown');
  }

  // --- denied / unavailable / timeout: all treated the same, graceful fallback ---
  for (const scenario of ['denied', 'unavailable', 'timeout']) {
    const { sandbox, elements, toasts } = buildSandbox();
    sandbox.navigator.geolocation = {
      getCurrentPosition: (onSuccess, onError) => onError({ code: scenario })
    };
    vm.runInContext(fnMatch[0], sandbox, { filename: `preassessment.js (useMyLocationForMaps excerpt, ${scenario})` });
    sandbox.useMyLocationForMaps();
    assert(elements['ci-maps'].value === '', `${scenario} => ci-maps is left untouched, not filled with garbage (got "${elements['ci-maps'].value}")`);
    assert(toasts.length === 1, `${scenario} => exactly one graceful fallback toast shown (got ${toasts.length})`);
  }

  // --- unsupported browser: navigator.geolocation missing entirely ---
  {
    const { sandbox, elements, toasts } = buildSandbox();
    // sandbox.navigator.geolocation intentionally left undefined
    vm.runInContext(fnMatch[0], sandbox, { filename: 'preassessment.js (useMyLocationForMaps excerpt, unsupported)' });
    let threw = null;
    try { sandbox.useMyLocationForMaps(); } catch (e) { threw = e; }
    assert(!threw, `unsupported browser (no navigator.geolocation) does not throw (got ${threw && threw.message})`);
    assert(elements['ci-maps'].value === '', 'unsupported browser => ci-maps left untouched');
    assert(toasts.length === 1, 'unsupported browser => graceful fallback toast shown');
  }

  // --- malformed position (defensive: non-finite coords from a broken polyfill) ---
  {
    const { sandbox, elements, toasts } = buildSandbox();
    sandbox.navigator.geolocation = {
      getCurrentPosition: (onSuccess) => onSuccess({ coords: { latitude: NaN, longitude: 100.5 } })
    };
    vm.runInContext(fnMatch[0], sandbox, { filename: 'preassessment.js (useMyLocationForMaps excerpt, malformed)' });
    sandbox.useMyLocationForMaps();
    assert(elements['ci-maps'].value === '', `malformed/non-finite coords => ci-maps NOT filled with garbage (got "${elements['ci-maps'].value}")`);
    assert(toasts.length === 1, 'malformed coords => graceful fallback toast shown, not a silent bad link');
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
