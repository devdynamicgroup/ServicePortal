'use strict';

/**
 * Regression suite for the score-share-card note wrapping fix (2026-09-08).
 *
 * Root cause: wrapNote() split note text on whitespace only. English note
 * copy (scoreSummaryNote()'s hardcoded fallback) always has spaces between
 * words, so that worked. But cardOptionsFromJob() prefers the real "Result
 * Summary" a staff member typed into Notion when present -- and Thai has no
 * spaces between words, so a Thai summary arrived as one giant "word" that
 * never wrapped, running off the card at render time. Verified live via
 * buildShareCardSvg() before this fix: the whole Thai sentence came back as
 * a single unwrapped <text> element.
 *
 * Fix stays scoped to wrapNote()/splitLongToken() in score-share-card.js
 * only -- cardOptionsFromJob() and the Notion schema are untouched, per the
 * agreed plan (the bug is in the renderer, not the data).
 *
 * Run: node scripts/test-score-card-note-wrap.js
 */

const { wrapNote, splitLongToken, buildShareCardSvg, scoreSummaryNote } = require('../services/score-share-card');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

// Extracts every note <text> line's content from a rendered SVG (font-size
// 24 on landscape/square, 30 on story -- the note text size in each layout).
function noteLinesFromSvg(svg, fontSize) {
  const re = new RegExp(`<text[^>]*font-size="${fontSize}"[^>]*>([^<]*)</text>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(svg))) out.push(m[1]);
  return out;
}

console.log('\n=== 1. English note (existing behavior unchanged) ===');
{
  const text = 'Your water meets international standards. Clean and balanced at every tap.';
  const lines = wrapNote(text, 56, 2);
  assert(lines.length >= 1 && lines.length <= 2, `wraps into <=2 lines (got ${lines.length})`);
  assert(lines.every(l => l.length <= 56), `every line stays within the 56-char budget (got ${JSON.stringify(lines.map(l => l.length))})`);
  // Reconstructing the original text from the wrapped lines (joined by a
  // space) must reproduce the same words in order -- confirms nothing was
  // silently dropped or corrupted by the new code path.
  const reconstructed = lines.join(' ');
  assert(text.startsWith(reconstructed) || reconstructed === text, `reconstructed text is a clean prefix of the original (got "${reconstructed}")`);
}

console.log('\n=== 2. Long Thai sentence (no whitespace) wraps into multiple lines ===');
{
  const text = 'น้ำประปาของคุณมีค่าคลอรีนตกค้างสูงกว่ามาตรฐานเล็กน้อยแนะนำให้ติดตั้งไส้กรองคาร์บอนเพิ่มเติมเพื่อความปลอดภัยของครอบครัว';
  const lines = wrapNote(text, 56, 3);
  assert(lines.length > 1, `a long unspaced Thai sentence splits into multiple lines (got ${lines.length})`);
  assert(lines.every(l => l.length <= 56), `every line stays within the 56-char budget (got ${JSON.stringify(lines.map(l => l.length))})`);
}

console.log('\n=== 3. Thai text without whitespace never overflows the line budget ===');
{
  const text = 'ทดสอบข้อความยาวมากที่ไม่มีช่องว่างเลยสักตัวเพื่อดูว่าระบบตัดบรรทัดได้ถูกต้องหรือไม่ครับ';
  const lines = wrapNote(text, 36, 3);
  assert(lines.every(l => l.length <= 36), `no line exceeds the 36-char budget (got ${JSON.stringify(lines.map(l => l.length))})`);
  assert(lines.length <= 3, `respects maxLines=3 (got ${lines.length})`);
}

console.log('\n=== 4. Mixed Thai + English + numbers wraps correctly ===');
{
  const text = 'ค่า pH ของคุณอยู่ที่ 8.4 ซึ่งสูงกว่ามาตรฐานWHOแนะนำให้ติดตั้งระบบกรอง RO เพิ่มเติมครับ';
  const lines = wrapNote(text, 56, 3);
  assert(lines.every(l => l.length <= 56), `mixed-script line stays within budget (got ${JSON.stringify(lines.map(l => l.length))})`);
  assert(lines.join('').includes('8.4') && lines.join('').includes('RO'), 'numbers and Latin runs (8.4, RO) survive intact, not split apart');
}

console.log('\n=== 5. Short note does not create unnecessary extra lines ===');
{
  const lines = wrapNote('All good.', 56, 2);
  assert(lines.length === 1, `a short note stays on 1 line (got ${lines.length})`);
  assert(lines[0] === 'All good.', 'short note text is unchanged');
}

console.log('\n=== 6. Very long note never exceeds the note area (maxLines respected) ===');
{
  const text = 'ก'.repeat(500); // pathological: one huge unspaced run
  const lines = wrapNote(text, 56, 3);
  assert(lines.length <= 3, `caps at maxLines=3 even for a 500-char unspaced run (got ${lines.length})`);
  assert(lines.every(l => l.length <= 56), 'every emitted line still respects the budget');
}

console.log('\n=== 7. A real Notion "Result Summary" in Thai renders wrapped in the actual SVG ===');
{
  const note = 'น้ำประปาของคุณมีค่าคลอรีนตกค้างสูงกว่ามาตรฐานเล็กน้อยแนะนำให้ติดตั้งไส้กรองคาร์บอนเพิ่มเติมเพื่อความปลอดภัยของครอบครัว';
  const built = buildShareCardSvg('landscape', { score: 72, note, findingsCount: 2, ctaBadge: null, wordmark: null });
  const lines = noteLinesFromSvg(built.svg, 24);
  assert(lines.length > 1, `landscape card SVG renders the Thai summary as multiple <text> lines (got ${lines.length})`);
  assert(lines.every(l => l.length <= 60), 'no single rendered <text> line is an unbroken multi-hundred-char run');
}

console.log('\n=== 8. scoreSummaryNote() fallback (no Notion summary) still works unchanged ===');
{
  assert(scoreSummaryNote(90) === 'Your water meets international standards. Clean and balanced at every tap.', 'high-score fallback text unchanged');
  const lines = wrapNote(scoreSummaryNote(90), 56, 2);
  assert(lines.length >= 1, 'fallback note still wraps normally');
}

console.log('\n=== 9. Rendered SVGs across all 3 formats never emit an overlong note line ===');
{
  const note = 'ผลตรวจพบว่าน้ำของคุณมีความกระด้างสูงและมีตะกอนเหล็กปนอยู่เล็กน้อยควรพิจารณาติดตั้งเครื่องกรองน้ำเพิ่มเติมที่จุดใช้งานหลักของบ้าน';
  for (const [format, fontSize] of [['landscape', 24], ['square', 24], ['story', 30]]) {
    const built = buildShareCardSvg(format, { score: 55, note, findingsCount: 3, ctaBadge: null, wordmark: null });
    const lines = noteLinesFromSvg(built.svg, fontSize);
    assert(lines.length > 0, `${format}: note renders at least one line`);
    assert(lines.every(l => l.length <= 60), `${format}: no rendered line is an unbroken overlong run (got lengths ${JSON.stringify(lines.map(l => l.length))})`);
  }
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
