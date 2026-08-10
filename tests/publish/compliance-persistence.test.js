/**
 * Compliance-status persistence round trip (M14 hardening).
 * Proves complianceStatus survives compute -> Notion write mapping ->
 * Notion read mapping, for PASS/WARNING/FAIL, and that the field is fully
 * additive/inert when the Notion database has no matching column yet.
 * No live Notion access — pure mapper functions only.
 * Run: node tests/publish/compliance-persistence.test.js
 */
const path = require('path');
const { buildNotionProperties } = require(path.join(__dirname, '../../services/notion/clients.js'));
const { FIELD_ALIASES, notionPageToJob } = require(path.join(__dirname, '../../services/notion/mapper.js'));

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok  ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const SCHEMA_WITH_COLUMN = {
  'Compliance Status': { type: 'select' },
  'Latest Water Score': { type: 'number' },
  'Result Summary': { type: 'rich_text' }
};

const SCHEMA_WITHOUT_COLUMN = {
  'Latest Water Score': { type: 'number' },
  'Result Summary': { type: 'rich_text' }
};

// ---- Write side: PASS / WARNING / FAIL each map to the Notion select property ----
for (const status of ['PASS', 'WARNING', 'FAIL']) {
  const properties = buildNotionProperties({ complianceStatus: status, latestWaterScore: 85 }, SCHEMA_WITH_COLUMN);
  assert(
    properties['Compliance Status']?.select?.name === status,
    `buildNotionProperties writes complianceStatus=${status} to the "Compliance Status" select column`
  );
}

// ---- Write side: additive/inert when the column doesn't exist yet ----
{
  const properties = buildNotionProperties({ complianceStatus: 'FAIL', latestWaterScore: 85 }, SCHEMA_WITHOUT_COLUMN);
  assert(
    properties['Compliance Status'] === undefined,
    'buildNotionProperties silently skips complianceStatus when no matching Notion column exists (no crash, no stray property)'
  );
  assert(
    properties['Latest Water Score']?.number === 85,
    'score still writes normally even when complianceStatus is dropped'
  );
}

// ---- Write side: absent/undefined complianceStatus never writes a property ----
{
  const properties = buildNotionProperties({ latestWaterScore: 85 }, SCHEMA_WITH_COLUMN);
  assert(
    properties['Compliance Status'] === undefined,
    'omitting complianceStatus from the payload writes nothing (existing callers unaffected)'
  );
}

// ---- Read side: round-trips PASS / WARNING / FAIL back out of a Notion page ----
function fakePage(status) {
  return {
    id: 'fake-page-id',
    created_time: '2026-08-10T00:00:00.000Z',
    properties: {
      'Compliance Status': { type: 'select', select: { name: status } },
      'Latest Water Score': { type: 'number', number: 85 },
      'Result Summary': { type: 'rich_text', rich_text: [{ type: 'text', text: { content: 'Water score 85/100' }, plain_text: 'Water score 85/100' }] }
    }
  };
}

for (const status of ['PASS', 'WARNING', 'FAIL']) {
  const job = notionPageToJob(fakePage(status), 0);
  assert(
    job.result.complianceStatus === status,
    `notionPageToJob reads complianceStatus=${status} back into job.result (this is what /r/{token} and /api/report/:token serve)`
  );
}

// ---- Read side: absent column reads as null, not a crash or a false PASS ----
{
  const page = fakePage('PASS');
  delete page.properties['Compliance Status'];
  const job = notionPageToJob(page, 0);
  assert(
    job.result.complianceStatus === null,
    'a case published before this field existed reads back complianceStatus=null, never a fabricated status'
  );
}

// ---- Full round trip: compute -> write payload -> read payload -> identical status ----
// (Notion's write API accepts `{select: {name}}` without a `type` key; a
// subsequent read echoes the schema-defined `type` alongside it — mirror
// that here rather than assuming the write shape is also the read shape.)
function withReadTypes(writeProperties, schema) {
  const out = {};
  Object.keys(writeProperties).forEach(key => {
    out[key] = { type: schema[key]?.type, ...writeProperties[key] };
  });
  return out;
}

for (const status of ['PASS', 'WARNING', 'FAIL']) {
  const writeProperties = buildNotionProperties({ complianceStatus: status, latestWaterScore: 85 }, SCHEMA_WITH_COLUMN);
  const page = { id: 'rt', created_time: '2026-08-10T00:00:00.000Z', properties: withReadTypes(writeProperties, SCHEMA_WITH_COLUMN) };
  const job = notionPageToJob(page, 0);
  assert(
    job.result.complianceStatus === status,
    `full round trip preserves complianceStatus=${status} (compute -> Notion properties -> read-back)`
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
