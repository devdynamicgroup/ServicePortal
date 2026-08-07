/**
 * Event Dispatcher — Workflow/observers emit here; UI never called directly.
 */
(function initNotificationDispatcher(global) {
  const handlers = new Set();

  async function emit(eventName, payload = {}) {
    if (!eventName) return null;
    let created = null;
    try {
      if (global.OperatorNotificationService?.createFromEvent) {
        created = await global.OperatorNotificationService.createFromEvent(eventName, payload);
      }
    } catch (error) {
      console.warn('[notifications] dispatch failed', eventName, error);
    }
    handlers.forEach(fn => {
      try { fn(eventName, payload, created); } catch (error) {
        console.warn('[notifications] handler error', error);
      }
    });
    return created;
  }

  function on(fn) {
    if (typeof fn !== 'function') return () => {};
    handlers.add(fn);
    return () => handlers.delete(fn);
  }

  global.OperatorNotificationDispatcher = { emit, on };
})(typeof globalThis !== 'undefined' ? globalThis : window);
