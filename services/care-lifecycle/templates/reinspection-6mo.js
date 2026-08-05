'use strict';

/**
 * 6-month re-inspection care reminder (Thai care tone).
 */

const {
  resolveLineBookingUrl,
  withQuickReply
} = require('../../line-notifications');

const TEMPLATE_VERSION = 'reinspection_6mo.v1';

function buildReinspection6moTextMessage() {
  const bookingUrl = resolveLineBookingUrl();
  const text = [
    'ผ่านมาแล้วประมาณ 6 เดือนนับจากการตรวจคุณภาพน้ำครั้งล่าสุด',
    'คุณภาพน้ำอาจเปลี่ยนแปลงได้ตามสภาพท่อ ระบบกรอง หรือแหล่งน้ำที่ใช้งาน',
    'เพื่อความสะอาดและความปลอดภัยในการใช้น้ำ แนะนำให้ตรวจคุณภาพน้ำอีกครั้ง',
    '',
    `นัดตรวจ: ${bookingUrl}`
  ].join('\n');

  return withQuickReply({
    type: 'text',
    text
  });
}

function buildReinspection6moMessages() {
  return [buildReinspection6moTextMessage()];
}

module.exports = {
  TEMPLATE_VERSION,
  buildReinspection6moTextMessage,
  buildReinspection6moMessages
};
