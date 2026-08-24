/**
 * Notification Service — create / read / clear.
 * Does not know about Case workflow or LINE SDK.
 */
(function initNotificationService(global) {
  let repository = null;

  async function ensureRepo() {
    if (repository) return repository;
    const Repo = global.OperatorNotificationRepository;
    repository = new Repo.LocalStorageNotificationRepository();
    return repository;
  }

  async function refreshStore() {
    const repo = await ensureRepo();
    const list = await repo.list();
    global.OperatorNotificationStore.setItems(list);
    return list;
  }

  async function createFromEvent(eventName, payload = {}) {
    const mapped = global.OperatorNotificationMapper.mapEventToNotification(eventName, payload);
    if (!mapped) return null;

    const repo = await ensureRepo();
    if (mapped.dedupeKey) {
      const existing = await repo.findByDedupeKey(mapped.dedupeKey);
      if (existing) return existing;
    }

    const saved = await repo.save(mapped);
    await refreshStore();
    return saved;
  }

  async function markRead(id) {
    const repo = await ensureRepo();
    await repo.markRead(id);
    return refreshStore();
  }

  async function markAllRead() {
    const repo = await ensureRepo();
    await repo.markAllRead();
    return refreshStore();
  }

  async function clearRead() {
    const repo = await ensureRepo();
    await repo.clearRead();
    return refreshStore();
  }

  async function list(filter = 'all') {
    const repo = await ensureRepo();
    const all = await repo.list();
    if (!filter || filter === 'all') return all;
    const Types = global.OperatorNotificationTypes.NOTIFICATION_TYPES;
    const categoryOf = (type) => {
      const meta = global.OperatorNotificationTypes.TYPE_META[type];
      return meta?.category || 'service';
    };
    // Phase 1 filters: all | schedule | service | unread | type:*
    if (filter === 'unread') return all.filter(item => !item.read);
    if (filter === 'schedule' || filter === 'service' || filter === 'billing') {
      return all.filter(item => categoryOf(item.type) === filter);
    }
    if (filter.startsWith('type:')) {
      const type = filter.slice(5);
      return all.filter(item => item.type === type);
    }
    if (Object.values(Types).includes(filter)) {
      return all.filter(item => item.type === filter);
    }
    return all;
  }

  async function unreadCount() {
    const repo = await ensureRepo();
    return repo.unreadCount();
  }

  // Forces the next ensureRepo() call to construct a brand new repository
  // instance instead of reusing the cached one. Needed on sign-out:
  // clearAllNotificationData() (repository.js) only clears localStorage —
  // the cached `repository` object's already-hydrated in-memory _items
  // array would otherwise keep serving the previous user's notifications
  // (and let a stale dedupeKey block the next user's identical-looking
  // event) until the page happened to reload, which this SPA never does
  // on sign-out.
  function resetRepository() {
    repository = null;
  }

  global.OperatorNotificationService = {
    createFromEvent,
    markRead,
    markAllRead,
    clearRead,
    list,
    unreadCount,
    refreshStore,
    resetRepository,
    setRepository(next) {
      repository = next;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
