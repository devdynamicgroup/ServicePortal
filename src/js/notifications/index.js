/**
 * Operator Notification Center — Phase 1 bootstrap.
 */
(function initOperatorNotifications(global) {
  global.OperatorNotifications = {
    version: 'phase1',
    async init() {
      if (typeof global.initOperatorNotificationCenter === 'function') {
        await global.initOperatorNotificationCenter();
      }
      if (Array.isArray(global.JOBS) && global.OperatorNotificationObserver) {
        await global.OperatorNotificationObserver.syncFromJobs(global.JOBS);
      }
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
