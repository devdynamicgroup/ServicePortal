/**
 * Regression test for the per-Case QR CTA badge on the score-share poster
 * (2026-08-27, direct request: "customers shouldn't have to type a code to
 * link LINE"). Closes the loop opened by the LIFF bind flow -- the QR a
 * customer scans on their poster must now encode THEIR OWN Case's LIFF
 * bind link (auto-connects LINE, no typing), not a generic static
 * "add this OA as a friend" image identical for every customer.
 *
 * Run: node scripts/test-score-card-qr-badge.js
 */
'use strict';
const assert = require('assert');
const {
  cardOptionsFromJob,
  renderDynamicCtaBadge,
  resolveCtaBadge
} = require('../services/score-share-card');

let passed = 0;
let failed = 0;
function ok(name) { passed += 1; console.log(`  ok    ${name}`); }
function fail(name, err) { failed += 1; console.error(`  FAIL  ${name}: ${err && err.message ? err.message : err}`); }
function check(fn, name) {
  try { fn(); ok(name); } catch (e) { fail(name, e); }
}
async function checkAsync(fn, name) {
  try { await fn(); ok(name); } catch (e) { fail(name, e); }
}

console.log('=== cardOptionsFromJob(job) -- feedbackToken plumbing ===');
check(() => {
  const opts = cardOptionsFromJob({ feedback: { token: 'fb-tq3x' } }, {});
  assert.strictEqual(opts.feedbackToken, 'fb-tq3x');
}, 'reads job.feedback.token when no override given');
check(() => {
  const opts = cardOptionsFromJob({ feedback: { token: 'fb-from-job' } }, { feedbackToken: 'fb-override' });
  assert.strictEqual(opts.feedbackToken, 'fb-override');
}, 'explicit override wins over job.feedback.token');
check(() => {
  const opts = cardOptionsFromJob({}, {});
  assert.strictEqual(opts.feedbackToken, '');
}, 'missing token on both job and overrides -> empty string, not undefined/throw (e.g. the tokenless /demo route)');

console.log('\n=== renderDynamicCtaBadge(feedbackToken) ===');
(async () => {
  await checkAsync(async () => {
    const badge = await renderDynamicCtaBadge('');
    assert.strictEqual(badge, null);
  }, 'empty token -> null (caller must fall back to the static asset)');

  await checkAsync(async () => {
    const badge = await renderDynamicCtaBadge('fb-tq3x');
    assert.ok(badge, 'badge should be generated');
    assert.ok(badge.href.startsWith('data:image/png;base64,'), 'returns a PNG data URI, same shape as loadAsset()');
    assert.strictEqual(badge.size.width, 294);
    assert.strictEqual(badge.size.height, 342);
  }, 'valid token -> generates a badge with the same footprint as the static score-share-cta-badge.png it replaces (no assetLayer() position changes needed)');

  await checkAsync(async () => {
    const a = await renderDynamicCtaBadge('fb-aaaa');
    const b = await renderDynamicCtaBadge('fb-bbbb');
    assert.notStrictEqual(a.href, b.href);
  }, 'different tokens produce visibly different QR images (each Case gets its own link, not a shared one)');

  await checkAsync(async () => {
    const a1 = await renderDynamicCtaBadge('fb-tq3x');
    const a2 = await renderDynamicCtaBadge('fb-tq3x');
    assert.strictEqual(a1.href, a2.href);
  }, 'the same token deterministically produces the same badge image (no hidden randomness/timestamps baked in)');

  console.log('\n=== resolveCtaBadge(feedbackToken) -- fallback behavior ===');
  await checkAsync(async () => {
    const badge = await resolveCtaBadge('');
    assert.ok(badge, 'must still return something for the tokenless /demo route');
    assert.strictEqual(badge.size.width, 294);
  }, 'no token -> falls back to the static badge/QR asset, does not return null to the renderer');

  await checkAsync(async () => {
    const badge = await resolveCtaBadge('fb-tq3x');
    const direct = await renderDynamicCtaBadge('fb-tq3x');
    assert.strictEqual(badge.href, direct.href, 'resolveCtaBadge with a token must return the SAME dynamic per-Case image renderDynamicCtaBadge produces directly -- not silently fall through to the shared static asset');
  }, 'valid token -> returns the dynamic per-Case badge, not the static fallback');

  await checkAsync(async () => {
    const withToken = await resolveCtaBadge('fb-tq3x');
    const withoutToken = await resolveCtaBadge('');
    assert.notStrictEqual(withToken.href, withoutToken.href, 'a Case with a token must get a different (per-Case) badge than the tokenless static fallback');
  }, 'tokened vs tokenless requests produce genuinely different badge images');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
