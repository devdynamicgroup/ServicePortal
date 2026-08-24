/**
 * Schedule-derived operator notifications (tomorrow / today / overdue).
 * Runs on portal sync — not a server cron in Phase 1.
 */
(function initNotificationScheduler(global) {
  const Events = () => global.OperatorNotificationEvents.NOTIFICATION_EVENTS;
  const Utils = () => global.OperatorNotificationUtils;
  const Repo = () => global.OperatorNotificationRepository;

  function activeJobs(jobs) {
    return (jobs || []).filter(job => {
      const status = String(job.status || '').toLowerCase();
      const workflow = String(job.workflow?.status || '').toLowerCase();
      if (job.manualPending) return false;
      if (['cancelled', 'canceled', 'done'].includes(status)) return false;
      if (['cancelled', 'canceled'].includes(workflow)) return false;
      return true;
    });
  }

  function jobsOnIso(jobs, iso) {
    const { isoDateOnly } = Utils();
    return activeJobs(jobs).filter(job => isoDateOnly(job.date) === iso);
  }

  // Stable, order-independent fingerprint of which Cases are eligible right
  // now. Used as (part of) the dedupeKey instead of a once-per-day boolean
  // marker — a boolean marker can only ever mean "did I check today", which
  // is indistinguishable from "did I already tell the operator about every
  // Case that's eligible today". Those are different facts: a Case created
  // AFTER the first empty check must still produce a reminder the same day.
  // A content-addressed dedupeKey solves both goals at once: the existing
  // dedupeKey lookup in service.js (createFromEvent) already treats a
  // repeat of the same dedupeKey as "already emitted, do nothing" — so the
  // same eligible set on a later sync is still a no-op (no duplicate), but
  // a DIFFERENT set (a Case added, removed, or rescheduled) gets its own
  // dedupeKey and is correctly treated as new.
  function caseSetFingerprint(list, caseKey) {
    return list.map(caseKey).filter(Boolean).sort().join(',');
  }

  async function runTomorrowReminder(jobs) {
    const { todayIsoLocal, addDaysIso, formatTimeLabel, caseKey } = Utils();
    const today = todayIsoLocal();
    const tomorrow = addDaysIso(today, 1);
    const list = jobsOnIso(jobs, tomorrow)
      .slice()
      .sort((a, b) => String(a.timeStart || '').localeCompare(String(b.timeStart || '')));
    if (!list.length) return null;

    const fingerprint = caseSetFingerprint(list, caseKey);
    const lines = list.map(job => `${formatTimeLabel(job)}  ${job.name || caseKey(job)}`);

    return global.OperatorNotificationDispatcher.emit(Events().TOMORROW_REMINDER, {
      dedupeKey: `tomorrow:${tomorrow}:${fingerprint}`,
      lines,
      payload: { date: tomorrow, caseIds: list.map(caseKey) }
    });
  }

  async function runTodayJobs(jobs) {
    const { todayIsoLocal, formatTimeLabel, caseKey } = Utils();
    const today = todayIsoLocal();
    const list = jobsOnIso(jobs, today)
      .slice()
      .sort((a, b) => String(a.timeStart || '').localeCompare(String(b.timeStart || '')));
    if (!list.length) return null;

    const fingerprint = caseSetFingerprint(list, caseKey);

    return global.OperatorNotificationDispatcher.emit(Events().TODAY_JOBS, {
      dedupeKey: `today:${today}:${fingerprint}`,
      count: list.length,
      firstTime: formatTimeLabel(list[0]),
      payload: { date: today, caseIds: list.map(caseKey) }
    });
  }

  async function runOverdue(jobs) {
    const { parseJobStartMs, caseKey, relativeHoursOverdue } = Utils();
    const now = Date.now();
    const results = [];
    // Operator-facing overdue is for the working window, not multi-month
    // archive Cases (UJ-08: 4460h). Older appointments stay on the calendar
    // but must not flood the bell.
    const MAX_OVERDUE_HOURS = 72;

    for (const job of activeJobs(jobs)) {
      if (job.csvSource) continue;
      const status = String(job.status || '').toLowerCase();
      const workflow = String(job.workflow?.status || '').toLowerCase();
      // Overdue = appointment time passed AND work not started.
      if (status === 'in_progress' || workflow === 'in_progress') continue;
      if (['completed', 'result_sent', 'feedback_submitted', 'done'].includes(workflow)) continue;

      const startMs = parseJobStartMs(job);
      if (!Number.isFinite(startMs) || startMs >= now) continue;

      const hours = relativeHoursOverdue(startMs, now);
      if (!Number.isFinite(hours) || hours > MAX_OVERDUE_HOURS) continue;

      const id = caseKey(job);
      if (!id) continue;
      const day = Utils().isoDateOnly(job.date) || 'unknown';

      results.push(await global.OperatorNotificationDispatcher.emit(Events().OVERDUE, {
        caseId: id,
        customerName: job.name || '',
        hoursOverdue: hours,
        dedupeKey: `overdue:${id}:${day}`,
        payload: { hours, date: day }
      }));
    }
    return results;
  }

  async function runAll(jobs) {
    await runTodayJobs(jobs);
    await runTomorrowReminder(jobs);
    await runOverdue(jobs);
  }

  global.OperatorNotificationScheduler = {
    runAll,
    runTodayJobs,
    runTomorrowReminder,
    runOverdue
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
