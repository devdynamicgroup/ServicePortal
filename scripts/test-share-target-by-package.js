/**
 * Share target by package.
 *
 *   Full Assessment (job.pkg === 'full')  → Share passes on the Water Score page link
 *   Essential / free (anything else)      → Share passes on the poster image (unchanged)
 *
 * Loads the REAL src/js/flows/score.js and src/js/public-report.js into a vm
 * sandbox with a stubbed navigator / fetch. No network, no Case is touched.
 *
 * Run: node scripts/test-share-target-by-package.js
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

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function stubEl() {
  return {
    hidden: false, disabled: false, dataset: {}, style: { setProperty() {} }, textContent: '',
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, removeAttribute() {}, querySelector: () => stubEl()
  };
}

/** Fresh sandbox per scenario so share/fetch call logs never bleed across cases. */
function makeSandbox({ job = null, publicView = false, scorePublishResult = null } = {}) {
  const calls = { fetch: [], share: [], clipboard: [], toast: [] };
  const sandbox = {
    console: { log() {}, warn() {}, info() {}, error: console.error },
    setTimeout, clearTimeout, AbortController,
    File: class { constructor(parts, name, opts) { this.name = name; this.type = opts?.type; } },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: () => stubEl(),
      querySelector: () => stubEl(),
      querySelectorAll: () => [],
      body: { classList: { add() {} } }
    },
    navigator: {
      userAgent: 'node',
      canShare: (data) => Array.isArray(data?.files) && data.files.length > 0,
      share: async (data) => { calls.share.push(data); },
      clipboard: { writeText: async (text) => { calls.clipboard.push(text); } }
    },
    fetch: async (url, init) => {
      calls.fetch.push({ url: String(url), method: init?.method || 'GET' });
      if (String(url).includes('/api/public/score-card/')) {
        return { ok: true, blob: async () => ({ type: 'image/png' }) };
      }
      return { ok: true, json: async () => scorePublishResult };
    },
    showToast: (msg) => calls.toast.push(msg),
    saveActiveJobState() {},
    S: { lang: 'en', activeJob: job, publicScoreView: publicView, scoreVal: 84, currentScoreResult: { complianceStatus: null }, taps: ['Tap 1'] },
    t: (k) => k
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.matchMedia = () => ({ matches: false });
  sandbox.location = { href: 'https://portal.example/r/tok-full' };
  sandbox.__WM_PUBLIC_REPORT__ = { token: 'tok-full', report: job };
  vm.createContext(sandbox);
  vm.runInContext(read('src/js/flows/score.js'), sandbox, { filename: 'score.js' });
  vm.runInContext(read('src/js/public-report.js'), sandbox, { filename: 'public-report.js' });
  return { sandbox, calls };
}

const cardFetches = (calls) => calls.fetch.filter(c => c.url.includes('/api/public/score-card/'));
const PUBLISHED = { score: 84, reportUrl: 'https://portal.example/r/tok-1', reportToken: 'tok-1' };

