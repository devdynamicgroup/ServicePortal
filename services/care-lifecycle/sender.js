'use strict';

/**
 * Care LINE sender — does not touch Case notification state.
 */

const { sendLinePush } = require('../line-notifications');
const { buildReinspection6moMessages } = require('./templates/reinspection-6mo');
const { CARE_EVENT_TYPES } = require('./events');

async function sendCareMessages(plan, options = {}) {
  const lineUserId = String(plan?.destination?.lineUserId || '').trim();
  if (!lineUserId) {
    return { ok: false, status: 'missing_user_id', messageId: '' };
  }

  const eventType = plan.eventType || CARE_EVENT_TYPES.REINSPECTION_6MO;
  let messages = options.messages;
  if (!messages) {
    if (eventType === CARE_EVENT_TYPES.REINSPECTION_6MO) {
      messages = buildReinspection6moMessages();
    } else {
      return { ok: false, status: 'unsupported_event', messageId: '' };
    }
  }

  const sendFn = options.sendLinePush || sendLinePush;
  return sendFn(lineUserId, messages, {
    careEventType: eventType,
    caseId: plan.eligibility?.caseId || null,
    notionId: plan.eligibility?.caseNotionId || null,
    idempotencyKey: plan.eligibility?.idempotencyKey || null
  });
}

module.exports = {
  sendCareMessages
};
