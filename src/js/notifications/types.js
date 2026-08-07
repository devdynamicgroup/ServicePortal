/**
 * Operator Notification Center — domain types (Phase 1).
 * Independent of Case workflow / LINE delivery internals.
 */
(function initNotificationTypes(global) {
  const NOTIFICATION_TYPES = Object.freeze({
    NEW_CASE: 'NEW_CASE',
    CASE_ASSIGNED: 'CASE_ASSIGNED',
    TOMORROW_REMINDER: 'TOMORROW_REMINDER',
    TODAY_JOBS: 'TODAY_JOBS',
    RESULT_SENT: 'RESULT_SENT',
    LINE_FAILED: 'LINE_FAILED',
    OVERDUE: 'OVERDUE'
  });

  const NOTIFICATION_PRIORITY = Object.freeze({
    INFO: 'INFO',
    SUCCESS: 'SUCCESS',
    WARNING: 'WARNING',
    CRITICAL: 'CRITICAL'
  });

  const NOTIFICATION_ACTION = Object.freeze({
    OPEN_CASE: 'OPEN_CASE',
    OPEN_CASE_LIST: 'OPEN_CASE_LIST',
    RETRY_LINE: 'RETRY_LINE',
    VIEW_SCHEDULE: 'VIEW_SCHEDULE',
    NONE: 'NONE'
  });

  const TYPE_META = Object.freeze({
    NEW_CASE: { priority: 'INFO', action: 'OPEN_CASE', category: 'schedule' },
    CASE_ASSIGNED: { priority: 'INFO', action: 'OPEN_CASE', category: 'service' },
    TOMORROW_REMINDER: { priority: 'INFO', action: 'VIEW_SCHEDULE', category: 'schedule' },
    TODAY_JOBS: { priority: 'INFO', action: 'OPEN_CASE_LIST', category: 'schedule' },
    RESULT_SENT: { priority: 'SUCCESS', action: 'OPEN_CASE', category: 'service' },
    LINE_FAILED: { priority: 'CRITICAL', action: 'RETRY_LINE', category: 'service' },
    OVERDUE: { priority: 'WARNING', action: 'OPEN_CASE', category: 'service' }
  });

  global.OperatorNotificationTypes = {
    NOTIFICATION_TYPES,
    NOTIFICATION_PRIORITY,
    NOTIFICATION_ACTION,
    TYPE_META
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