(async () => {
  // The staff portal has exactly one Share control: the Score page button
  // (src/pages/score.html → shareScore()). There is no separate admin share route.
  console.log('\n=== Share entry points ===');
  {
    const shareButtons = fs.readdirSync(path.join(ROOT, 'src/pages'))
      .filter(name => name.endsWith('.html'))
      .filter(name => /onclick="share[A-Za-z]*\(/.test(read(`src/pages/${name}`)));
    assert(shareButtons.join(',') === 'score.html', `only the Score page has a Share button (got ${shareButtons.join(',')})`);
    assert(read('src/pages/score.html').includes('onclick="shareScore()"'), 'staff Score page Share calls shareScore()');
  }

  console.log('\n=== Full + Backend Share → Water Score ===');
  {
    const job = { id: 'c1', notionId: 'n1', pkg: 'full', result: { waterScore: 84 } };
    const { sandbox, calls } = makeSandbox({ job, scorePublishResult: PUBLISHED });
    await sandbox.shareScore();
    assert(cardFetches(calls).length === 0, 'poster image is never fetched');
    assert(calls.share.length === 1 && calls.share[0].url === PUBLISHED.reportUrl, `shares the /r/{token} Water Score link (got ${JSON.stringify(calls.share[0])})`);
    assert(calls.share[0] && !calls.share[0].files, 'no image file is attached');
  }

  console.log('\n=== Full + Customer Share → Water Score ===');
  {
    const job = { id: 'c1', pkg: 'full', result: { waterScore: 84, publicReportToken: 'tok-full' } };
    const { sandbox, calls } = makeSandbox({ job, publicView: true });
    await sandbox.sharePublicReport();
    assert(cardFetches(calls).length === 0, 'poster image is never fetched');
    assert(calls.share.length === 1 && calls.share[0].url === 'https://portal.example/r/tok-full', 'shares the current Water Score page URL');
    assert(calls.share[0] && !calls.share[0].files, 'no image file is attached');
  }

  console.log('\n=== Full Assessment — no Web Share API falls back to copying the Water Score link ===');
  {
    const job = { id: 'c1', pkg: 'full', result: { waterScore: 84, publicReportToken: 'tok-full' } };
    const { sandbox, calls } = makeSandbox({ job, publicView: true });
    sandbox.navigator.share = undefined;
    await sandbox.sharePublicReport();
    assert(cardFetches(calls).length === 0, 'poster image is never fetched');
    assert(calls.clipboard[0] === 'https://portal.example/r/tok-full', 'Water Score link is copied');
  }

  console.log('\n=== Essential + Backend Share → Postcard (unchanged) ===');
  for (const job of [
    { id: 'c2', notionId: 'n2', pkg: 'essential', result: { waterScore: 84 } },
    { id: 'c3', notionId: 'n3', result: { waterScore: 84 } }
  ]) {
    const { sandbox, calls } = makeSandbox({ job, scorePublishResult: PUBLISHED });
    await sandbox.shareScore();
    const label = `pkg=${job.pkg || '(none)'}`;
    assert(cardFetches(calls).length === 1 && cardFetches(calls)[0].url.includes('/api/public/score-card/tok-1'), `${label}: poster image is fetched`);
    assert(calls.share.length === 1 && Array.isArray(calls.share[0].files) && calls.share[0].files.length === 1, `${label}: poster image file is shared`);
    assert(calls.share[0] && calls.share[0].url === undefined, `${label}: not a link share`);
  }

  // What the shared /r/{token} link opens — the real server route, with only
  // the Case lookup mocked. Backend and customer share both hand out this link.
  console.log('\n=== Shared link target — /r/{token} by package ===');
  {
    process.env.AUTH_ALLOW_DEV_USERS = 'true';
    process.env.NODE_ENV = 'test';
    const caseFlow = require(path.join(ROOT, 'services/case-flow'));
    const FIXTURES = {
      'tok-1': { id: 'c1', pkg: 'full', result: { publicReportToken: 'tok-1', waterScore: 84, reportUrl: '/r/tok-1' } },
      'tok-2': { id: 'c2', pkg: 'essential', result: { publicReportToken: 'tok-2', waterScore: 84, reportUrl: '/r/tok-2' } }
    };
    const originalGetReport = caseFlow.getReportByToken;
    caseFlow.getReportByToken = async (token) => FIXTURES[token] || null;
    const { handleCaseFlowRoute } = require(path.join(ROOT, 'api/case-flow-routes'));
    const fetchPage = async (token) => {
      let body = '';
      const res = { writeHead() {}, end(chunk) { if (chunk) body += chunk; } };
      await handleCaseFlowRoute({ method: 'GET', url: `/r/${token}`, headers: {} }, res, `/r/${token}`);
      return body;
    };
    try {
      const full = await fetchPage('tok-1');
      assert(full.includes('score-readings-rows') && full.includes('public-report.js'), 'Full: the link shared from the backend (/r/tok-1) opens the Water Score page');
      assert(full.includes('"token":"tok-1"'), 'Full: it is the Water Score of the same Case');
      assert(!full.includes('/api/public/score-card/'), 'Full: the page is not the poster');
      assert(full.includes('onclick="sharePublicReport()"'), 'Full: the customer page Share is wired to sharePublicReport()');

      const essential = await fetchPage('tok-2');
      assert(essential.includes('/api/public/score-card/tok-2'), 'Essential + Customer: /r/tok-2 is the Postcard');
      assert(!essential.includes('score-readings-rows') && !essential.includes('public-report.js'), 'Essential + Customer: no Water Score page, so sharing that page passes on the Postcard');
    } finally {
      caseFlow.getReportByToken = originalGetReport;
    }
  }

  console.log('\n=== Benchmark country label ===');
  {
    const i18n = read('src/js/i18n.js');
    assert((i18n.match(/'score\.refStandard\.short\.usEpa': 'US',/g) || []).length === 2, 'customer-facing label is "US" in EN and TH');
    assert(!i18n.includes("'score.refStandard.short.usEpa': 'US EPA'"), 'no "US EPA" short label remains');
    assert(read('src/js/flows/score.js').includes("'thailand', 'eu', 'usEpa', 'who', 'japan'"), 'internal key usEpa unchanged');
    assert(read('src/js/score/benchmark/usEpa/score.js').includes("key: 'usEpa'") && read('src/js/score/benchmark/usEpa/score.js').includes("shortKey: 'score.refStandard.short.usEpa'"), 'US EPA engine registration unchanged');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
