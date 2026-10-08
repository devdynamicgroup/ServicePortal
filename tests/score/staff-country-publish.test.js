/**
 * What the staff see is what gets published: Share / Complete / Send Result
 * send the selected country benchmark (the staff primary number) with its
 * standardKey, and the real publication server verifies and stores it.
 *
 * The real src/js/flows/score.js and src/js/common.js run in one vm sandbox;
 * their fetch() is wired to the real publication service with the in-memory
 * ledger, so every assertion covers browser -> server -> publication.
 *
 * Run: node tests/score/staff-country-publish.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  createOrReusePublication,
  resolveReportByToken,
  setPublicationStore,
  setPublicationCaseAdapter,
  resetPublicationDependencies
} = require('../../services/score-publication-service');
const { createMemoryPublicationStore } = require('../../services/score-publication-store-memory');

const root = path.join(__dirname, '../..');
const ENGINE_KEYS = ['thailand', 'japan', 'who', 'eu', 'usEpa'];
const FILES = [
  'src/js/i18n.js',
  'src/js/score/util/clamp.js',
  'src/js/score/util/benchmarkMetadata.js',
  'src/js/score/validation/measurementValidator.js',
  'src/js/score/production/computeProductionScore.js',
  'src/js/score/production/computeQualityScoreV2.js',
  'src/js/score/benchmark/registry.js',
  ...ENGINE_KEYS.flatMap((key) => ['limits', 'weights', 'score'].map((file) => `src/js/score/benchmark/${key}/${file}.js`)),
  'src/js/flows/score.js',
  'src/js/common.js'
];

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}
const clone = (value) => JSON.parse(JSON.stringify(value));

// Known input where the five engines disagree (Japan strictest).
const READINGS = { ph: 7.6, tds: 102, chlorine: 0.02, turbidity: 0.7, orp: 174, do: 5.7, temp: 27.3 };
const EXPECTED = { quality: 64, thailand: 54, japan: 51, who: 54, eu: 54, usEpa: 57 };

let store;
const serverCases = new Map();

/** A staff browser session on one Case, talking to the real publication service. */
function openStaffSession(caseId, { readings = READINGS, standardKey = 'thailand', result = {}, notification = {} } = {}) {
  const job = {
    id: caseId,
    notionId: caseId,
    pkg: 'full',
    draft: { taps: ['Tap 1'], fields: {}, scoreStandardKey: standardKey, tapData: [{ standardMeasurement: { ...readings } }] },
    result: { ...result },
    notification: { status: 'not_sent', ...notification },
    workflow: { status: 'in_progress' },
    feedback: { token: 'fb' }
  };
  serverCases.set(caseId, clone(job));

  const calls = [];
  const nodes = {};
  const sessionStore = {};
  const node = (id) => {
    if (id && nodes[id]) return nodes[id];
    const el = {
      id, hidden: true, textContent: '', innerHTML: '', className: '', dataset: {}, disabled: false,
      style: { setProperty() {} },
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      setAttribute() {}, removeAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      replaceChildren() {}, appendChild() {}, addEventListener() {}, children: [], childNodes: []
    };
    if (id) nodes[id] = el;
    return el;
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: {
      getItem: (key) => (key in sessionStore ? sessionStore[key] : null),
      setItem: (key, value) => { sessionStore[key] = value; },
      removeItem: (key) => { delete sessionStore[key]; }
    },
    crypto: { randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` },
    navigator: { userAgent: 'node', clipboard: { writeText: async () => {} } },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: (id) => node(id),
      querySelector: () => node(),
      querySelectorAll: () => [],
      createElement: () => node(),
      body: { appendChild() {}, classList: { add() {} } }
    },
    saveActiveJobState() {},
    persistJobs() {},
    renderJobSteps() {},
    goScreen() {},
    resolveReportEligibility: () => ({ canCalculateScore: true, canPublishReport: true, missingMeasurements: [], calculationMetadata: { eligibilityVersion: 'test' } }),
    isSessionExpiredResponse: () => false,
    handleSessionExpired() {},
    OperatorNotificationBridge: {},
    S: {
      lang: 'en', screen: 's-score', scoreStandardKey: 'thailand', activeJob: job, scoreBaseReadings: null, scoreVal: null,
      currentScoreResult: null, comparisonScoreResult: null, displayedScore: null, scoreParamOpen: null,
      publicScoreView: false, taps: ['Tap 1'], tapData: [], scoreTapFilter: 'all', lastReadingsValidation: null, stepsDone: {}
    },
    // The browser's fetch, answered by the real publication service.
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      const match = String(url).match(/\/api\/cases\/([^/]+)\/(score|close|send-result)$/);
      calls.push({ route: match ? match[2] : String(url), body });
      if (!match) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      const id = decodeURIComponent(match[1]);
      if (match[2] !== 'score') {
        return { ok: true, status: 200, json: async () => ({ ok: true, line: { ok: true, status: 'sent' } }) };
      }
      // The server reads its own persisted Case; keep it in step with the staff's saved readings.
      serverCases.get(id).draft = clone(job.draft);
      try {
        const published = await createOrReusePublication({ job: clone(serverCases.get(id)), payload: body, caseId: id });
        return { ok: true, status: 200, json: async () => clone(published) };
      } catch (error) {
        return { ok: false, status: error.statusCode || 502, json: async () => ({ ok: false, error: error.message }) };
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  FILES.forEach((rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel }));
  sandbox.S.scoreStandardKey = standardKey;
  sandbox.renderWaterScore(job, { publicView: false });
  return {
    sandbox, job, calls,
    line: () => node('score-customer-line'),
    shown: () => sandbox.S.displayedScore.score,
    select: (key) => sandbox.setScoreReferenceStandard(key),
    scoreCalls: () => calls.filter((call) => call.route === 'score'),
    lastScoreCall: () => calls.filter((call) => call.route === 'score').slice(-1)[0]
  };
}

/** The customer's browser opening a report the server resolved for a token. */
function openCustomerReport(report) {
  const nodes = {};
  const node = (id) => {
    if (id && nodes[id]) return nodes[id];
    const el = {
      id, hidden: true, textContent: '', innerHTML: '', className: '', dataset: {}, disabled: false,
      style: { setProperty() {} },
      classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      setAttribute() {}, removeAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      replaceChildren() {}, appendChild() {}, addEventListener() {}, children: [], childNodes: []
    };
    if (id) nodes[id] = el;
    return el;
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'node' },
    document: { readyState: 'loading', addEventListener() {}, getElementById: (id) => node(id), querySelector: () => node(), querySelectorAll: () => [], createElement: () => node(), body: { appendChild() {}, classList: { add() {} } } },
    S: {
      lang: 'en', screen: 's-score', scoreStandardKey: 'thailand', activeJob: report, scoreBaseReadings: null, scoreVal: null,
      currentScoreResult: null, comparisonScoreResult: null, displayedScore: null, scoreParamOpen: null,
      publicScoreView: true, taps: report.draft.taps || ['Tap 1'], tapData: [], scoreTapFilter: 'all', lastReadingsValidation: null
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  FILES.filter((rel) => rel !== 'src/js/common.js').forEach((rel) => vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel }));
  // Same order as src/js/public-report.js: default standard first, then render.
  sandbox.S.scoreStandardKey = 'thailand';
  sandbox.renderWaterScore(report, { publicView: true });
  return {
    sandbox,
    shown: () => sandbox.S.displayedScore.score,
    select: () => node('score-standard-select-top'),
    line: () => node('score-customer-line'),
    note: () => node('score-summary-note')
  };
}

function resetServer() {
  serverCases.clear();
  store = createMemoryPublicationStore();
  setPublicationStore(store);
  setPublicationCaseAdapter({
    getClient: async (id) => clone(serverCases.get(id)),
    updateClient: async (id, payload) => {
      const current = serverCases.get(id);
      current.result = {
        ...current.result,
        ...(payload.latestWaterScore !== undefined ? { waterScore: payload.latestWaterScore } : {}),
        ...(payload.publicReportToken !== undefined ? { publicReportToken: payload.publicReportToken } : {}),
        ...(payload.reportUrl !== undefined ? { reportUrl: payload.reportUrl } : {})
      };
      return clone(current);
    },
    findClientByReportToken: async () => null
  });
}
const latestRow = () => store._rows[store._rows.length - 1];

async function main() {
  console.log('\n1 + 2. Staff primary is the selected country engine, and differs by country');
  resetServer();
  {
    const staff = openStaffSession('case-primary');
    const seen = {};
    ENGINE_KEYS.forEach((key) => {
      staff.select(key);
      seen[key] = staff.shown();
      assert(staff.sandbox.S.displayedScore.source === 'country-benchmark' && staff.sandbox.S.displayedScore.engineKey === key, `${key}: primary comes from the ${key} engine`);
      assert(staff.shown() === EXPECTED[key], `${key}: primary is ${EXPECTED[key]} (got ${staff.shown()})`);
    });
    assert(seen.japan < seen.thailand && seen.thailand < seen.usEpa, `scores differ by country (Japan ${seen.japan} < Thai ${seen.thailand} < US ${seen.usEpa})`);
    assert(staff.sandbox.S.currentScoreResult.score === EXPECTED.quality, `Quality V3 is still computed internally (${EXPECTED.quality})`);
  }

  console.log('\n3 + 7. Share publishes the number on screen, not Quality V3');
  for (const key of ENGINE_KEYS) {
    resetServer();
    const staff = openStaffSession(`case-share-${key}`, { standardKey: key });
    const onScreen = staff.shown();
    await staff.sandbox.shareScore();
    const sent = staff.lastScoreCall().body;
    assert(sent.scoreType === 'country-benchmark' && sent.standardKey === key, `${key}: payload is country-benchmark / ${sent.standardKey}`);
    assert(sent.score === onScreen && sent.score === EXPECTED[key], `${key}: payload score ${sent.score} === on screen ${onScreen}`);
    assert(sent.score !== EXPECTED.quality && sent.modelVersion === undefined && sent.complianceStatus === undefined, `${key}: no Quality V3 score, model, or compliance in the payload`);
    const row = latestRow();
    assert(store._rows.length === 1 && row.snapshot.scoreType === 'country-benchmark' && row.snapshot.standardKey === key && row.publishedScore === onScreen,
      `${key}: the server verified and stored ${row && row.publishedScore} for ${key}`);
    assert(staff.job.result.waterScore === onScreen && staff.job.result.standardKey === key, `${key}: the Case now records the published ${onScreen}`);
  }

  console.log('\n6. Switching standard: every Share sends the standard on screen, as its own publication');
  resetServer();
  {
    const staff = openStaffSession('case-switch', { standardKey: 'japan' });
    const tokens = [];
    for (const key of ['japan', 'thailand', 'usEpa']) {
      staff.select(key);
      const onScreen = staff.shown();
      await staff.sandbox.shareScore();
      const sent = staff.lastScoreCall().body;
      assert(sent.standardKey === key && sent.score === onScreen, `${key}: sent ${sent.standardKey} ${sent.score}, screen shows ${onScreen}`);
      assert(latestRow().snapshot.standardKey === key && latestRow().publishedScore === EXPECTED[key], `${key}: published as ${EXPECTED[key]}`);
      tokens.push(latestRow().publicReportToken);
    }
    assert(store._rows.length === 3 && new Set(tokens).size === 3, 'three publications, three links');
    assert((await resolveReportByToken(tokens[0])).result.waterScore === EXPECTED.japan, `the Japan link still shows ${EXPECTED.japan}`);
    assert((await resolveReportByToken(tokens[1])).result.waterScore === EXPECTED.thailand, `the Thailand link still shows ${EXPECTED.thailand}`);

    staff.select('japan');
    assert(staff.shown() === EXPECTED.japan && staff.line().textContent === `Customer Water Score: ${EXPECTED.usEpa}`,
      `after switching back without publishing, the line shows what the customer last got ("${staff.line().textContent}")`);
  }

  console.log('\n4. Complete');
  resetServer();
  {
    const staff = openStaffSession('case-complete', { standardKey: 'japan' });
    const onScreen = staff.shown();
    const published = await staff.sandbox.publishScoreBeforeClose(staff.job);
    const sent = staff.lastScoreCall().body;
    assert(sent.scoreType === 'country-benchmark' && sent.standardKey === 'japan' && sent.score === onScreen, `Complete publishes ${sent.standardKey} ${sent.score}`);
    assert(published === EXPECTED.japan && latestRow().snapshot.standardKey === 'japan', `the server stored Japan ${published}`);
    assert(sent.complianceStatus === undefined && sent.modelVersion === undefined, 'no Quality V3 fields in the Complete payload');

    const staff2 = openStaffSession('case-complete-2', { standardKey: 'usEpa' });
    await staff2.sandbox.finalizeCaseCompletion(staff2.job, {});
    const close = staff2.calls.find((call) => call.route === 'close');
    const score = staff2.calls.find((call) => call.route === 'score');
    assert(score.body.standardKey === 'usEpa' && score.body.score === EXPECTED.usEpa, `full Complete flow publishes US ${score.body.score}`);
    assert(close && close.body.score === EXPECTED.usEpa && close.body.scoreType === 'country-benchmark' && close.body.standardKey === 'usEpa', 'the close request carries the same score and standard');
  }

  console.log('\n5. Send Result');
  resetServer();
  {
    const staff = openStaffSession('case-send', { standardKey: 'japan' });
    const onScreen = staff.shown();
    await staff.sandbox.sendResultToLineNow();
    const sent = staff.lastScoreCall().body;
    assert(sent.scoreType === 'country-benchmark' && sent.standardKey === 'japan' && sent.score === onScreen && sent.intent === 'publish', `first send publishes ${sent.standardKey} ${sent.score}`);
    assert(staff.calls.some((call) => call.route === 'send-result'), 'the result is then sent');
    assert(staff.sandbox.S.scoreVal === EXPECTED.quality, 'S.scoreVal keeps its meaning (Quality V3)');

    staff.job.notification.status = 'sent';
    staff.select('thailand');
    await staff.sandbox.sendResultToLineNow();
    const resent = staff.lastScoreCall().body;
    assert(resent.intent === 'republish' && resent.standardKey === 'thailand' && resent.score === EXPECTED.thailand, `resend after switching publishes ${resent.standardKey} ${resent.score}`);
    assert(store._rows.length === 2 && latestRow().snapshot.standardKey === 'thailand', 'as a new publication');
  }

  console.log('\nPublished-score line');
  resetServer();
  {
    const staff = openStaffSession('case-line', { standardKey: 'japan' });
    assert(staff.line().hidden === true && staff.line().textContent === '', 'no line before anything is published');
    await staff.sandbox.shareScore();
    staff.select('japan');
    assert(staff.line().textContent === `Customer Water Score: ${EXPECTED.japan}`, `after publishing: "${staff.line().textContent}"`);
  }

  console.log('\nAvailability follows the selected engine; the server decides');
  resetServer();
  {
    const noDo = { ...READINGS };
    delete noDo.do;
    const staff = openStaffSession('case-nodo', { readings: noDo, standardKey: 'japan' });
    assert(staff.sandbox.S.currentScoreResult.score === null, 'Quality V3 is unavailable without DO');
    assert(Number.isFinite(staff.shown()), `Japan still shows a score (${staff.shown()})`);
    await staff.sandbox.shareScore();
    assert(staff.lastScoreCall().body.score === staff.shown() && store._rows.length === 1, 'and it is published as shown');

    const noPh = { ...READINGS };
    delete noPh.ph;
    const blocked = openStaffSession('case-noph', { readings: noPh, standardKey: 'japan' });
    await blocked.sandbox.shareScore();
    assert(blocked.shown() === null && blocked.scoreCalls().length === 0, 'no score on screen -> nothing is sent');
  }

  console.log('\n8. Existing Quality V3 publication');
  resetServer();
  {
    const staff = openStaffSession('case-legacy', { standardKey: 'japan' });
    const old = await createOrReusePublication({ job: clone(serverCases.get('case-legacy')), caseId: 'case-legacy', payload: { score: EXPECTED.quality, intent: 'publish' } });
    staff.job.result = { waterScore: old.score, publicReportToken: old.reportToken, reportUrl: old.reportUrl };
    staff.select('japan');
    assert(staff.line().textContent === `Customer Water Score: ${EXPECTED.quality}`, `the line shows the existing Quality V3 publication ("${staff.line().textContent}")`);
    await staff.sandbox.shareScore();
    assert(store._rows.length === 2 && latestRow().snapshot.scoreType === 'country-benchmark' && latestRow().publishedScore === EXPECTED.japan, 'Share creates a separate Japan publication');
    assert(store._rows[0].snapshot.scoreType === 'quality-v3' && (await resolveReportByToken(old.reportToken)).result.waterScore === EXPECTED.quality, `the old Quality V3 link still shows ${EXPECTED.quality}`);
  }

  console.log('\nStandard key comes from the Case being published');
  resetServer();
  {
    const staff = openStaffSession('case-active', { standardKey: 'japan' });
    const other = { id: 'case-other', notionId: 'case-other', draft: { scoreStandardKey: 'usEpa', fields: {}, tapData: [{ standardMeasurement: { ...READINGS } }] }, result: {} };
    const request = staff.sandbox.resolvePublishScoreRequest(other);
    assert(request.standardKey === 'usEpa' && request.score === EXPECTED.usEpa, 'another Case uses its own saved standard, not the active screen selection');
    const unknown = staff.sandbox.resolvePublishScoreRequest({ id: 'x', notionId: 'x', draft: { scoreStandardKey: 'Japan', fields: {}, tapData: [{ standardMeasurement: { ...READINGS } }] }, result: {} });
    assert(unknown.standardKey === 'thailand', 'a display label is never sent as a key (falls back to the default standard)');
  }

  console.log('\nCustomer: the published score, under the published standard');
  resetServer();
  {
    const staff = openStaffSession('case-customer', { standardKey: 'japan' });
    await staff.sandbox.shareScore();
    const japanToken = latestRow().publicReportToken;
    const japanStaff = staff.shown();

    // The Case is edited and re-published under Thailand afterwards.
    staff.select('thailand');
    await staff.sandbox.shareScore();
    const thaiToken = latestRow().publicReportToken;
    const thaiStaff = staff.shown();
    staff.job.draft.tapData[0].standardMeasurement.chlorine = 0.35;
    serverCases.get('case-customer').draft = clone(staff.job.draft);

    const japan = openCustomerReport(await resolveReportByToken(japanToken));
    assert(japanStaff === EXPECTED.japan && japan.shown() === EXPECTED.japan, `Japan: staff ${japanStaff} === customer ${japan.shown()}`);
    assert(japan.sandbox.S.displayedScore.source === 'published', 'customer number is the published score, not a live calculation');
    assert(japan.sandbox.S.scoreStandardKey === 'japan', 'customer report is on the Japan standard');
    assert(japan.select().disabled === true && /value="japan" selected/.test(japan.select().innerHTML), 'the Benchmark control shows Japan and is locked');
    assert(japan.sandbox.resolveScoreReadings(japan.sandbox.S.activeJob).chlorine === READINGS.chlorine, 'rows use the readings frozen at publish, not the later edit');
    for (const key of ENGINE_KEYS) japan.sandbox.setScoreReferenceStandard(key);
    assert(japan.shown() === EXPECTED.japan && japan.sandbox.S.scoreStandardKey === 'japan', `trying to switch standard changes nothing (still Japan ${japan.shown()})`);
    assert(japan.line().hidden === true, 'no staff-only line on the customer report');

    const thai = openCustomerReport(await resolveReportByToken(thaiToken));
    assert(thaiStaff === EXPECTED.thailand && thai.shown() === EXPECTED.thailand && thai.sandbox.S.scoreStandardKey === 'thailand', `Thailand: staff ${thaiStaff} === customer ${thai.shown()} on the Thailand standard`);
    const japanAgain = openCustomerReport(await resolveReportByToken(japanToken));
    assert(japanAgain.shown() === EXPECTED.japan && japanAgain.sandbox.S.scoreStandardKey === 'japan', `the old Japan link is still Japan ${japanAgain.shown()}`);

    const band = (page) => page.note().textContent;
    assert(japan.sandbox.S.currentScoreResult.complianceStatus === 'CRITICAL', "compliance on the report is the Japan engine's (CRITICAL)");
    assert(band(japan) === 'Quality index is not a safety clearance — one or more compliance checks failed.', `CRITICAL shows the existing failed-compliance note ("${band(japan)}")`);
  }

  console.log('\nCustomer: an existing Quality V3 publication is unchanged');
  resetServer();
  {
    serverCases.set('case-old', { id: 'case-old', notionId: 'case-old', pkg: 'full', draft: { taps: ['Tap 1'], fields: {}, tapData: [{ standardMeasurement: { ...READINGS } }] }, result: {} });
    const old = await createOrReusePublication({ job: clone(serverCases.get('case-old')), caseId: 'case-old', payload: { score: EXPECTED.quality, intent: 'publish', complianceStatus: 'FAIL' } });
    const page = openCustomerReport(await resolveReportByToken(old.reportToken));
    assert(page.shown() === EXPECTED.quality && page.sandbox.S.displayedScore.source === 'published', `shows the published Quality V3 ${page.shown()}`);
    assert(page.select().disabled === false && page.sandbox.S.scoreStandardKey === 'thailand', 'its Benchmark control behaves as before');
  }

  resetPublicationDependencies();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
