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

  async function runTomorrowReminder(jobs) {
    const { todayIsoLocal, addDaysIso, formatTimeLabel, caseKey } = Utils();
    const markers = Repo().loadScheduleMarkers();
    const today = todayIsoLocal();
    const markerKey = `tomorrow:${today}`;
    if (markers[markerKey]) return null;

    const tomorrow = addDaysIso(today, 1);
    const list = jobsOnIso(jobs, tomorrow)
      .slice()
      .sort((a, b) => String(a.timeStart || '').localeCompare(String(b.timeStart || '')));
    if (!list.length) {
      markers[markerKey] = { skipped: true, at: Date.now() };
      Repo().saveScheduleMarkers(markers);
      return null;
    }

    const lines = list.map(job => `${formatTimeLabel(job)}  ${job.name || caseKey(job)}`);
    markers[markerKey] = { emitted: true, at: Date.now(), count: list.length };
    Repo().saveScheduleMarkers(markers);

    return global.OperatorNotificationDispatcher.emit(Events().TOMORROW_REMINDER, {
      dedupeKey: markerKey,
      lines,
      payload: { date: tomorrow, caseIds: list.map(caseKey) }
    });
  }

  async function runTodayJobs(jobs) {
    const { todayIsoLocal, formatTimeLabel, caseKey } = Utils();
    const markers = Repo().loadScheduleMarkers();
    const today = todayIsoLocal();
    const markerKey = `today:${today}`;
    if (markers[markerKey]) return null;

    const list = jobsOnIso(jobs, today)
      .slice()
      .sort((a, b) => String(a.timeStart || '').localeCompare(String(b.timeStart || '')));
    if (!list.length) {
      markers[markerKey] = { skipped: true, at: Date.now() };
      Repo().saveScheduleMarkers(markers);
      return null;
    }

    markers[markerKey] = { emitted: true, at: Date.now(), count: list.length };
    Repo().saveScheduleMarkers(markers);

    return global.OperatorNotificationDispatcher.emit(Events().TODAY_JOBS, {
      dedupeKey: markerKey,
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
