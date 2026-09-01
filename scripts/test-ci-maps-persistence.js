/**
 * Regression suite for the ci-maps (Google Maps Link) Notion-persistence fix
 * (2026-08-31 root cause: fields['ci-maps'] was never extracted by
 * mapPreassessmentPayload(), never in CUSTOMER_INPUT_FIELDS, and had no
 * FIELD_ALIASES entry -- so it was silently dropped before ever reaching
 * Notion, regardless of whether a matching column existed).
 *
 * Same technique as the existing analogous test for another additive/
 * optional field, tests/publish/compliance-persistence.test.js: pure mapper
 * functions only (mapPreassessmentPayload, buildNotionProperties,
 * notionPageToJob) -- no live Notion access, no Case created, no LINE sent.
 *
 * Run: node scripts/test-ci-maps-persistence.js
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { mapPreassessmentPayload } = require(path.join(ROOT, 'services/case-creation-service.js'));
const { buildNotionProperties } = require(path.join(ROOT, 'services/notion/clients.js'));
const { notionPageToJob } = require(path.join(ROOT, 'services/notion/mapper.js'));

let passed = 0;
let failed = 0;
function assert(cond, msg, detail) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); }
}

const NAMED_PLACE_LINK = 'https://www.google.com/maps/search/?api=1&query=Wat%20Ratchanadaram%20Worawihan%2C%20Bangkok&query_place_id=ChIJtest12345';
const COORD_LINK = 'https://www.google.com/maps/search/?api=1&query=13.7563,100.5018';

const SCHEMA_WITH_COLUMN = {
  'Maps Link': { type: 'rich_text' },
  'Full Name': { type: 'title' },
  'Address': { type: 'rich_text' },
  'Phone': { type: 'phone_number' }
};
const SCHEMA_WITH_URL_COLUMN = {
  'Maps Link': { type: 'url' },
  'Full Name': { type: 'title' }
};
const SCHEMA_WITHOUT_COLUMN = {
  'Full Name': { type: 'title' },
  'Address': { type: 'rich_text' },
  'Phone': { type: 'phone_number' }
};

console.log('=== A: mapPreassessmentPayload extracts ci-maps correctly ===');
{
  const payload = mapPreassessmentPayload({
    fields: {
      'ci-fname': 'John', 'ci-lname': 'Doe', 'ci-addr': '123 Main St',
      'ci-maps': NAMED_PLACE_LINK
    }
  });
  assert(payload.mapsLink === NAMED_PLACE_LINK, 'mapsLink extracted from fields[\'ci-maps\'] unchanged (named-place format preserved byte-for-byte)', payload.mapsLink);
  assert(payload.address === '123 Main St', 'other fields (address) still map correctly alongside it', payload.address);
}
{
  const payload = mapPreassessmentPayload({ fields: { 'ci-fname': 'Jane' } });
  assert(!('mapsLink' in payload), 'absent ci-maps -> mapsLink key omitted entirely (pickCustomerInput drops empty values, existing behavior)', payload);
}
{
  // Coordinate-only format (the older link shape) must also pass through unmangled.
  const payload = mapPreassessmentPayload({ fields: { 'ci-fname': 'Jane', 'ci-maps': COORD_LINK } });
  assert(payload.mapsLink === COORD_LINK, 'coordinate-only link format also preserved unchanged', payload.mapsLink);
}

console.log('\n=== B: buildNotionProperties writes to "Maps Link" when the column exists ===');
{
  const properties = buildNotionProperties({ fullName: 'John Doe', mapsLink: NAMED_PLACE_LINK }, SCHEMA_WITH_COLUMN);
  assert(properties['Maps Link']?.rich_text?.[0]?.text?.content === NAMED_PLACE_LINK, 'writes the full named-place link into the rich_text column, untruncated', properties['Maps Link']);
}
{
  // Same value, but the column happens to be typed `url` instead of `rich_text`.
  const properties = buildNotionProperties({ fullName: 'John Doe', mapsLink: NAMED_PLACE_LINK }, SCHEMA_WITH_URL_COLUMN);
  assert(properties['Maps Link']?.url === NAMED_PLACE_LINK, 'writes correctly to a `url`-typed column too, no code branching needed', properties['Maps Link']);
}

console.log('\n=== C: no Notion column yet -> safe no-op, no crash, other fields unaffected ===');
{
  let threw = null;
  let properties = null;
  try {
    properties = buildNotionProperties({ fullName: 'John Doe', address: '123 Main St', mapsLink: NAMED_PLACE_LINK }, SCHEMA_WITHOUT_COLUMN);
  } catch (e) { threw = e; }
  assert(!threw, 'buildNotionProperties does not throw when the Maps Link column is missing', threw && threw.message);
  assert(properties['Maps Link'] === undefined, 'no stray "Maps Link" property is written when the column does not exist', properties);
  assert(properties['Address']?.rich_text?.[0]?.text?.content === '123 Main St', 'Address still writes normally -- this field being absent does not block others', properties['Address']);
  assert(properties['Full Name']?.title?.[0]?.text?.content === 'John Doe', 'Full Name still writes normally too', properties['Full Name']);
}

console.log('\n=== D: existing customer fields (address/phone/etc.) unaffected -- no behavior change ===');
{
  const payload = mapPreassessmentPayload({
    fields: {
      'ci-fname': 'John', 'ci-lname': 'Doe', 'ci-phone': '0812345678',
      'ci-email': 'john@example.com', 'ci-addr': '123 Main St', 'ci-city': 'Bangkok', 'ci-postal': '10110'
    }
  });
  assert(payload.fullName === 'John Doe', 'fullName unaffected', payload.fullName);
  assert(payload.phone === '0812345678', 'phone unaffected', payload.phone);
  assert(payload.email === 'john@example.com', 'email unaffected', payload.email);
  assert(payload.address === '123 Main St, Bangkok, 10110', 'address composition unaffected', payload.address);
}

console.log('\n=== E: read side -- notionPageToJob hydrates ci-maps back from a "Maps Link" page property ===');
function fakePage(mapsLinkValue, { includeColumn = true, columnType = 'rich_text' } = {}) {
  const properties = {
    'Full Name': { type: 'title', title: [{ type: 'text', text: { content: 'John Doe' }, plain_text: 'John Doe' }] },
    'Address': { type: 'rich_text', rich_text: [{ type: 'text', text: { content: '123 Main St' }, plain_text: '123 Main St' }] }
  };
  if (includeColumn) {
    properties['Maps Link'] = columnType === 'url'
      ? { type: 'url', url: mapsLinkValue }
      : { type: 'rich_text', rich_text: [{ type: 'text', text: { content: mapsLinkValue }, plain_text: mapsLinkValue }] };
  }
  return { id: 'fake-page-id', created_time: '2026-08-10T00:00:00.000Z', properties };
}

{
  const job = notionPageToJob(fakePage(NAMED_PLACE_LINK), 0);
  assert(job.draft.fields['ci-maps'] === NAMED_PLACE_LINK, 'ci-maps hydrates back from the "Maps Link" rich_text column, unchanged', job.draft.fields['ci-maps']);
}
{
  const job = notionPageToJob(fakePage(NAMED_PLACE_LINK, { columnType: 'url' }), 0);
  assert(job.draft.fields['ci-maps'] === NAMED_PLACE_LINK, 'ci-maps hydrates back from a `url`-typed column too', job.draft.fields['ci-maps']);
}
{
  // A Case created/loaded before this fix existed (or on a database that
  // still has no Maps Link column at all) must hydrate to an empty string,
  // never crash, never fabricate a value.
  const job = notionPageToJob(fakePage(null, { includeColumn: false }), 0);
  assert(job.draft.fields['ci-maps'] === '', 'no Maps Link column at all -> ci-maps hydrates to empty string, no crash, no fabricated value', job.draft.fields['ci-maps']);
  assert(job.draft.fields['ci-addr'] === '123 Main St', 'other fields still hydrate normally when Maps Link column is absent', job.draft.fields['ci-addr']);
}

console.log('\n=== F: full round trip -- write then read back gives byte-identical value ===');
function withReadTypes(writeProperties, schema) {
  const out = {};
  Object.keys(writeProperties).forEach(key => {
    const type = schema[key]?.type;
    out[key] = { type, ...writeProperties[key] };
  });
  return out;
}
{
  const writeProperties = buildNotionProperties({ fullName: 'John Doe', mapsLink: NAMED_PLACE_LINK }, SCHEMA_WITH_COLUMN);
  const page = { id: 'rt', created_time: '2026-08-10T00:00:00.000Z', properties: withReadTypes(writeProperties, SCHEMA_WITH_COLUMN) };
  const job = notionPageToJob(page, 0);
  assert(job.draft.fields['ci-maps'] === NAMED_PLACE_LINK, 'full round trip (mapPreassessmentPayload shape -> buildNotionProperties -> notionPageToJob) preserves the named-place link exactly', job.draft.fields['ci-maps']);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
