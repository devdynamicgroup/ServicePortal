/**
 * OP LINE display + destination regression coverage.
 *
 * Two independent, never-conflated concepts:
 *   1. VERIFIED identity (job.line.linked + job.line.displayName), written
 *      only by the existing linkLineUser() -- never editable, never guessed.
 *   2. A validated PUBLIC LINE ID (job.line.publicId, the raw OP-typed
 *      "LINE ID" Notion property, read independently of the
 *      lineDisplayName fallback that already shadows it once linked --
 *      see services/notion/mapper.js). resolveLinePersonalUrl() builds a
 *      line.me destination ONLY from this validated field -- NEVER from
 *      lineUserId, which is opaque and cannot be turned into a public URL
 *      (a LINE platform limitation, not an engineering gap).
 *
 * Click target: handleOpLineAction() opens the validated destination when
 * one exists, otherwise falls back to the EXISTING chatActiveJobClient()
 * action -- never a second LINE integration.
 *
 * updateJobHeader()/resolveLinePersonalUrl()/handleOpLineAction() are
 * extracted verbatim from src/js/job-state.js via regex + vm (same
 * established convention as scripts/test-assess-thumbnail-hydrate.js),
 * since this file is a browser <script>, not a CommonJS module.
 *
 * Run: node scripts/test-op-line-display.js
 */
'use strict';
const fs = require('fs');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

const ROOT = 'D:/Service Portal';
const jobStateSrc = fs.readFileSync(`${ROOT}/src/js/job-state.js`, 'utf8');
const jobHtmlSrc = fs.readFileSync(`${ROOT}/src/pages/job.html`, 'utf8');
const mapperSrc = fs.readFileSync(`${ROOT}/services/notion/mapper.js`, 'utf8');

