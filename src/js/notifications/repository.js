/**
 * NotificationRepository — swappable persistence.
 * Phase 1: LocalStorageNotificationRepository
 * Future: NotionNotificationRepository / DatabaseNotificationRepository
 */
(function initNotificationRepository(global) {
  const STORAGE_KEY = 'wm-operator-notifications-v1';
  const SEEN_CASES_KEY = 'wm-operator-notif-seen-cases-v1';
  const SCHEDULE_MARKERS_KEY = 'wm-operator-notif-schedule-markers-v1';

  class MemoryNotificationRepository {
    constructor() {
      this._items = [];
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

  function loadScheduleMarkers() {
    try {
      const raw = localStorage.getItem(SCHEDULE_MARKERS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveScheduleMarkers(markers) {
    try {
      localStorage.setItem(SCHEDULE_MARKERS_KEY, JSON.stringify(markers || {}));
    } catch (error) {
      console.warn('[notifications] schedule markers persist failed', error);
    }
  }

  global.OperatorNotificationRepository = {
    MemoryNotificationRepository,
    LocalStorageNotificationRepository,
    STORAGE_KEY,
    SEEN_CASES_KEY,
    SCHEDULE_MARKERS_KEY,
    loadSeenCaseIds,
    saveSeenCaseIds,
    loadScheduleMarkers,
    saveScheduleMarkers
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
