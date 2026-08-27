/**
 * Regression test for the Water Assessment checklist thumbnail bug
 * (2026-08-27): a tap photo uploaded earlier (fileId/contentUrl on record,
 * but no cached blob / previewUrl -- the normal state right after reopening
 * a Case on a fresh page load) must still render as "has a photo" instead
 * of silently falling back to "no photo".
 *
 * renderAssessList() and applyDriveContentSrc() are extracted verbatim from
 * src/js/flows/assessment.js via regex + vm (this file is a browser
 * <script>, not a CommonJS module, so it can't be require()'d directly --
 * matches this codebase's established convention for route/UI-internal
 * helpers). A minimal DOM stub (element with classList/appendChild) and a
 * DrivePhoto stub stand in for the real browser globals.
 *
 * Run: node scripts/test-assess-thumbnail-hydrate.js
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
const src = fs.readFileSync(`${ROOT}/src/js/flows/assessment.js`, 'utf8');

function extract(fnName) {
  const match = src.match(new RegExp(`function ${fnName}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  if (!match) throw new Error(`${fnName}() not found in assessment.js -- test out of sync with source`);
  return match[0];
}

const renderAssessListSrc = extract('renderAssessList');
const applyDriveContentSrcSrc = extract('applyDriveContentSrc');

assert(renderAssessListSrc.includes('applyDriveContentSrc'), 'renderAssessList() calls applyDriveContentSrc() for the async hydrate fallback (test in sync with the fix)');

// ---- minimal DOM stub ----
function makeEl(id) {
  const el = {
    id,
    _classes: new Set(),
    innerHTML: '',
    children: [],
    classList: {
      add: (...c) => c.forEach(x => el._classes.add(x)),
      remove: (...c) => c.forEach(x => el._classes.delete(x)),
      toggle: (c, on) => { if (on) el._classes.add(c); else el._classes.delete(c); },
      contains: (c) => el._classes.has(c)
    },
    appendChild(child) { this.children.push(child); return child; },
    set src(v) { this._src = v; },
    get src() { return this._src; }
  };
  return el;
}

function buildSandbox({ photo, hydrateCalls }) {
  const elements = {
    'thumb-tapphoto': makeEl('thumb-tapphoto'),
    'thumb-meter': makeEl('thumb-meter'),
    'thumb-chlorine': makeEl('thumb-chlorine'),
    'tapphoto-check': makeEl('tapphoto-check'),
    'visual-check': makeEl('visual-check'),
    'meter-check': makeEl('meter-check'),
    'chlorine-check': makeEl('chlorine-check'),
    'pressure-check': makeEl('pressure-check'),
    'infra-check': makeEl('infra-check')
  };
  const document = {
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => { const el = makeEl(`created-${tag}`); return el; }
  };
  const S = {
    activeTap: 0,
    tapData: [{ tasks: {}, photos: { tapphoto: photo } }]
  };
  const DrivePhoto = {
    previewSrc: (p) => {
      if (!p) return '';
      if (typeof p === 'string') return p;
      return p.previewUrl || '';
    },
    hydrateImg: (img, p, fallback) => {
      hydrateCalls.push({ img, photo: p, fallback });
    }
  };
  const sandbox = {
    console,
    document,
    S,
    DrivePhoto,
    TASK_KEYS: { 'tapphoto-check': 'tapphoto', 'visual-check': 'visual', 'meter-check': 'meter', 'chlorine-check': 'chlorine', 'pressure-check': 'pressure', 'infra-check': 'infra' },
    CHECK_SVG: '<svg></svg>',
    ensureTapData: () => {},
    ensureMeterImages: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(applyDriveContentSrcSrc, sandbox, { filename: 'assessment.js (applyDriveContentSrc excerpt)' });
  vm.runInContext(renderAssessListSrc, sandbox, { filename: 'assessment.js (renderAssessList excerpt)' });
  return { sandbox, elements };
}

console.log('=== renderAssessList() thumbnail rendering ===');

{
  // Freshly uploaded: has previewUrl (base64 data URL) -- sync path, no hydrate needed.
  const hydrateCalls = [];
  const { sandbox, elements } = buildSandbox({ photo: { fileId: 'f1', contentUrl: 'https://x/f1', previewUrl: 'data:image/png;base64,AAA' }, hydrateCalls });
  sandbox.renderAssessList();
  assert(elements['thumb-tapphoto'].classList.contains('has-photo'), 'fresh upload with previewUrl => thumbnail marked has-photo');
  assert(hydrateCalls.length === 0, 'previewUrl already available => hydrateImg NOT called (no unnecessary network fetch)');
}

{
  // Reopened Case: fileId/contentUrl on record, no previewUrl, no cached blob -- the bug scenario.
  const hydrateCalls = [];
  const { sandbox, elements } = buildSandbox({ photo: { fileId: 'f1', contentUrl: 'https://x/f1' }, hydrateCalls });
  sandbox.renderAssessList();
  assert(elements['thumb-tapphoto'].classList.contains('has-photo'), 'photo on record but not hydrated (fileId/contentUrl only, no previewUrl) => still marked has-photo, not silently treated as no photo');
  assert(hydrateCalls.length === 1 && hydrateCalls[0].photo.fileId === 'f1', 'falls back to DrivePhoto.hydrateImg(img, photo) to fetch the real image asynchronously');
}

{
  // Genuinely no photo at all.
  const hydrateCalls = [];
  const { sandbox, elements } = buildSandbox({ photo: null, hydrateCalls });
  sandbox.renderAssessList();
  assert(!elements['thumb-tapphoto'].classList.contains('has-photo'), 'no photo on record at all => correctly NOT marked has-photo');
  assert(hydrateCalls.length === 0, 'no photo on record => hydrateImg not called');
}

{
  // Upload failed and never retried: no fileId/contentUrl at all.
  const hydrateCalls = [];
  const { sandbox, elements } = buildSandbox({ photo: { uploadError: 'Upload interrupted' }, hydrateCalls });
  sandbox.renderAssessList();
  assert(!elements['thumb-tapphoto'].classList.contains('has-photo'), 'upload-failed photo with no fileId/contentUrl => not marked has-photo (nothing to hydrate)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
