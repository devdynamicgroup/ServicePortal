'use strict';

/**
 * ============================================================
 *  MANUAL PRODUCTION TOOL -- NOT A REGRESSION TEST
 *  Moved from scripts/test-maps-link-persistence-repro.js on
 *  2026-09-09 (test-script isolation safety pass) -- this exact
 *  filename pattern (test-*.js) being treated as automatically
 *  safe caused a real incident: re-running "the regression
 *  suite" created 3 unwanted production Notion Cases.
 *
 *  Running this script creates ONE real Case in production
 *  Notion every single time (not idempotent) and requires real
 *  operator credentials. See scripts/manual-prod/README.md.
 * ============================================================
 *
 * One-shot bug reproduction, NOT a regression suite: proves ci-maps (Google
 * Maps Link) never reaches Notion at all, via the real production API path
 * (same auth/create/preassessment/reload flow as qa-create-case-line-same-user.js).
 *
 * Root cause (found 2026-08-31 while tracing where to mock a repro case):
 *  - services/case-creation-service.js's CUSTOMER_INPUT_FIELDS allowlist has
 *    no maps-link entry, so submitCustomerPreassessment() silently drops
 *    fields['ci-maps'] before it ever reaches updateClient()/Notion.
 *  - services/notion/mapper.js never reconstructs a ci-maps key either --
 *    there is no backing Notion property for it at all.
 *  - So ci-maps is 100% client-local (localStorage draft.fields only); a
 *    fresh load from Notion (new device, cleared cache, or -- as here --
 *    reading straight back from /api/clients) always comes back without it,
 *    regardless of link format (this is a DIFFERENT, larger gap than the
 *    named-place-link-parsing fix already shipped in bd6bde2e, which only
 *    helps within the same browser session).
 *
 * NOTE (2026-09-08): this specific root cause was fixed -- "Maps Link" now
 * exists in Notion as a real `url`-typed property, and setTextOrUrl() writes
 * it correctly (see project memory project_ci_maps_not_persisted_to_notion).
 * This script is kept only as a repro/verification tool for that class of
 * bug, not because the bug is still believed open -- its own safe-equivalent
 * invariant is covered by scripts/test-address-maps-link-sync.js (pure,
 * no I/O, 13/13 passing) for normal regression purposes.
 *
 * Creates exactly one clearly-labeled Case ("MOCK-TEST-DELETE-ME ..."),
 * dated 2026-09-01. Does not modify any other Case. Prints identifiers for
 * cleanup; does not delete the Case itself (left for explicit cleanup step).
 *
 * Run: node scripts/manual-prod/repro-maps-link-persistence.js
 */

require('dotenv').config({ quiet: true });

const BASE = process.env.E2E_BASE_URL || 'https://serviceportal.onrender.com';
const RENDER_SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-d92btdvaqgkc7397curg';

let cookie = '';

async function api(method, urlPath, body) {
  const r = await fetch(BASE + urlPath, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await r.json(); } catch { /* non-JSON */ }
  return { status: r.status, json, headers: r.headers };
}

async function loadOperatorAuth() {
  if (process.env.E2E_USERNAME && process.env.E2E_PASSWORD) {
    return { username: process.env.E2E_USERNAME, password: process.env.E2E_PASSWORD };
  }
  const key = process.env.RENDER_API_KEY;
  if (!key) throw new Error('Need E2E_USERNAME/E2E_PASSWORD or RENDER_API_KEY');
  const env = await fetch(
    `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars`,
    { headers: { Authorization: `Bearer ${key}` } }
  ).then((r) => r.json());
  const row = (env || []).map((e) => e.envVar || e).find((e) => e.key === 'AUTH_USERS_JSON');
  const users = JSON.parse(row?.value || '[]');
  const user = users.find((u) => u.username && u.password);
  if (!user) throw new Error('AUTH_USERS_JSON has no usable operator');
  return { username: user.username, password: user.password };
}

