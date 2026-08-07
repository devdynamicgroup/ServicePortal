/**
 * Thin bridge for portal hooks (assignment / close result).
 * Keeps business files free of Notification UI imports.
 */
(function initNotificationBridge(global) {
  const Events = () => global.OperatorNotificationEvents.NOTIFICATION_EVENTS;
  const Utils = () => global.OperatorNotificationUtils;

  async function emitCaseAssigned(job, options = {}) {
    if (!job || !global.OperatorNotificationDispatcher) return null;
    const id = Utils().caseKey(job);
    if (!id) return null;
    return global.OperatorNotificationDispatcher.emit(Events().CASE_ASSIGNED, {
      caseId: id,
      customerName: job.name || '',
      assigneeName: options.assigneeName || 'Water Motion Specialist',
      assignedToOther: Boolean(options.assignedToOther),
      dedupeKey: `case_assigned:${id}`,
      payload: {}
    });
  }

  async function emitFromCloseResult(job, payload = {}) {
    if (!job || !global.OperatorNotificationDispatcher) return null;
    const id = Utils().caseKey(job);
    const name = job.name || '';
    const lineStatus = String(
      payload.line?.status
      || payload.case?.notification?.status
      || job.notification?.status
      || ''
    ).toLowerCase();
    const lineOk = Boolean(payload.line?.ok) || lineStatus === 'sent';
    const reason = payload.line?.reason || payload.line?.error || job.notification?.lastError || lineStatus;

    if (lineOk || lineStatus === 'sent') {
      return global.OperatorNotificationDispatcher.emit(Events().RESULT_SENT, {
        caseId: id,
        customerName: name,
        dedupeKey: `result_sent:${id}`,
        payload: { lineStatus }
      });
    }

    if (lineStatus === 'failed' || lineStatus === 'skipped' || reason === 'no_line_user_id') {
      return global.OperatorNotificationDispatcher.emit(Events().LINE_FAILED, {
        caseId: id,
        customerName: name,
        reason: reason || lineStatus,
        dedupeKey: `line_failed:${id}:${String(reason || lineStatus).slice(0, 40)}`,
        payload: { lineStatus, reason }
      });
    }

    // Completed without LINE attempt still surfaces as soft LINE_FAILED guidance.
    if (lineStatus === 'not_sent' || lineStatus === 'ready') {
      return global.OperatorNotificationDispatcher.emit(Events().LINE_FAILED, {
        caseId: id,
        customerName: name,
        reason: 'no_line_user_id',
        dedupeKey: `line_failed:${id}:not_linked`,
        payload: { lineStatus }
      });
    }

    return null;
  }

  async function emitCaseCreatedFromJob(job) {
    if (!job || !global.OperatorNotificationDispatcher) return null;
    const payload = global.OperatorNotificationMapper.fromJobCreated(job);
    const seen = global.OperatorNotificationRepository.loadSeenCaseIds();
    seen.add(payload.caseId);
    global.OperatorNotificationRepository.saveSeenCaseIds(seen);
    return global.OperatorNotificationDispatcher.emit(
      global.OperatorNotificationEvents.NOTIFICATION_EVENTS.CASE_CREATED,
      payload
    );
  }

  global.OperatorNotificationBridge = {
    emitCaseAssigned,
    emitFromCloseResult,
    emitCaseCreatedFromJob,
    syncFromJobs: (...args) => global.OperatorNotificationObserver?.syncFromJobs(...args)
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