function extract(fnName) {
  const match = jobStateSrc.match(new RegExp(`function ${fnName}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`${fnName}() not found in job-state.js -- test out of sync with source`);
  return match[0];
}

const updateJobHeaderSrc = extract('updateJobHeader');
const resolveLinePersonalUrlSrc = extract('resolveLinePersonalUrl');
const handleOpLineActionSrc = extract('handleOpLineAction');
// LINE_PUBLIC_ID_PATTERN is a top-level const, not a function -- grab it separately.
const patternMatch = jobStateSrc.match(/const LINE_PUBLIC_ID_PATTERN = [^\n]+/);
if (!patternMatch) throw new Error('LINE_PUBLIC_ID_PATTERN not found -- test out of sync with source');
const patternSrc = patternMatch[0];

assert(updateJobHeaderSrc.includes('op-line-card'), 'updateJobHeader() touches the op-line-card element (test in sync with the fix)');
assert(resolveLinePersonalUrlSrc.includes('LINE_PUBLIC_ID_PATTERN'), 'resolveLinePersonalUrl() validates against the public-ID pattern');
assert(!/lineUserId/i.test(resolveLinePersonalUrlSrc), 'resolveLinePersonalUrl() never references lineUserId anywhere in its body');

// ---- static markup / mapper checks (no vm needed) ----
assert(jobHtmlSrc.includes('id="op-line-card"') && jobHtmlSrc.includes('onclick="handleOpLineAction()"'),
  'job.html wires the OP LINE card to handleOpLineAction(), not a raw URL and not duplicated logic');
assert(!jobHtmlSrc.match(/id="op-line-name"[^>]*>\s*<input/), 'OP LINE name is not rendered as an editable <input>');
assert(!/https?:\/\/line\.me|lin\.ee/i.test(jobHtmlSrc), 'job.html itself never hardcodes a line.me/lin.ee URL');
assert(mapperSrc.includes('publicId: linePublicId'), 'mapper.js exposes the raw public LINE ID as job.line.publicId (additive only)');
assert(mapperSrc.match(/displayName:\s*lineDisplayName \|\| ''/), 'mapper.js\'s existing lineDisplayName/ci-line fallback logic is untouched');

// ---- minimal DOM stub ----
function makeEl(id, initial = {}) {
  const el = { id, _classes: new Set(['hidden']), textContent: initial.textContent || '', dataset: {} };
  el.classList = {
    toggle: (c, on) => { if (on === undefined) { el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c); } else if (on) el._classes.add(c); else el._classes.delete(c); },
    contains: (c) => el._classes.has(c),
    add: (...c) => c.forEach(x => el._classes.add(x)),
    remove: (...c) => c.forEach(x => el._classes.delete(x))
  };
  return el;
}

function buildSandbox() {
  const elements = {
    'job-client-name': makeEl('job-client-name'),
    'job-time-range': makeEl('job-time-range'),
    'job-pkg-tag': makeEl('job-pkg-tag'),
    'job-change-pkg-btn': makeEl('job-change-pkg-btn'),
    'job-maps-btn': makeEl('job-maps-btn'),
    'line-send-sub': makeEl('line-send-sub'),
    'line-send-btn-label': makeEl('line-send-btn-label'),
    'op-line-card': makeEl('op-line-card'),
    'op-line-name': makeEl('op-line-name'),
    'op-line-arrow': makeEl('op-line-arrow')
  };
  const document = { getElementById: (id) => elements[id] || null };
  const S = { pkg: 'essential' };
  let openedUrl = null;
  let chatActiveJobClientCalled = 0;
  const sandbox = {
    document,
    S,
    String,
    Boolean,
    Number,
    RegExp,
    encodeURIComponent,
    t: (key) => key,
    getJobDraft: (job) => job?.draft || {},
    window: { open: (url) => { openedUrl = url; } },
    chatActiveJobClient: () => { chatActiveJobClientCalled += 1; },
    get openedUrl() { return openedUrl; },
    get chatActiveJobClientCalled() { return chatActiveJobClientCalled; },
    resetSpies() { openedUrl = null; chatActiveJobClientCalled = 0; }
  };
  vm.createContext(sandbox);
  vm.runInContext(patternSrc, sandbox);
  vm.runInContext(resolveLinePersonalUrlSrc, sandbox);
  vm.runInContext(updateJobHeaderSrc, sandbox);
  vm.runInContext(handleOpLineActionSrc, sandbox);
  return { sandbox, elements };
}

function freshJob(overrides = {}) {
  return {
    id: 'case-op-line-1',
    name: 'Test Client',
    timeStart: '09:00',
    timeEnd: '10:00',
    line: { userId: '', linked: false, displayName: '', publicId: '' },
    notification: { status: 'not_sent' },
    draft: { fields: {} },
    ...overrides
  };
}

(async () => {
  console.log('=== A. Verified identity, no public ID -> name shown, no arrow, fallback click ===');
  {
    const { sandbox, elements } = buildSandbox();
    const job = freshJob({ line: { userId: 'U_VERIFIED', linked: true, displayName: 'เอ', publicId: '' } });
    sandbox.updateJobHeader(job);
    assert(!elements['op-line-card'].classList.contains('hidden'), 'card visible for verified identity');
    assert(elements['op-line-name'].textContent === 'เอ', 'label is the verified display name');
    assert(elements['op-line-arrow'].classList.contains('hidden'), 'no arrow when no validated destination exists');
    sandbox.resetSpies();
    sandbox.handleOpLineAction();
    assert(sandbox.chatActiveJobClientCalled === 1 && sandbox.openedUrl === null, 'click falls back to existing chatActiveJobClient(), opens no URL');
  }

  console.log('\n=== B. No verified identity, no public ID -> card hidden ===');
  {
    const { sandbox, elements } = buildSandbox();
    const job = freshJob();
    sandbox.updateJobHeader(job);
    assert(elements['op-line-card'].classList.contains('hidden'), 'card stays hidden with nothing to show');
  }

  console.log('\n=== C. Valid public LINE ID (Case A — OP already has it, not yet verified) -> destination generated ===');
  {
    const { sandbox, elements } = buildSandbox();
    const job = freshJob({ line: { userId: '', linked: false, displayName: '', publicId: 'johndoe_01' } });
    sandbox.updateJobHeader(job);
    assert(!elements['op-line-card'].classList.contains('hidden'), 'card visible from a valid public ID alone, even unlinked');
    assert(elements['op-line-name'].textContent === 'johndoe_01', 'label falls back to the public ID text when no verified name exists');
    assert(!elements['op-line-arrow'].classList.contains('hidden'), 'arrow shown -- a real destination exists');
    assert(elements['op-line-card'].dataset.destination === 'https://line.me/ti/p/~johndoe_01', 'destination is the canonical line.me URL built from the validated public ID');
    sandbox.resetSpies();
    sandbox.handleOpLineAction();
    assert(sandbox.openedUrl === 'https://line.me/ti/p/~johndoe_01' && sandbox.chatActiveJobClientCalled === 0, 'click opens the real destination directly, does not fall back');
  }

  console.log('\n=== D. Invalid public LINE ID -> no destination, no crash ===');
  {
    const invalidIds = ['', 'ab', 'has spaces here', 'way-too-long-to-be-a-real-line-id-handle-012345', 'bad$chars!'];
    for (const bad of invalidIds) {
      const { sandbox, elements } = buildSandbox();
      const job = freshJob({ line: { userId: '', linked: false, displayName: '', publicId: bad } });
      sandbox.updateJobHeader(job);
      assert(elements['op-line-card'].dataset.destination === '', `invalid public ID "${bad}" produces no destination`);
      assert(elements['op-line-arrow'].classList.contains('hidden'), `invalid public ID "${bad}" shows no arrow`);
    }
  }

  console.log('\n=== E. Case B (mandatory) — Case Code bind -> verified display name, no fabricated URL ===');
  {
    const { sandbox, elements } = buildSandbox();
    // Exactly what linkLineUser() + notionPageToJob() produce after a real
    // fb-xxxx bind -- verified identity + displayName, with no OP-typed
    // public ID ever provided for this Case.
    const job = freshJob({ line: { userId: 'U_CASE_B', linked: true, displayName: 'เอ', publicId: '' } });
    sandbox.updateJobHeader(job);
    assert(elements['op-line-name'].textContent === 'เอ', 'verified display name shows with zero manual OP input');
    assert(elements['op-line-card'].dataset.destination === '', 'no destination is fabricated from lineUserId');
    assert(elements['op-line-arrow'].classList.contains('hidden'), 'no arrow shown -- honest absence of a real destination');
  }

  console.log('\n=== F. Verified identity AND a valid public ID both present -> both surfaced correctly ===');
  {
    const { sandbox, elements } = buildSandbox();
    const job = freshJob({ line: { userId: 'U_BOTH', linked: true, displayName: 'เอ', publicId: 'real.handle-99' } });
    sandbox.updateJobHeader(job);
    assert(elements['op-line-name'].textContent === 'เอ', 'verified display name still takes priority as the label');
    assert(elements['op-line-card'].dataset.destination === 'https://line.me/ti/p/~real.handle-99', 'destination still derives from the validated public ID, not lineUserId');
    assert(!elements['op-line-arrow'].classList.contains('hidden'), 'arrow shown since a real destination exists here');
  }

  console.log('\n=== G. Existing OP-typed ci-line draft field is never read by this code path ===');
  {
    const { sandbox, elements } = buildSandbox();
    const job = freshJob({ draft: { fields: { 'ci-line': 'some-legacy-value' } } });
    sandbox.updateJobHeader(job);
    assert(elements['op-line-card'].classList.contains('hidden'), 'ci-line draft field alone (no job.line.publicId) does not surface OP LINE');
  }

  console.log('\n=== H. Toggle linked -> unlinked clears stale state ===');
  {
    const { sandbox, elements } = buildSandbox();
    const job = freshJob({ line: { userId: 'U_X', linked: true, displayName: 'Bob', publicId: '' } });
    sandbox.updateJobHeader(job);
    assert(elements['op-line-name'].textContent === 'Bob', 'initial linked state shows Bob');
    job.line = { userId: '', linked: false, displayName: '', publicId: '' };
    sandbox.updateJobHeader(job);
    assert(elements['op-line-card'].classList.contains('hidden'), 'card hides again once unlinked with no public ID');
    assert(elements['op-line-card'].dataset.destination === '', 'stale destination is cleared, not left over from the previous state');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
