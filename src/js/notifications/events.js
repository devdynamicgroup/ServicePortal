/**
 * Notification domain events (operator-actionable only).
 */
(function initNotificationEvents(global) {
  const NOTIFICATION_EVENTS = Object.freeze({
    CASE_CREATED: 'CASE_CREATED',
    CASE_ASSIGNED: 'CASE_ASSIGNED',
    TOMORROW_REMINDER: 'TOMORROW_REMINDER',
    TODAY_JOBS: 'TODAY_JOBS',
    RESULT_SENT: 'RESULT_SENT',
    LINE_FAILED: 'LINE_FAILED',
    OVERDUE: 'OVERDUE'
  });

  global.OperatorNotificationEvents = { NOTIFICATION_EVENTS };
})(typeof globalThis !== 'undefined' ? globalThis : window);
