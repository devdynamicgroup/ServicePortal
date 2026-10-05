/**
 * Regression for the "LINE ID field reverts / never shows what was typed"
 * report (2026-10-05): once a Case is LINE-linked, draft.fields['ci-line']
 * (the Pre-assessment Form's LINE ID input) used to be built from the
 * VERIFIED LINE display name (services/notion/mapper.js:notionPageToJob),
 * silently shadowing whatever was actually typed/saved into the raw
 * "LINE ID" Notion property -- confirmed via a direct write test that the
 * raw property write itself succeeded, but the form field would still show
 * the old display name forever after.
 *
 * Public LINE ID (job.line.publicId, draft.fields['ci-line']) and verified
 * LINE identity (job.line.userId/displayName/linked/linkedAt) are two
 * separate concepts and must never be conflated:
 *   - ci-line now always reads the raw "LINE ID" property (linePublicId).
 *   - job.line.displayName/userId/linked/linkedAt are completely untouched.
 * The verified identity is surfaced separately, in the UI, as a badge
 * (src/js/job-state.js:updateLineVerifiedBadge) -- never by overwriting
 * the input's value.
 *
 * Same technique as scripts/test-ci-maps-persistence.js: pure mapper
 * functions only (notionPageToJob) -- no live Notion access, no Case
 * created/modified, no LINE sent.
 *
 * Run: node scripts/test-line-id-no-shadow.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const { notionPageToJob } = require(path.join(ROOT, 'services/notion/mapper.js'));

let passed = 0;
let failed = 0;
function assert(cond, msg, detail) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`, detail !== undefined ? JSON.stringify(detail) : ''); }
}

function richText(value) {
  return { type: 'rich_text', rich_text: value ? [{ type: 'text', text: { content: value }, plain_text: value }] : [] };
}

function fakePage({ fullName = 'John Doe', lineId, lineDisplayName, lineUserId, lineLinked } = {}) {
  const properties = {
    'Full Name': { type: 'title', title: fullName ? [{ type: 'text', text: { content: fullName }, plain_text: fullName }] : [] }
  };
  if (lineId !== undefined) properties['LINE ID'] = richText(lineId);
  if (lineDisplayName !== undefined) properties['LINE Display Name'] = richText(lineDisplayName);
  if (lineUserId !== undefined) properties['LINE User ID'] = richText(lineUserId);
  if (lineLinked !== undefined) properties['LINE Linked'] = { type: 'checkbox', checkbox: lineLinked };
  return { id: 'fake-page-id', created_time: '2026-08-10T00:00:00.000Z', properties };
}

console.log('=== Test 5: mapper does not shadow LINE ID (linked + both values present) ===');
{
  const job = notionPageToJob(fakePage({
    lineId: 'public123',
    lineUserId: 'U123',
    lineDisplayName: 'Nattakamon fern',
    lineLinked: true
  }), 0);
  assert(job.line.publicId === 'public123', 'job.line.publicId === raw LINE ID', job.line.publicId);
  assert(job.line.userId === 'U123', 'job.line.userId untouched', job.line.userId);
  assert(job.line.displayName === 'Nattakamon fern', 'job.line.displayName untouched', job.line.displayName);
  assert(job.line.linked === true, 'job.line.linked untouched', job.line.linked);
  assert(job.draft.fields['ci-line'] === 'public123', 'ci-line reads the raw LINE ID, not the display name', job.draft.fields['ci-line']);
  assert(job.line.publicId !== job.line.displayName, 'publicId and displayName are never the same field');
}

console.log('\n=== Test 6: linked identity with empty raw LINE ID -- no auto-fill from display name ===');
{
  const job = notionPageToJob(fakePage({
    lineId: '',
    lineDisplayName: 'Nattakamon fern',
    lineLinked: true
  }), 0);
  assert(job.line.publicId === '', 'job.line.publicId stays empty', job.line.publicId);
  assert(job.line.displayName === 'Nattakamon fern', 'job.line.displayName untouched', job.line.displayName);
  assert(job.line.linked === true, 'job.line.linked untouched', job.line.linked);
  assert(job.draft.fields['ci-line'] === '', 'ci-line stays empty -- never auto-filled from the verified display name', job.draft.fields['ci-line']);
}

console.log('\n=== CASE C (spec): unlinked + public LINE ID exists -- ci-line shows it, no verified claim ===');
{
  const job = notionPageToJob(fakePage({
    lineId: 'nattakamon123',
    lineLinked: false
  }), 0);
  assert(job.draft.fields['ci-line'] === 'nattakamon123', 'ci-line shows the raw LINE ID', job.draft.fields['ci-line']);
  assert(job.line.linked === false, 'job.line.linked stays false -- unrelated to publicId being set', job.line.linked);
}

console.log('\n=== CASE D (spec): unlinked + empty LINE ID -- ci-line empty ===');
{
  const job = notionPageToJob(fakePage({ lineLinked: false }), 0);
  assert(job.draft.fields['ci-line'] === '', 'ci-line stays empty', job.draft.fields['ci-line']);
  assert(job.line.linked === false, 'job.line.linked stays false', job.line.linked);
}

console.log('\n=== updateLineVerifiedBadge: badge rendering logic (job-state.js, loaded via vm) ===');
{
  const fakeElements = {};
  function makeEl(initial = '') {
    const classes = new Set();
    return {
      _value: initial, textContent: '',
      classList: {
        toggle(cls, on) { on ? classes.add(cls) : classes.delete(cls); },
        contains(cls) { return classes.has(cls); }
      }
    };
  }
  fakeElements['line-verified-badge'] = makeEl();
  const sandbox = {
    console,
    document: { getElementById: (id) => fakeElements[id] || null },
    t: (key) => (key === 'preassess.lineVerifiedAs' ? 'Verified as' : key)
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(ROOT, 'src/js/job-state.js'), 'utf8');
  // Only updateLineVerifiedBadge is under test here; extract it so this
  // stays independent of the rest of job-state.js's much larger surface
  // (consistent with this file's own convention of testing one function).
  const match = src.match(/function updateLineVerifiedBadge\([\s\S]*?\n}\n/);
  assert(!!match, 'updateLineVerifiedBadge() found in src/js/job-state.js (test in sync with the fix)');
  vm.runInContext(match[0], sandbox, { filename: 'job-state.js' });

  console.log('\n=== Test 1: linked + public ID -- badge visible with verified name ===');
  sandbox.updateLineVerifiedBadge({ line: { linked: true, displayName: 'Nattakamon fern', publicId: 'nattakamon123' } });
  assert(!fakeElements['line-verified-badge'].classList.contains('hidden'), 'badge is visible when linked');
  assert(fakeElements['line-verified-badge'].textContent.includes('Nattakamon fern'), 'badge text includes the verified display name', fakeElements['line-verified-badge'].textContent);

  console.log('\n=== Test 2: linked + no public ID -- badge still visible with verified name ===');
  sandbox.updateLineVerifiedBadge({ line: { linked: true, displayName: 'Nattakamon fern', publicId: '' } });
  assert(!fakeElements['line-verified-badge'].classList.contains('hidden'), 'badge still visible (linked identity independent of publicId)');
  assert(fakeElements['line-verified-badge'].textContent.includes('Nattakamon fern'), 'badge still shows the verified name');

  console.log('\n=== Test 3: unlinked + public ID -- badge hidden ===');
  sandbox.updateLineVerifiedBadge({ line: { linked: false, displayName: '', publicId: 'nattakamon123' } });
  assert(fakeElements['line-verified-badge'].classList.contains('hidden'), 'badge hidden when not linked');
}

console.log('\n=== Test 4: editing Public LINE ID does not change verified identity (mergeApiCaseIntoJob/loadJobsFromApi paths untouched by this task) ===');
{
  // This task did not touch mergeApiCaseIntoJob/preferLinePublicId/
  // preferContactFields at all (grep confirms no edits outside mapper.js,
  // preassessment.html, i18n.js, job-state.js's loadJobState/writeField
  // area) -- those already-deployed freshness/identity-preservation
  // mechanisms are exercised by scripts/test-contact-sync-staleness-fix.js
  // and remain the authority for this behavior. Confirmed here only that
  // changing which Notion property feeds ci-line does not touch job.line's
  // identity fields in notionPageToJob itself.
  const before = notionPageToJob(fakePage({
    lineId: 'oldid', lineUserId: 'U123', lineDisplayName: 'Nattakamon fern', lineLinked: true
  }), 0);
  const after = notionPageToJob(fakePage({
    lineId: 'newid', lineUserId: 'U123', lineDisplayName: 'Nattakamon fern', lineLinked: true
  }), 0);
  assert(after.draft.fields['ci-line'] === 'newid', 'ci-line reflects the new public id', after.draft.fields['ci-line']);
  assert(after.line.userId === before.line.userId, 'userId unchanged by a publicId edit', after.line.userId);
  assert(after.line.displayName === before.line.displayName, 'displayName unchanged by a publicId edit', after.line.displayName);
  assert(after.line.linked === before.line.linked, 'linked unchanged by a publicId edit', after.line.linked);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
