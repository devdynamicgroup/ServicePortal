/**
 * Observes portal JOBS snapshots — emits operator notifications without
 * modifying Case / LINE / Score / OCR business logic.
 */
(function initNotificationObserver(global) {
  const Events = () => global.OperatorNotificationEvents.NOTIFICATION_EVENTS;
  const Utils = () => global.OperatorNotificationUtils;
  const Repo = () => global.OperatorNotificationRepository;
  const Mapper = () => global.OperatorNotificationMapper;

  let bootstrapped = false;

  function isCancelled(job) {
    const status = String(job?.status || '').toLowerCase();
    const workflow = String(job?.workflow?.status || '').toLowerCase();
    return ['cancelled', 'canceled'].includes(status)
      || ['cancelled', 'canceled'].includes(workflow);
  }

  async function detectNewCases(jobs) {
    const { caseKey } = Utils();
    const seen = Repo().loadSeenCaseIds();
    const currentIds = [];
    const fresh = [];

    (jobs || []).forEach(job => {
      if (isCancelled(job) || job.manualPending) return;
      const id = caseKey(job);
      if (!id) return;
      currentIds.push(id);
      if (!seen.has(id)) fresh.push(job);
    });

    // First sync after install: seed seen set without flooding the inbox.
    if (!bootstrapped && seen.size === 0 && currentIds.length) {
      currentIds.forEach(id => seen.add(id));
      Repo().saveSeenCaseIds(seen);
      bootstrapped = true;
      return [];
    }
    bootstrapped = true;

    const created = [];
    for (const job of fresh) {
      const payload = Mapper().fromJobCreated(job);
      seen.add(payload.caseId);
      created.push(await global.OperatorNotificationDispatcher.emit(Events().CASE_CREATED, payload));
    }
    if (fresh.length) Repo().saveSeenCaseIds(seen);
    return created;
  }

  async function detectLineFailed(jobs) {
    const { caseKey } = Utils();
    const created = [];
    for (const job of jobs || []) {
      if (isCancelled(job)) continue;
      const status = String(job.notification?.status || '').toLowerCase();
      if (status !== 'failed') continue;
      const id = caseKey(job);
      if (!id) continue;
      const err = String(job.notification?.lastError || 'failed');
      created.push(await global.OperatorNotificationDispatcher.emit(Events().LINE_FAILED, {
        caseId: id,
        customerName: job.name || '',
        reason: err,
        dedupeKey: `line_failed:${id}:${err.slice(0, 40)}`,
        payload: { status, error: err }
      }));
    }
    return created;
  }

  /**
   * Main sync entry — call after JOBS refresh / dashboard open.
   * Does not mutate jobs.
   */
  async function syncFromJobs(jobs) {
    if (!global.OperatorNotificationDispatcher) return;
    const list = Array.isArray(jobs) ? jobs : (global.JOBS || []);
    try {
      await detectNewCases(list);
      await detectLineFailed(list);
      if (global.OperatorNotificationScheduler) {
        await global.OperatorNotificationScheduler.runAll(list);
      }
      if (global.OperatorNotificationService?.refreshStore) {
        await global.OperatorNotificationService.refreshStore();
      }
      if (typeof global.refreshNotificationUi === 'function') {
        global.refreshNotificationUi();
      }
    } catch (error) {
      console.warn('[notifications] syncFromJobs failed', error);
    }
  }

  global.OperatorNotificationObserver = {
    syncFromJobs,
    detectNewCases,
    detectLineFailed
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
