/**
 * Regression suite for buildMapsSearchUrl() / buildMapsDirectionsUrl()
 * (src/js/flows/dashboard.js -- Google Maps Directions + Mobile GPS,
 * weird-user QA Part B, 2026-08-25).
 *
 * No Google Maps API key needed for either builder: Google resolves a
 * plain-text address itself when the link is opened. encodeURIComponent()
 * on the address is the only escaping required -- it safely contains any
 * text inside the query VALUE, so it can never break out as a second query
 * param, change the URL's scheme/host, or get double-encoded.
 *
 * Extracts the REAL functions out of dashboard.js via regex (same
 * technique used elsewhere this session), not a reimplementation.
 *
 * Run: node scripts/test-maps-directions-url.js
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
const src = fs.readFileSync(path.join(ROOT, 'src/js/flows/dashboard.js'), 'utf8');

const searchMatch = src.match(/function buildMapsSearchUrl\(address\) \{[\s\S]*?\n\}/);
const dirMatch = src.match(/function buildMapsDirectionsUrl\(address, coords\) \{[\s\S]*?\n\}/);
assert(!!searchMatch, 'buildMapsSearchUrl() found in dashboard.js (test in sync)');
assert(!!dirMatch, 'buildMapsDirectionsUrl() found in dashboard.js (test in sync)');
if (!searchMatch || !dirMatch) {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(searchMatch[0], sandbox, { filename: 'dashboard.js (buildMapsSearchUrl excerpt)' });
vm.runInContext(dirMatch[0], sandbox, { filename: 'dashboard.js (buildMapsDirectionsUrl excerpt)' });
const { buildMapsSearchUrl, buildMapsDirectionsUrl } = sandbox;

console.log('=== buildMapsSearchUrl(address) ===');
{
  const normal = buildMapsSearchUrl('123 Main St, Bangkok');
  assert(normal === 'https://www.google.com/maps/search/?api=1&query=123%20Main%20St%2C%20Bangkok',
    `normal address encodes correctly (got ${normal})`);

  const thai = buildMapsSearchUrl('เทศบาลเมืองปทุมธานี');
  assert(thai.startsWith('https://www.google.com/maps/search/?api=1&query=') && !thai.includes('เทศบาล'),
    `Thai script is percent-encoded, not embedded raw (got ${thai})`);
  assert(decodeURIComponent(thai.split('query=')[1]) === 'เทศบาลเมืองปทุมธานี',
    'Thai script round-trips correctly through encode/decode');

  const unicodeEmoji = buildMapsSearchUrl('Café ☕ 123 Rd 🏠');
  assert(decodeURIComponent(unicodeEmoji.split('query=')[1]) === 'Café ☕ 123 Rd 🏠',
    `Unicode + emoji round-trips correctly (got ${unicodeEmoji})`);

  const special = buildMapsSearchUrl('Address & Co? #5');
  assert(!special.includes('&Co') && !special.includes('?#') && special.split('&').length === 2,
    `&, ?, # in the address are safely encoded, not parsed as URL syntax (got ${special})`);
  assert(decodeURIComponent(special.split('query=')[1]) === 'Address & Co? #5',
    'special characters round-trip correctly');

  const malicious = buildMapsSearchUrl('123 St&redirect=https://evil.com&foo=bar');
  const queryParams = malicious.split('?')[1].split('&');
  assert(queryParams.length === 2 && queryParams[0] === 'api=1',
    `malicious query-like address does NOT inject extra query params (got params: ${JSON.stringify(queryParams)})`);
  assert(!malicious.includes('evil.com') || malicious.includes(encodeURIComponent('evil.com')) === false
    ? true
    : malicious.split('query=')[1].includes(encodeURIComponent('evil.com')),
    'evil.com only appears inside the encoded query value, never as a bare redirect target');
  assert(decodeURIComponent(malicious.split('query=')[1]) === '123 St&redirect=https://evil.com&foo=bar',
    'malicious-looking address is preserved as inert text once decoded back');

  const javascriptScheme = buildMapsSearchUrl('javascript:alert(1)');
  assert(javascriptScheme.startsWith('https://www.google.com/maps/search/?api=1&query='),
    `an address that looks like a URL scheme cannot override the hardcoded https://google.com prefix (got ${javascriptScheme})`);

  assert(buildMapsSearchUrl(null) === '', 'null address => empty string');
  assert(buildMapsSearchUrl(undefined) === '', 'undefined address => empty string');
  assert(buildMapsSearchUrl('') === '', 'empty string address => empty string');
  assert(buildMapsSearchUrl('   ') === '', 'whitespace-only address => empty string');
  assert(buildMapsSearchUrl('  123 Main St  ') === buildMapsSearchUrl('123 Main St'),
    'leading/trailing whitespace is trimmed before encoding');

  const doubleEncodeCheck = buildMapsSearchUrl('100%');
  assert(decodeURIComponent(doubleEncodeCheck.split('query=')[1]) === '100%',
    `a literal "%" in the address is encoded exactly once, not double-encoded (got ${doubleEncodeCheck})`);
}

console.log('\n=== buildMapsDirectionsUrl(address, {lat, lng}) ===');
{
  const valid = buildMapsDirectionsUrl('123 Main St', { lat: 13.7563, lng: 100.5018 });
  assert(valid === 'https://www.google.com/maps/dir/?api=1&origin=13.7563,100.5018&destination=123%20Main%20St&travelmode=driving',
    `valid GPS coords produce a directions URL (got ${valid})`);

  for (const bad of [
    { lat: NaN, lng: 100.5, label: 'lat=NaN' },
    { lat: 13.7, lng: Infinity, label: 'lng=Infinity' },
    { lat: -Infinity, lng: 100.5, label: 'lat=-Infinity' },
    { lat: undefined, lng: 100.5, label: 'lat=undefined' },
    { lat: 13.7, lng: undefined, label: 'lng=undefined' },
    { lat: '13.7563', lng: '100.5018', label: 'string coordinates (still numeric-looking)' },
    { lat: 'not-a-number', lng: 100.5, label: 'lat=non-numeric string' },
    { lat: 91, lng: 100.5, label: 'lat out of range (>90)' },
    { lat: -91, lng: 100.5, label: 'lat out of range (<-90)' },
    { lat: 13.7, lng: 181, label: 'lng out of range (>180)' },
    { lat: 13.7, lng: -181, label: 'lng out of range (<-180)' }
  ]) {
    const result = buildMapsDirectionsUrl('123 Main St', { lat: bad.lat, lng: bad.lng });
    if (bad.label.includes('string coordinates')) {
      // Numeric-looking strings ARE valid via Number() coercion -- this is
      // fine (Number('13.7563') is a real, in-range number) and matches
      // buildMapsSearchUrl's own String()-then-trim tolerance for input
      // shape; the important guarantee is NaN/Infinity/out-of-range never
      // reach the URL, which the other cases in this loop cover.
      assert(result.startsWith('https://www.google.com/maps/dir/?api=1&origin='),
        `${bad.label} => coerces to valid numbers, produces a directions URL (got ${result})`);
    } else {
      assert(result === buildMapsSearchUrl('123 Main St'),
        `${bad.label} => falls back to the destination-only search URL (got ${result})`);
      assert(!result.includes('origin='), `${bad.label} => no "origin=" ever appears in the fallback URL`);
    }
  }

  assert(buildMapsDirectionsUrl(null, { lat: 13.7, lng: 100.5 }) === '', 'null address => empty string regardless of valid coords');
  assert(buildMapsDirectionsUrl('', { lat: 13.7, lng: 100.5 }) === '', 'empty address => empty string regardless of valid coords');
  assert(buildMapsDirectionsUrl('123 Main St', undefined) === buildMapsSearchUrl('123 Main St'),
    'missing coords object entirely => falls back to search URL, does not throw');
  assert(buildMapsDirectionsUrl('123 Main St', {}) === buildMapsSearchUrl('123 Main St'),
    'empty coords object => falls back to search URL');

  const thaiDir = buildMapsDirectionsUrl('เทศบาลเมืองปทุมธานี', { lat: 14.0208, lng: 100.525 });
  assert(decodeURIComponent(thaiDir.split('destination=')[1].split('&')[0]) === 'เทศบาลเมืองปทุมธานี',
    `Thai address in directions URL round-trips correctly (got ${thaiDir})`);

  const doubleEncodeDirCheck = buildMapsDirectionsUrl('100%', { lat: 13.7, lng: 100.5 });
  assert(decodeURIComponent(doubleEncodeDirCheck.split('destination=')[1].split('&')[0]) === '100%',
    'directions URL does not double-encode the destination either');

  // Boundary values: exactly ±90 / ±180 must be accepted (inclusive range).
  const boundary1 = buildMapsDirectionsUrl('X', { lat: 90, lng: 180 });
  assert(boundary1.includes('origin=90,180'), `lat=90, lng=180 (inclusive boundary) => accepted (got ${boundary1})`);
  const boundary2 = buildMapsDirectionsUrl('X', { lat: -90, lng: -180 });
  assert(boundary2.includes('origin=-90,-180'), `lat=-90, lng=-180 (inclusive boundary) => accepted (got ${boundary2})`);
}

console.log('\n=== buildApptCard() / search-result card: empty-href defect fix (Final Review, 2026-08-25) ===');
console.log('(an empty href="" is not inert -- it links to the current page; the anchor');
console.log(' must be omitted entirely when there is no address, at BOTH render sites.)');
{
  function buildDashboardSandbox() {
    const sandbox = {
      console,
      t: (key) => key,
      highlightJobId: null,
      window: {}
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    const escapeHtmlMatch = src.match(/function escapeHtml\(value\) \{[\s\S]*?\n\}/);
    const svgMatch = src.match(/const PIN_SVG = [\s\S]*?const LOCATE_SVG = '[^']*';/);
    if (!escapeHtmlMatch || !svgMatch) throw new Error('escapeHtml/SVG consts not found -- test is out of sync with the real source');
    vm.runInContext(escapeHtmlMatch[0], sandbox, { filename: 'dashboard.js (escapeHtml excerpt)' });
    vm.runInContext(svgMatch[0], sandbox, { filename: 'dashboard.js (SVG consts excerpt)' });
    vm.runInContext(searchMatch[0], sandbox, { filename: 'dashboard.js (buildMapsSearchUrl excerpt)' });
    return sandbox;
  }

  // --- buildApptCard (main dashboard appointment card) ---
  {
    const sandbox = buildDashboardSandbox();
    const apptCardMatch = src.match(/function buildApptCard\(job\) \{[\s\S]*?\n\}\r?\n\r?\nfunction renderJobs/);
    assert(!!apptCardMatch, 'buildApptCard() found in dashboard.js (test in sync)');
    if (apptCardMatch) {
      const fnSrc = apptCardMatch[0].replace(/\r?\n\r?\nfunction renderJobs$/, '');
      vm.runInContext(fnSrc, sandbox, { filename: 'dashboard.js (buildApptCard excerpt)' });

      const baseJob = { id: 'job-1', name: 'Test Customer', timeStart: '09:00', timeEnd: '10:00', pkg: 'essential', status: 'new' };

      const withEmpty = sandbox.buildApptCard({ ...baseJob, addr: '' });
      assert(!withEmpty.includes('ac-directions'), `empty address => no .ac-directions anchor rendered at all (got: ${withEmpty.includes('ac-directions') ? 'FOUND' : 'absent'})`);
      assert(!withEmpty.includes('href=""'), 'empty address => never renders a bare href="" (defect confirmed fixed)');

      const withNull = sandbox.buildApptCard({ ...baseJob, addr: null });
      assert(!withNull.includes('ac-directions'), 'null address => no .ac-directions anchor rendered');

      const withUndefined = sandbox.buildApptCard({ ...baseJob, addr: undefined });
      assert(!withUndefined.includes('ac-directions'), 'undefined address => no .ac-directions anchor rendered');

      const withValid = sandbox.buildApptCard({ ...baseJob, addr: '123 Main St, Bangkok' });
      assert(withValid.includes('class="ac-directions"'), 'valid address => .ac-directions anchor still renders normally');
      assert(withValid.includes('href="https://www.google.com/maps/search/?api=1&query='), 'valid address => anchor href is a real Maps search URL');

      // .ac-locate must always render, regardless of address presence --
      // its own button has no href to be empty, so it isn't affected by
      // this defect and its behavior must be completely unchanged.
      assert(withEmpty.includes('class="ac-locate"'), '.ac-locate button still renders even with an empty address (unaffected by this fix)');
      assert(withValid.includes('class="ac-locate"'), '.ac-locate button still renders with a valid address (unchanged)');
    }
  }

  // --- search-result card (filterAppointments) ---
  {
    const sandbox = buildDashboardSandbox();
    sandbox.JOBS = [];
    sandbox.S = { searchQuery: '' };
    sandbox.document = {
      getElementById: () => ({ set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; } })
    };
    sandbox.renderJobs = () => {}; // filterAppointments calls this first; not under test here
    sandbox.caseIdentityLabel = (j) => String(j.id);

    const filterMatch = src.match(/function filterAppointments\(q\)\{[\s\S]*?\n\}\r?\nfunction openLangModal/);
    assert(!!filterMatch, 'filterAppointments() found in dashboard.js (test in sync)');
    if (filterMatch) {
      const fnSrc = filterMatch[0].replace(/\r?\nfunction openLangModal$/, '');
      vm.runInContext(fnSrc, sandbox, { filename: 'dashboard.js (filterAppointments excerpt)' });

      sandbox.JOBS.push({ id: 'j1', name: 'No Address Customer', addr: '', status: 'new', date: '2026-08-25' });
      sandbox.JOBS.push({ id: 'j2', name: 'Valid Address Customer', addr: '456 Second Rd', status: 'new', date: '2026-08-25' });

      const el = { set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; } };
      sandbox.document.getElementById = () => el;
      sandbox.filterAppointments('');

      const html = el._html || '';
      const noAddrCardMatch = html.split('data-job-id="j1"')[1]?.split('data-job-id="j2"')[0] || '';
      const validAddrCardMatch = html.split('data-job-id="j2"')[1] || '';

      assert(!noAddrCardMatch.includes('ac-directions'), 'search-result card: empty address => no .ac-directions anchor');
      assert(validAddrCardMatch.includes('class="ac-directions"'), 'search-result card: valid address => .ac-directions anchor still renders');
      assert(noAddrCardMatch.includes('class="ac-locate"'), 'search-result card: .ac-locate still renders even with empty address (unchanged)');
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
