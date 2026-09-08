'use strict';

/**
 * Regression suite for the LINE OA copy/UX pass (2026-09-08), covering the
 * 5 findings from a full-repo review of every customer-facing LINE surface
 * (services/line-notifications.js, api/liff-routes.js):
 *
 *  1. Google Review button: feedbackUrl was computed and threaded all the
 *     way to buildCaseResultFlexMessage() but silently dropped -- the body
 *     text promised "review on Google" with no button anywhere to do it.
 *     Fixed by adding a second footer button -- but /f/{token} is Water
 *     Motion's OWN rating form first (case-flow-routes.js:
 *     customerFeedbackHtml), only surfacing the real Google review
 *     link/QR after that's submitted, so the button/body text must never
 *     say "on Google" directly or it repeats the exact same broken promise
 *     one level down.
 *  2. buildFollowWelcomeMessage assumed every fresh follower already had a
 *     completed inspection's QR to scan -- confusing for a genuinely new
 *     prospect with nothing yet. Now offers a real "start an inspection"
 *     path too, mirroring buildUnknownCustomerReply.
 *  3. buildContactAdminAckMessage promised "as soon as possible" staff
 *     follow-up with no notification system behind it (manual OA Manager
 *     inbox checks only) -- reworded to not imply an SLA.
 *  4. Customer name greeting had two different spacing styles between the
 *     LINE flex message ("สวัสดีคุณ {name}", space) and the LIFF bind page
 *     ("สวัสดีคุณ{name}", no space) -- normalized to the spaced form.
 *  5. The LIFF bind success page reused the default "will send when ready"
 *     text even for an "already linked" repeat scan, which read oddly for
 *     a customer whose result may have shipped long ago -- now shows a
 *     distinct "nothing more to do" message for that state.
 *
 * Scope lock (per the agreed plan): only services/line-notifications.js and
 * api/liff-routes.js. Does not touch linkLineUser(), feedbackToken
 * generation, LIFF binding, pendingAutoSend, sendCaseResult(),
 * score/publication, QR generation, or delivery logic.
 *
 * Run: node scripts/test-line-oa-copy-fixes.js
 */

