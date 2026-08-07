/**
 * In-memory store + subscriber fan-out for Notification UI.
 */
(function initNotificationStore(global) {
  const listeners = new Set();
  let items = [];
  let filter = 'all';

  function notify() {
    const snapshot = {
      items: items.slice(),
      filter,
      unreadCount: items.filter(item => !item.read).length
    };
    listeners.forEach(fn => {
      try { fn(snapshot); } catch (error) {
        console.warn('[notifications] store listener error', error);
      }
    });
  }

  const store = {
    getState() {
      return {
        items: items.slice(),
        filter,
        unreadCount: items.filter(item => !item.read).length
      };
    },

    setItems(next) {
      items = Array.isArray(next) ? next.slice() : [];
      notify();
    },

    setFilter(next) {
      filter = next || 'all';
      notify();
    },

    getFilter() {
      return filter;
    },

    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };

  global.OperatorNotificationStore = store;
})(typeof globalThis !== 'undefined' ? globalThis : window);
