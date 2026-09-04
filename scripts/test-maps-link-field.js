/**
 * Regression suite for the "Google Maps Link" field usability fix
 * (src/js/flows/preassessment.js, 2026-08-25) and the follow-up visible,
 * click-to-place map picker (same day, direct feedback: "want to see a
 * real map and tap to choose the location").
 *
 * Direct feedback led to two rounds:
 *  1. The dashboard Directions/Locate buttons (db19bb1f) were the wrong
 *     place for this -- reverted (0a7cda92). The real ask was the
 *     preassessment form's existing "Google Maps Link" field (ci-maps).
 *  2. A text-only search/GPS fill (a1beab9a) wasn't enough either --
 *     wanted an actual visible map to look at and click/drag a pin on.
 *
 * Covers:
 *  - buildMapsSearchLink(lat, lng): pure link format, single source of truth.
 *  - parseLatLngFromMapsLink(value): recovers coordinates from an existing
 *    link (e.g. re-opening a Case) without ever guessing on unparseable input.
 *  - setMapsLinkFromCoords(lat, lng, opts): the one place that writes to
 *    ci-maps AND keeps the visible map in sync, shared by all three
 *    triggers (place search, GPS, map click/drag) -- must fail closed on
 *    invalid coordinates (never partially write a garbage link).
 *  - applyGooglePlaceToMapsField(place): fills ONLY ci-maps, never
 *    ci-addr/ci-postal.
 *  - useMyLocationForMaps(): success fills an accurate link (and ensures
 *    the map SDK starts loading first); denied/unavailable/timeout/
 *    unsupported/malformed all fall back to the same graceful toast.
 *
 * Extracts the REAL functions out of preassessment.js via regex, not a
 * reimplementation. showMapsPreview() (actual google.maps.Map creation)
 * is stubbed in these tests -- it needs a real browser/Maps SDK, which
 * isn't available here; NOT VERIFIED by this suite, flagged explicitly.
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
  const previewCalls = [];
  const sandbox = {
    console,
    S: { lang: 'en' },
    t: (key) => key,
    showToast: (msg) => toasts.push(msg),
    document: {
      getElementById: (id) => elements[id] || null
    },
    updatePreassessmentCompletionState: () => {},
    showMapsPreview: (lat, lng) => previewCalls.push({ lat, lng }),
    navigator: {},
    window: {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return { sandbox, elements, toasts, previewCalls };
}

function extract(name, pattern) {
  const m = src.match(pattern);
  assert(!!m, `${name}() found in preassessment.js (test in sync)`);
  return m ? m[0] : null;
}

const buildLinkSrc = extract('buildMapsSearchLink', /function buildMapsSearchLink\(lat, lng\) \{[\s\S]*?\n\}/);
const buildPlaceLinkSrc = extract('buildMapsPlaceLink', /function buildMapsPlaceLink\(address, placeId\) \{[\s\S]*?\n\}/);
const parseLinkSrc = extract('parseLatLngFromMapsLink', /function parseLatLngFromMapsLink\(value\) \{[\s\S]*?\n\}/);
const parsePlaceQuerySrc = extract('parsePlaceQueryFromMapsLink', /function parsePlaceQueryFromMapsLink\(value\) \{[\s\S]*?\n\}/);
const geocodePlaceQuerySrc = extract('geocodeMapsPlaceQuery', /function geocodeMapsPlaceQuery\(\{ query, placeId \} = \{\}\) \{[\s\S]*?\n\}/);
const reverseGeocodeSrc = extract('reverseGeocodeLatLng', /function reverseGeocodeLatLng\(lat, lng\) \{[\s\S]*?\n\}/);
// setMapsLinkFromCoords now calls reverseGeocodeLatLng internally (background
// upgrade to a named-place link) -- both must load into the same sandbox.
const setCoordsSrc = `${reverseGeocodeSrc}\n${extract('setMapsLinkFromCoords', /function setMapsLinkFromCoords\(lat, lng, \{ recenterMap = true, address = '', placeId = '' \} = \{\}\) \{[\s\S]*?\n\}/)}`;
const applyPlaceSrc = extract('applyGooglePlaceToMapsField', /function applyGooglePlaceToMapsField\(place\) \{[\s\S]*?\n\}/);
const useLocationSrc = extract('useMyLocationForMaps', /function useMyLocationForMaps\(\) \{[\s\S]*?\n\}/);

if (!buildLinkSrc || !buildPlaceLinkSrc || !parseLinkSrc || !parsePlaceQuerySrc || !geocodePlaceQuerySrc || !setCoordsSrc || !applyPlaceSrc || !useLocationSrc) {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}

async function main() {
console.log('\n=== buildMapsSearchLink(lat, lng): pure link format ===');
{
  const { sandbox } = buildSandbox();
  vm.runInContext(buildLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
  vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
  const link = sandbox.buildMapsSearchLink(13.7563, 100.5018);
  assert(link === 'https://www.google.com/maps/search/?api=1&query=13.7563,100.5018', `correct format (got ${link})`);
}

console.log('\n=== buildMapsPlaceLink(address, placeId): named-place link format ===');
{
  const { sandbox } = buildSandbox();
  vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });

  const withPlaceId = sandbox.buildMapsPlaceLink('123 Sukhumvit Rd, Bangkok', 'ChIJtest12345');
  assert(withPlaceId === 'https://www.google.com/maps/search/?api=1&query=123%20Sukhumvit%20Rd%2C%20Bangkok&query_place_id=ChIJtest12345',
    `with place_id: correct format, matches Google's documented Place Search URL scheme (got ${withPlaceId})`);

  const withoutPlaceId = sandbox.buildMapsPlaceLink('123 Sukhumvit Rd, Bangkok', '');
  assert(withoutPlaceId === 'https://www.google.com/maps/search/?api=1&query=123%20Sukhumvit%20Rd%2C%20Bangkok',
    `without place_id: still valid, just omits &query_place_id= (got ${withoutPlaceId})`);

  assert(sandbox.buildMapsPlaceLink('', 'ChIJtest12345') === '', 'empty address => empty string, even with a place_id (no point linking to nothing)');
  assert(sandbox.buildMapsPlaceLink(null, null) === '', 'null address => empty string');
  assert(sandbox.buildMapsPlaceLink(undefined, undefined) === '', 'undefined address => empty string');

  const thai = sandbox.buildMapsPlaceLink('เทศบาลเมืองปทุมธานี', 'ChIJthai');
  assert(decodeURIComponent(thai.split('query=')[1].split('&')[0]) === 'เทศบาลเมืองปทุมธานี', `Thai script safely encoded (got ${thai})`);

  const malicious = sandbox.buildMapsPlaceLink('123 St&redirect=evil.com', 'ChIJ&extra=1');
  const params = malicious.split('?')[1].split('&');
  assert(params.length === 3 && params[0] === 'api=1', `malicious-looking address/place_id do NOT inject extra query params (got params: ${JSON.stringify(params)})`);
}

console.log('\n=== parseLatLngFromMapsLink(value): recovers coords, never guesses ===');
{
  const { sandbox } = buildSandbox();
  vm.runInContext(buildLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
  vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
  vm.runInContext(parseLinkSrc, sandbox, { filename: 'preassessment.js (parseLatLngFromMapsLink excerpt)' });

  const roundTrip = sandbox.parseLatLngFromMapsLink(sandbox.buildMapsSearchLink(13.7563, 100.5018));
  assert(roundTrip && roundTrip.lat === 13.7563 && roundTrip.lng === 100.5018, `round-trips a link this form generated (got ${JSON.stringify(roundTrip)})`);

  const negative = sandbox.parseLatLngFromMapsLink('https://www.google.com/maps/search/?api=1&query=-33.8688,-151.2093');
  assert(negative && negative.lat === -33.8688 && negative.lng === -151.2093, `handles negative coordinates (Southern/Western hemisphere) (got ${JSON.stringify(negative)})`);

  for (const bad of [null, undefined, '', 'not a link at all', 'https://example.com/foo', 'https://www.google.com/maps/search/?api=1&query=notanumber,also-not-a-number']) {
    const result = sandbox.parseLatLngFromMapsLink(bad);
    assert(result === null, `unparseable input (${JSON.stringify(bad)}) => null, never guesses (got ${JSON.stringify(result)})`);
  }
}

console.log('\n=== parsePlaceQueryFromMapsLink(value): recovers place text, the missing half ===');
{
  const { sandbox } = buildSandbox();
  vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
  vm.runInContext(parsePlaceQuerySrc, sandbox, { filename: 'preassessment.js (parsePlaceQueryFromMapsLink excerpt)' });

  const withId = sandbox.parsePlaceQueryFromMapsLink(sandbox.buildMapsPlaceLink('123 Sukhumvit Rd, Bangkok', 'ChIJtest12345'));
  assert(withId && withId.query === '123 Sukhumvit Rd, Bangkok' && withId.placeId === 'ChIJtest12345',
    `round-trips a named-place link this form generated, with place_id (got ${JSON.stringify(withId)})`);

  const withoutId = sandbox.parsePlaceQueryFromMapsLink(sandbox.buildMapsPlaceLink('456 Silom Rd, Bangkok', ''));
  assert(withoutId && withoutId.query === '456 Silom Rd, Bangkok' && withoutId.placeId === '',
    `round-trips without a place_id too (got ${JSON.stringify(withoutId)})`);

  const thaiLink = sandbox.buildMapsPlaceLink('เทศบาลเมืองปทุมธานี', '');
  const thaiParsed = sandbox.parsePlaceQueryFromMapsLink(thaiLink);
  assert(thaiParsed && thaiParsed.query === 'เทศบาลเมืองปทุมธานี', `Thai script round-trips correctly (got ${JSON.stringify(thaiParsed)})`);

  // Must defer to parseLatLngFromMapsLink for coordinate-only links -- not its job to double-handle those.
  const coordOnly = sandbox.parsePlaceQueryFromMapsLink('https://www.google.com/maps/search/?api=1&query=13.7563,100.5018');
  assert(coordOnly === null, `a coordinate-only link => null, that is parseLatLngFromMapsLink's job (got ${JSON.stringify(coordOnly)})`);

  for (const bad of [null, undefined, '', 'not a link at all', 'https://example.com/foo']) {
    const result = sandbox.parsePlaceQueryFromMapsLink(bad);
    assert(result === null, `unparseable input (${JSON.stringify(bad)}) => null, never guesses (got ${JSON.stringify(result)})`);
  }
}

console.log('\n=== geocodeMapsPlaceQuery({ query, placeId }): resolves via Maps SDK Geocoder only ===');
{
  // Success via placeId (preferred -- exact match).
  {
    const { sandbox } = buildSandbox();
    let capturedRequest = null;
    sandbox.window.google = {
      maps: {
        Geocoder: function Geocoder() {
          this.geocode = (request, cb) => {
            capturedRequest = request;
            cb([{ geometry: { location: { lat: () => 13.7563, lng: () => 100.5018 } } }], 'OK');
          };
        }
      }
    };
    vm.runInContext(geocodePlaceQuerySrc, sandbox, { filename: 'preassessment.js (geocodeMapsPlaceQuery excerpt, placeId success)' });
    const result = await sandbox.geocodeMapsPlaceQuery({ query: '123 Sukhumvit Rd', placeId: 'ChIJtest12345' });
    assert(result && result.lat === 13.7563 && result.lng === 100.5018, `resolves coordinates on success (got ${JSON.stringify(result)})`);
    assert(capturedRequest && capturedRequest.placeId === 'ChIJtest12345', `prefers placeId over address text when both are known (got ${JSON.stringify(capturedRequest)})`);
  }

  // Success via address text only (no placeId).
  {
    const { sandbox } = buildSandbox();
    let capturedRequest = null;
    sandbox.window.google = {
      maps: {
        Geocoder: function Geocoder() {
          this.geocode = (request, cb) => {
            capturedRequest = request;
            cb([{ geometry: { location: { lat: () => 13.72, lng: () => 100.53 } } }], 'OK');
          };
        }
      }
    };
    vm.runInContext(geocodePlaceQuerySrc, sandbox, { filename: 'preassessment.js (geocodeMapsPlaceQuery excerpt, address success)' });
    const result = await sandbox.geocodeMapsPlaceQuery({ query: '456 Silom Rd', placeId: '' });
    assert(result && result.lat === 13.72, `resolves via address text when no placeId is known (got ${JSON.stringify(result)})`);
    assert(capturedRequest && capturedRequest.address === '456 Silom Rd' && !('placeId' in capturedRequest), `sends { address } request, not a stray empty placeId (got ${JSON.stringify(capturedRequest)})`);
  }

  // Geocoder reports a failure status (e.g. ZERO_RESULTS) -- must resolve null, never throw/guess.
  {
    const { sandbox } = buildSandbox();
    sandbox.window.google = {
      maps: {
        Geocoder: function Geocoder() {
          this.geocode = (request, cb) => cb(null, 'ZERO_RESULTS');
        }
      }
    };
    vm.runInContext(geocodePlaceQuerySrc, sandbox, { filename: 'preassessment.js (geocodeMapsPlaceQuery excerpt, ZERO_RESULTS)' });
    const result = await sandbox.geocodeMapsPlaceQuery({ query: 'nonexistent place asdkjasd', placeId: '' });
    assert(result === null, `ZERO_RESULTS/failure status => resolves null, never guesses (got ${JSON.stringify(result)})`);
  }

  // Geocoder/SDK not loaded at all -- must resolve null, never throw.
  {
    const { sandbox } = buildSandbox();
    vm.runInContext(geocodePlaceQuerySrc, sandbox, { filename: 'preassessment.js (geocodeMapsPlaceQuery excerpt, no SDK)' });
    let threw = null;
    let result;
    try { result = await sandbox.geocodeMapsPlaceQuery({ query: 'anything', placeId: '' }); } catch (e) { threw = e; }
    assert(!threw, `no google.maps.Geocoder available => does not throw (got ${threw && threw.message})`);
    assert(result === null, `no SDK => resolves null (got ${JSON.stringify(result)})`);
  }
}

console.log('\n=== setMapsLinkFromCoords(lat, lng, opts): the shared write path ===');
{
  const { sandbox, elements, previewCalls } = buildSandbox();
  vm.runInContext(buildLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
  vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
  vm.runInContext(setCoordsSrc, sandbox, { filename: 'preassessment.js (setMapsLinkFromCoords excerpt)' });

  sandbox.setMapsLinkFromCoords(13.7563, 100.5018);
  assert(elements['ci-maps'].value === 'https://www.google.com/maps/search/?api=1&query=13.7563,100.5018', `fills ci-maps correctly (got ${elements['ci-maps'].value})`);
  assert(previewCalls.length === 1 && previewCalls[0].lat === 13.7563, `recenterMap defaults to true -- showMapsPreview() called (got ${JSON.stringify(previewCalls)})`);

  previewCalls.length = 0;
  sandbox.setMapsLinkFromCoords(14.0, 101.0, { recenterMap: false });
  assert(previewCalls.length === 0, 'recenterMap:false => showMapsPreview() NOT called (used by the map-drag handler itself, to avoid re-centering under the user\'s own drag)');

  // Fail closed: invalid coordinates must never partially write a garbage link.
  elements['ci-maps'].value = 'https://untouched';
  for (const bad of [[NaN, 100.5], [13.7, Infinity], [undefined, 100.5], ['13.7', 100.5]]) {
    previewCalls.length = 0;
    sandbox.setMapsLinkFromCoords(bad[0], bad[1]);
    assert(elements['ci-maps'].value === 'https://untouched', `invalid coords [${bad}] => ci-maps left untouched, no garbage written (got "${elements['ci-maps'].value}")`);
    assert(previewCalls.length === 0, `invalid coords [${bad}] => map is not touched either`);
  }
}

console.log('\n=== setMapsLinkFromCoords(lat, lng): background reverse-geocode upgrade ===');
{
  // GPS/drag has no name up front (bare coordinate link opens Google Maps
  // almost empty -- Plus Code + "Add missing place", reported as looking
  // broken, 2026-09-04). Success should silently upgrade ci-maps to a real
  // named-place link once the reverse-geocode resolves.
  {
    const { sandbox, elements, previewCalls } = buildSandbox();
    sandbox.window.google = {
      maps: {
        Geocoder: function Geocoder() {
          this.geocode = (request, cb) => {
            assert(request.location && request.location.lat === 13.7563 && request.location.lng === 100.5018,
              `reverseGeocodeLatLng sends { location: {lat,lng} } (got ${JSON.stringify(request)})`);
            cb([{ formatted_address: '99 Reverse-Geocoded Rd, Bangkok', place_id: 'ChIJreverse999' }], 'OK');
          };
        }
      }
    };
    vm.runInContext(buildLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
    vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
    vm.runInContext(setCoordsSrc, sandbox, { filename: 'preassessment.js (setMapsLinkFromCoords excerpt)' });

    sandbox.setMapsLinkFromCoords(13.7563, 100.5018);
    assert(elements['ci-maps'].value === 'https://www.google.com/maps/search/?api=1&query=13.7563,100.5018',
      `starts with the coordinate link immediately, no blocking on the geocode (got ${elements['ci-maps'].value})`);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(elements['ci-maps'].value === 'https://www.google.com/maps/search/?api=1&query=99%20Reverse-Geocoded%20Rd%2C%20Bangkok&query_place_id=ChIJreverse999',
      `upgrades to a named-place link once the reverse-geocode resolves (got ${elements['ci-maps'].value})`);
  }

  // Failure (no match / no SDK) must leave the coordinate link exactly as-is -- never guess.
  {
    const { sandbox, elements } = buildSandbox();
    vm.runInContext(buildLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
    vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
    vm.runInContext(setCoordsSrc, sandbox, { filename: 'preassessment.js (setMapsLinkFromCoords excerpt)' });

    sandbox.setMapsLinkFromCoords(13.7563, 100.5018);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(elements['ci-maps'].value === 'https://www.google.com/maps/search/?api=1&query=13.7563,100.5018',
      `no SDK => stays on the coordinate link, no crash (got ${elements['ci-maps'].value})`);
  }

  // A newer edit (user typed/pasted something else) while the geocode was in
  // flight must win -- the async upgrade must not clobber it.
  {
    const { sandbox, elements } = buildSandbox();
    sandbox.window.google = {
      maps: {
        Geocoder: function Geocoder() {
          this.geocode = (request, cb) => cb([{ formatted_address: 'Should Not Apply', place_id: '' }], 'OK');
        }
      }
    };
    vm.runInContext(buildLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
    vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
    vm.runInContext(setCoordsSrc, sandbox, { filename: 'preassessment.js (setMapsLinkFromCoords excerpt)' });

    sandbox.setMapsLinkFromCoords(13.7563, 100.5018);
    elements['ci-maps'].value = 'https://pasted-by-user-meanwhile';
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(elements['ci-maps'].value === 'https://pasted-by-user-meanwhile',
      `a newer edit during the geocode wins, async upgrade does not clobber it (got ${elements['ci-maps'].value})`);
  }
}

console.log('\n=== applyGooglePlaceToMapsField(place): scoped to ci-maps only ===');
{
  const { sandbox, elements, previewCalls } = buildSandbox();
  elements['ci-addr'] = makeInputEl('Original Address Typed By User');
  elements['ci-postal'] = makeInputEl('10110');
  vm.runInContext(buildLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
  vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
  vm.runInContext(setCoordsSrc, sandbox, { filename: 'preassessment.js (setMapsLinkFromCoords excerpt)' });
  vm.runInContext(applyPlaceSrc, sandbox, { filename: 'preassessment.js (applyGooglePlaceToMapsField excerpt)' });

  const place = {
    formatted_address: '123 Sukhumvit Rd, Bangkok',
    place_id: 'ChIJtest12345',
    address_components: [{ types: ['postal_code'], long_name: '99999' }],
    geometry: { location: { lat: () => 13.7563, lng: () => 100.5018 } }
  };
  sandbox.applyGooglePlaceToMapsField(place);

  // A search selection has a real place name -- must produce the "Place
  // Search" link (opens looking exactly like a normal Google Maps result:
  // name, photo, card), not a bare coordinate pin (2026-08-25, "want it to
  // look exactly like Google Maps" follow-up).
  assert(elements['ci-maps'].value === 'https://www.google.com/maps/search/?api=1&query=123%20Sukhumvit%20Rd%2C%20Bangkok&query_place_id=ChIJtest12345',
    `ci-maps filled with a named-place link, not raw coordinates (got ${elements['ci-maps'].value})`);
  assert(elements['ci-addr'].value === 'Original Address Typed By User', `ci-addr is NOT touched (got "${elements['ci-addr'].value}")`);
  assert(elements['ci-postal'].value === '10110', `ci-postal is NOT touched either (got "${elements['ci-postal'].value}")`);
  assert(previewCalls.length === 1, 'map preview is shown/updated for the selected place');

  // A place without a place_id (rare, but Autocomplete doesn't guarantee
  // one for every result type) must still produce a valid named link, just
  // without the &query_place_id= suffix.
  const { sandbox: sandbox2, elements: elements2 } = buildSandbox();
  vm.runInContext(buildLinkSrc, sandbox2, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
  vm.runInContext(buildPlaceLinkSrc, sandbox2, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
  vm.runInContext(setCoordsSrc, sandbox2, { filename: 'preassessment.js (setMapsLinkFromCoords excerpt)' });
  vm.runInContext(applyPlaceSrc, sandbox2, { filename: 'preassessment.js (applyGooglePlaceToMapsField excerpt, no place_id)' });
  sandbox2.applyGooglePlaceToMapsField({
    formatted_address: '456 Silom Rd, Bangkok',
    geometry: { location: { lat: () => 13.72, lng: () => 100.53 } }
  });
  assert(elements2['ci-maps'].value === 'https://www.google.com/maps/search/?api=1&query=456%20Silom%20Rd%2C%20Bangkok',
    `no place_id => still a valid named-place link, just without &query_place_id= (got ${elements2['ci-maps'].value})`);

  // A place with geometry but no name at all (edge case) must still fall
  // back to a coordinate link -- never write an empty/broken query.
  const { sandbox: sandbox3, elements: elements3 } = buildSandbox();
  vm.runInContext(buildLinkSrc, sandbox3, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
  vm.runInContext(buildPlaceLinkSrc, sandbox3, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
  vm.runInContext(setCoordsSrc, sandbox3, { filename: 'preassessment.js (setMapsLinkFromCoords excerpt)' });
  vm.runInContext(applyPlaceSrc, sandbox3, { filename: 'preassessment.js (applyGooglePlaceToMapsField excerpt, no name)' });
  sandbox3.applyGooglePlaceToMapsField({
    geometry: { location: { lat: () => 13.72, lng: () => 100.53 } }
  });
  assert(elements3['ci-maps'].value === 'https://www.google.com/maps/search/?api=1&query=13.72,100.53',
    `no name at all => falls back to coordinate link (got ${elements3['ci-maps'].value})`);

  let threw = null;
  try { sandbox.applyGooglePlaceToMapsField({}); } catch (e) { threw = e; }
  assert(!threw, `a place with no geometry does not throw (got ${threw && threw.message})`);
}

console.log('\n=== useMyLocationForMaps(): GPS success + graceful fallback ===');
{
  // --- success: valid coordinates fill an accurate link and show the map ---
  {
    const { sandbox, elements, toasts, previewCalls } = buildSandbox();
    sandbox.navigator.geolocation = {
      getCurrentPosition: (onSuccess) => onSuccess({ coords: { latitude: 13.7563, longitude: 100.5018 } })
    };
    sandbox.wireMapsLinkPlaceSearch = async () => {}; // SDK-loading is out of scope for this focused test
    vm.runInContext(buildLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
  vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
    vm.runInContext(setCoordsSrc, sandbox, { filename: 'preassessment.js (setMapsLinkFromCoords excerpt)' });
    vm.runInContext(useLocationSrc, sandbox, { filename: 'preassessment.js (useMyLocationForMaps excerpt)' });
    await sandbox.useMyLocationForMaps();
    // getCurrentPosition's callback is async (awaits wireMapsLinkPlaceSearch); let it settle.
    await new Promise(r => setTimeout(r, 0));
    assert(elements['ci-maps'].value === 'https://www.google.com/maps/search/?api=1&query=13.7563,100.5018', `success => ci-maps filled (got ${elements['ci-maps'].value})`);
    assert(toasts.length === 0, 'success => no error toast shown');
    assert(previewCalls.length === 1, 'success => map preview shown');
  }

  // --- denied / unavailable / timeout: all treated the same, graceful fallback ---
  for (const scenario of ['denied', 'unavailable', 'timeout']) {
    const { sandbox, elements, toasts } = buildSandbox();
    sandbox.navigator.geolocation = {
      getCurrentPosition: (onSuccess, onError) => onError({ code: scenario })
    };
    sandbox.wireMapsLinkPlaceSearch = async () => {};
    vm.runInContext(buildLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
  vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
    vm.runInContext(setCoordsSrc, sandbox, { filename: 'preassessment.js (setMapsLinkFromCoords excerpt)' });
    vm.runInContext(useLocationSrc, sandbox, { filename: `preassessment.js (useMyLocationForMaps excerpt, ${scenario})` });
    sandbox.useMyLocationForMaps();
    assert(elements['ci-maps'].value === '', `${scenario} => ci-maps left untouched (got "${elements['ci-maps'].value}")`);
    assert(toasts.length === 1, `${scenario} => exactly one graceful fallback toast shown (got ${toasts.length})`);
  }

  // --- unsupported browser: navigator.geolocation missing entirely ---
  {
    const { sandbox, elements, toasts } = buildSandbox();
    vm.runInContext(buildLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
  vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
    vm.runInContext(setCoordsSrc, sandbox, { filename: 'preassessment.js (setMapsLinkFromCoords excerpt)' });
    vm.runInContext(useLocationSrc, sandbox, { filename: 'preassessment.js (useMyLocationForMaps excerpt, unsupported)' });
    let threw = null;
    try { sandbox.useMyLocationForMaps(); } catch (e) { threw = e; }
    assert(!threw, `unsupported browser does not throw (got ${threw && threw.message})`);
    assert(elements['ci-maps'].value === '', 'unsupported browser => ci-maps left untouched');
    assert(toasts.length === 1, 'unsupported browser => graceful fallback toast shown');
  }

  // --- malformed position (defensive: non-finite coords from a broken polyfill) ---
  {
    const { sandbox, elements, toasts } = buildSandbox();
    sandbox.navigator.geolocation = {
      getCurrentPosition: (onSuccess) => onSuccess({ coords: { latitude: NaN, longitude: 100.5 } })
    };
    sandbox.wireMapsLinkPlaceSearch = async () => {};
    vm.runInContext(buildLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsSearchLink excerpt)' });
  vm.runInContext(buildPlaceLinkSrc, sandbox, { filename: 'preassessment.js (buildMapsPlaceLink excerpt)' });
    vm.runInContext(setCoordsSrc, sandbox, { filename: 'preassessment.js (setMapsLinkFromCoords excerpt)' });
    vm.runInContext(useLocationSrc, sandbox, { filename: 'preassessment.js (useMyLocationForMaps excerpt, malformed)' });
    sandbox.useMyLocationForMaps();
    assert(elements['ci-maps'].value === '', `malformed coords => ci-maps NOT filled with garbage (got "${elements['ci-maps'].value}")`);
    assert(toasts.length === 1, 'malformed coords => graceful fallback toast shown');
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('UNCAUGHT', e);
  console.error(e.stack);
  process.exit(1);
});
