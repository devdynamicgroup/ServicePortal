/**
 * Report Eligibility orchestration — the single call site that combines
 * existing readings-resolution (flows/score.js) and existing per-tap task
 * data (flows/assessment.js) into one EligibilityEngine.evaluate() call.
 *
 * This file does NOT resolve readings itself and does NOT track task
 * completion itself — it only reads what those existing modules already
 * produce, so there is exactly one place that decides "can this report
 * produce a score?" instead of several places re-deriving the same answer.
 *
 * Referenced functions (resolveScoreReadingsPresent, S, tapHasAnyEngagement)
 * are defined in flows/score.js / state.js / flows/assessment.js, loaded
 * after this file — safe because these are only called at runtime, never at
 * script-load time.
 */

const ELIGIBILITY_TASK_KEYS = Object.freeze(['tapphoto', 'meter', 'visual', 'chlorine', 'pressure', 'infra']);

/**
 * A task counts as complete for eligibility purposes only if every ENGAGED
 * tap on the job has it marked done — untouched DEFAULT_TAPS placeholders
 * (rooms the surveyor never opened) must never count as missing inspection.
 * Same engaged-tap population flows/assessment.js's tapHasAnyEngagement()
 * already defines for validateAssessmentForComplete(); reused here instead
 * of re-derived (2026-09-01 root-cause fix -- this function previously used
 * taps.every() over the FULL tap set including untouched defaults,
 * contradicting the engaged-only rule this same comment already claimed to
 * follow, so canPublishReport was false for virtually any Case that didn't
 * engage all 5 default rooms). Falls back to the full tap set only when
 * nothing has been engaged yet, so a brand-new assessment still correctly
 * reports as incomplete rather than vacuously complete -- same fallback
 * validateAssessmentForComplete() uses.
 */
function buildReportTaskCompletion(job) {
  const taps = (typeof resolveJobTapDataForScore === 'function')
    ? (resolveJobTapDataForScore(job) || [])
    : ((job?.draft?.tapData?.length ? job.draft.tapData : (typeof S !== 'undefined' ? S.tapData : [])) || []);
  const engagedTaps = (typeof tapHasAnyEngagement === 'function')
    ? taps.filter(tap => tapHasAnyEngagement(tap))
    : taps;
  const tapsForCompletion = engagedTaps.length ? engagedTaps : taps;
  const tasks = {};
  ELIGIBILITY_TASK_KEYS.forEach(key => {
    tasks[key] = tapsForCompletion.length > 0 && tapsForCompletion.every(tap => Boolean(tap?.tasks?.[key]));
  });
  // Read-only forensic — does not alter tasks / every() result. Passed the
  // full (unfiltered) tap set, same as before, so the tracer still shows
  // every row including untouched ones.
  if (typeof CompleteTrace !== 'undefined') {
    CompleteTrace.recordTapCompletion(job, taps, tasks);
  }
  return tasks;
}

/**
 * Resolve the Eligibility Contract for a job. This is the ONLY function
 * downstream code (UI, publish, public report) should call. Consumers must
 * read canCalculateScore for Score visibility and canPublishReport for
 * Complete/Publish — never re-derive either decision locally.
 */
function resolveReportEligibility(job, reportType = 'production') {
  const activeJob = job || (typeof S !== 'undefined' ? S.activeJob : null);
  const readings = typeof resolveScoreReadingsPresent === 'function'
    ? resolveScoreReadingsPresent(activeJob)
    : {};
  const tasks = buildReportTaskCompletion(activeJob);
  return window.EligibilityEngine.evaluate({ reportType, readings, tasks });
}

if (typeof window !== 'undefined') {
  window.resolveReportEligibility = resolveReportEligibility;
  window.buildReportTaskCompletion = buildReportTaskCompletion;
}
