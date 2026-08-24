/**
 * NotificationRepository — swappable persistence.
 * Phase 1: LocalStorageNotificationRepository
 * Future: NotionNotificationRepository / DatabaseNotificationRepository
 */
(function initNotificationRepository(global) {
  const STORAGE_KEY = 'wm-operator-notifications-v1';
  const SEEN_CASES_KEY = 'wm-operator-notif-seen-cases-v1';

  // Retention (BUG-03): nothing capped how many notifications accumulated
  // forever, so a long-lived install could eventually hit the same
  // localStorage quota exhaustion already observed for wm-jobs. Combine a
  // hard count cap and an age cutoff — but ONLY ever against READ
  // notifications. An unread notification (an unresolved LINE_FAILED, a
  // NEW_CASE nobody has opened yet) represents something the operator may
  // still need to act on, so it is never removed by either rule, even past
  // the cap or the age cutoff.
  const MAX_NOTIFICATIONS = 200;
  const MAX_NOTIFICATION_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  class MemoryNotificationRepository {
    constructor() {
      this._items = [];
    }

    _applyRetention(now = Date.now()) {
      this._items = this._items.filter(item => {
        if (item.read && (now - (item.createdAt || 0)) > MAX_NOTIFICATION_AGE_MS) return false;
        return true;
      });

      if (this._items.length > MAX_NOTIFICATIONS) {
        const over = this._items.length - MAX_NOTIFICATIONS;
        const readOldestFirst = this._items
          .filter(item => item.read)
          .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        const toDrop = new Set(readOldestFirst.slice(0, over).map(item => item.id));
        if (toDrop.size) this._items = this._items.filter(item => !toDrop.has(item.id));
      }
    }

    async list() {
      return this._items.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    async getById(id) {
      return this._items.find(item => item.id === id) || null;
    }

    async findByDedupeKey(dedupeKey) {
      if (!dedupeKey) return null;
      return this._items.find(item => item.dedupeKey === dedupeKey) || null;
    }

    async save(notification) {
      const idx = this._items.findIndex(item => item.id === notification.id);
      if (idx >= 0) this._items[idx] = notification;
      else this._items.unshift(notification);
      this._applyRetention();
      return notification;
    }

    async markRead(id) {
      const item = await this.getById(id);
      if (!item) return null;
      item.read = true;
      item.readAt = Date.now();
      return this.save(item);
    }

    async markAllRead() {
      const now = Date.now();
      this._items.forEach(item => {
        item.read = true;
        item.readAt = item.readAt || now;
      });
      // Marking everything read makes previously-protected items eligible
      // for age-based retention for the first time -- re-evaluate now
      // rather than waiting for the next save().
      this._applyRetention(now);
      return this.list();
    }

    async clearRead() {
      this._items = this._items.filter(item => !item.read);
      return this.list();
    }

    async unreadCount() {
      return this._items.filter(item => !item.read).length;
    }
  }

  class LocalStorageNotificationRepository extends MemoryNotificationRepository {
    constructor(storageKey = STORAGE_KEY) {
      super();
      this.storageKey = storageKey;
      this._hydrate();
    }

    _hydrate() {
      try {
        const raw = localStorage.getItem(this.storageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        this._items = Array.isArray(parsed) ? parsed : [];
      } catch {
        this._items = [];
      }
    }

    _persist() {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this._items));
      } catch (error) {
        console.warn('[notifications] persist failed', error);
      }
    }

    async save(notification) {
      const saved = await super.save(notification);
      this._persist();
      return saved;
    }

    async markRead(id) {
      const saved = await super.markRead(id);
      this._persist();
      return saved;
    }

    async markAllRead() {
      const list = await super.markAllRead();
      this._persist();
      return list;
    }

    async clearRead() {
      const list = await super.clearRead();
      this._persist();
      return list;
    }
  }

  function loadSeenCaseIds() {
    try {
      const raw = localStorage.getItem(SEEN_CASES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
      return new Set();
    }
  }

  function saveSeenCaseIds(set) {
    try {
      localStorage.setItem(SEEN_CASES_KEY, JSON.stringify([...set]));
    } catch (error) {
      console.warn('[notifications] seen-cases persist failed', error);
    }
  }

  // Clears every device-local notification record for a sign-out — the
  // notification/seen-case history is specific to whoever was signed in,
  // and (unlike wm-csv-seed-version or the language preference) must not
  // still be visible to the next person who signs in on the same device.
  function clearAllNotificationData() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SEEN_CASES_KEY);
    } catch (error) {
      console.warn('[notifications] clear-all failed', error);
    }
  }

  global.OperatorNotificationRepository = {
    MemoryNotificationRepository,
    LocalStorageNotificationRepository,
    STORAGE_KEY,
    SEEN_CASES_KEY,
    loadSeenCaseIds,
    saveSeenCaseIds,
    clearAllNotificationData
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