async function main() {
  const auth = await loadOperatorAuth();
  const login = await api('POST', '/api/auth/login', { username: auth.username, password: auth.password });
  const setCookie = login.headers.get('set-cookie');
  cookie = setCookie ? setCookie.split(';')[0] : '';
  if (login.status !== 200 || !cookie) throw new Error(`login failed status=${login.status}`);
  console.log('AUTH ok as', login.json?.user?.username);

  const suffix = Date.now().toString().slice(-8);
  const fullName = `MOCK-TEST-DELETE-ME MapsLinkRepro ${suffix}`;
  const mockMapsLink = 'https://www.google.com/maps/search/?api=1&query=Wat%20Ratchanadaram%20Worawihan%2C%20Bangkok&query_place_id=ChIJmockPlaceId';

  const create = await api('POST', '/api/cases', {
    fullName,
    address: '2 Maha Chai Rd, Samran Rat, Phra Nakhon, Bangkok 10200',
    phone: '0800000088',
    email: `mock-maps-repro-${suffix}@example.invalid`,
    appointmentDate: '2026-09-01',
    appointmentStart: '10:00',
    appointmentEnd: '11:00',
    startOnSite: false,
    skipMap: true
  });
  if (create.status !== 201 && create.json?.ok === false) {
    throw new Error(`create failed ${create.status} ${JSON.stringify(create.json)}`);
  }
  const caseId = create.json?.case?.id || create.json?.id;
  const notionId = create.json?.case?.notionId || create.json?.notionId;
  console.log('CREATE', { caseId, notionId, fullName, appointmentDate: '2026-09-01' });
  if (!caseId) throw new Error('no caseId returned from create -- cannot proceed');

  // Real client save path: exactly what job-state.js's syncJobProfileToNotion
  // sends -- the whole fields blob, ci-maps included -- to the real
  // preassessment endpoint.
  const preassess = await api('POST', `/api/cases/${encodeURIComponent(caseId)}/preassessment`, {
    fields: {
      'ci-fname': 'MOCK-TEST-DELETE-ME',
      'ci-lname': 'MapsLinkRepro',
      'ci-phone': '0800000088',
      'ci-email': `mock-maps-repro-${suffix}@example.invalid`,
      'ci-addr': '2 Maha Chai Rd, Samran Rat, Phra Nakhon, Bangkok 10200',
      'ci-city': 'Bangkok',
      'ci-postal': '10200',
      'ci-maps': mockMapsLink
    },
    owner: 'yes',
    package: 'essential',
    fullName
  });
  if (preassess.status !== 200 || !preassess.json?.ok) {
    throw new Error(`preassessment save failed ${preassess.status} ${JSON.stringify(preassess.json)}`);
  }
  console.log('PREASSESSMENT SAVE ok, sent ci-maps =', mockMapsLink);

  // Fresh reload from the server -- simulates a different device / cleared
  // cache, exactly the scenario this repro targets. NOT reading from any
  // local draft/cache.
  const clients = await api('GET', '/api/clients');
  const job = (clients.json?.jobs || []).find((j) => j.id === caseId || j.notionId === notionId);
  if (!job) throw new Error('created Case not found in fresh /api/clients reload');

  const roundTrippedMaps = job.draft?.fields?.['ci-maps'];
  const roundTrippedAddr = job.draft?.fields?.['ci-addr'];

  console.log('\n=== FRESH RELOAD (server-authoritative, not local cache) ===');
  console.log('ci-addr round-tripped:', JSON.stringify(roundTrippedAddr));
  console.log('ci-maps round-tripped:', JSON.stringify(roundTrippedMaps));

  const verdict = roundTrippedMaps === mockMapsLink
    ? 'UNEXPECTED: ci-maps DID persist -- root-cause hypothesis was wrong, needs re-investigation'
    : 'CONFIRMED: ci-maps did NOT persist to Notion (came back ' + JSON.stringify(roundTrippedMaps) + ' instead of the sent link) -- ci-addr persisted fine for comparison';

  console.log('\nVERDICT:', verdict);
  console.log('\nIdentifiers for cleanup/correlation:');
  console.log('  caseId  :', caseId);
  console.log('  notionId:', notionId);
  console.log('  fullName:', fullName);
}

main().catch((e) => {
  console.error('REPRO SCRIPT FAILED', e.message);
  process.exit(1);
});