const {
  buildCaseResultFlexMessage,
  buildFollowWelcomeMessage,
  buildContactAdminAckMessage
} = require('../services/line-notifications');
const { liffBindHtml } = require('../api/liff-routes');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed += 1; console.log(`  ok    ${msg}`); }
  else { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function findButtons(bubble) {
  return bubble?.footer?.contents || [];
}

console.log('\n=== Finding #1: review button, honest label, no direct "on Google" promise ===');
{
  // Non-free result with a feedbackUrl -> second button appears, correctly labeled.
  const msg = buildCaseResultFlexMessage({
    resultLinkUrl: 'https://serviceportal.onrender.com/r/rpt-abc123',
    feedbackUrl: 'https://serviceportal.onrender.com/f/fb-xyz789',
    clientName: 'สมชาย',
    waterScore: 82,
    resultType: 'paid_assessment'
  });
  const buttons = findButtons(msg.contents);
  assert(buttons.length === 2, `paid result with feedbackUrl gets 2 footer buttons (got ${buttons.length})`);
  const reviewBtn = buttons.find(b => b.action?.uri === 'https://serviceportal.onrender.com/f/fb-xyz789');
  assert(!!reviewBtn, 'second button links to the real feedbackUrl (no new URL invented)');
  assert(reviewBtn && reviewBtn.action.label === 'ให้คะแนนบริการ',
    `second button label is honest about being a rating step, not "on Google" (got "${reviewBtn?.action?.label}")`);
  const bodyTexts = JSON.stringify(msg.contents.body);
  assert(!bodyTexts.includes('รีวิวบริการบน Google'),
    'body text no longer promises "review on Google" directly (the exact broken promise this fix closes)');
  assert(!JSON.stringify(msg).includes('รีวิวบริการบน Google'),
    'no part of the message (button or body) claims a direct Google review destination');

  // No feedbackUrl -> only the one button, no broken link.
  const msgNoFeedback = buildCaseResultFlexMessage({
    resultLinkUrl: 'https://serviceportal.onrender.com/r/rpt-abc123',
    feedbackUrl: '',
    clientName: 'สมชาย',
    waterScore: 82,
    resultType: 'paid_assessment'
  });
  assert(findButtons(msgNoFeedback.contents).length === 1,
    'no feedbackUrl => stays at 1 button, never a button with an empty/broken uri');

  // Free water check -> unchanged (no rating solicitation for the free tier).
  const msgFree = buildCaseResultFlexMessage({
    resultLinkUrl: 'https://serviceportal.onrender.com/r/rpt-free1',
    feedbackUrl: 'https://serviceportal.onrender.com/f/fb-free1',
    clientName: 'สมหญิง',
    waterScore: null,
    resultType: 'free_water_check'
  });
  assert(findButtons(msgFree.contents).length === 1,
    'free_water_check result stays at 1 button even with a feedbackUrl present (unchanged behavior)');
}

console.log('\n=== Finding #2: follow-welcome offers a real path for a brand-new prospect ===');
{
  const msg = buildFollowWelcomeMessage();
  const items = msg.quickReply?.items || [];
  const startAction = items.find(i => i.action?.type === 'uri' && i.action?.label === 'เริ่มตรวจคุณภาพน้ำ');
  assert(!!startAction, 'welcome message now offers a real "start an inspection" quick-reply action');
  assert(!!startAction?.action?.uri, 'that action has a real booking URL, not empty');
  assert(msg.text.includes('fb-xxxx') || msg.text.includes('QR'),
    'still mentions the QR/code path for an existing customer who already has one');
}

console.log('\n=== Finding #3: contact-admin ack does not promise a speed/SLA it cannot back ===');
{
  const msg = buildContactAdminAckMessage();
  assert(!msg.text.includes('โดยเร็วที่สุด'),
    `no longer implies an urgency/SLA guarantee with no notification system behind it (got "${msg.text}")`);
  assert(msg.text.trim().length > 0, 'still a real, non-empty reassuring reply');
}

console.log('\n=== Finding #4: customer-name greeting spacing is consistent across surfaces ===');
{
  const flexMsg = buildCaseResultFlexMessage({
    resultLinkUrl: 'https://serviceportal.onrender.com/r/rpt-abc123',
    feedbackUrl: '',
    clientName: 'สมชาย',
    waterScore: 82,
    resultType: 'paid_assessment'
  });
  const headerTexts = flexMsg.contents.body.contents[0].contents[1].contents;
  const greetingText = headerTexts[0].text;
  assert(greetingText === 'สวัสดีคุณ สมชาย', `flex message greeting has a space before the name (got "${greetingText}")`);

  const html = liffBindHtml('fb-test123', { clientName: 'สมชาย' });
  assert(html.includes('สวัสดีคุณ ${clientName}'.replace('${clientName}', 'สมชาย')) || html.includes('สวัสดีคุณ สมชาย'),
    'LIFF bind page greeting now uses the same spaced "สวัสดีคุณ {name}" form as the flex message');
  assert(!html.includes('สวัสดีคุณสมชาย'), 'LIFF bind page no longer uses the old no-space form');
}

console.log('\n=== Finding #5: LIFF bind page distinguishes "already linked" from "waiting" ===');
{
  const html = liffBindHtml('fb-test123', { clientName: 'สมชาย' });
  assert(html.includes("data.reason === 'already_linked'"), 'already_linked branch still present (test in sync)');
  const alreadyLinkedBlockMatch = html.match(/if \(data\.reason === 'already_linked'\) \{[\s\S]*?\}/);
  assert(!!alreadyLinkedBlockMatch, 'already_linked branch block found');
  assert(alreadyLinkedBlockMatch && alreadyLinkedBlockMatch[0].includes('ok-text'),
    'already_linked branch now also sets ok-text (not just the title), so it no longer inherits the default "will send when ready" copy');
  assert(alreadyLinkedBlockMatch && !alreadyLinkedBlockMatch[0].includes('ระบบจะส่งผลตรวจให้ทาง LINE เมื่อพร้อม'),
    'already_linked state no longer shows the "will send when ready" text meant for a genuinely pending case');
}

console.log('\n=== Untouched surfaces sanity check (scope lock) ===');
{
  // liffBindHtml with no feedback (invalid/expired token) is untouched.
  const notFoundHtml = liffBindHtml('bogus-token', null);
  assert(notFoundHtml.includes('ไม่พบรหัสนี้'), 'invalid-token page still renders unchanged');
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} -- ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
