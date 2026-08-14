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
 * Referenced functions (resolveScoreReadingsPresent, S) are defined in
 * flows/score.js / state.js, loaded after this file — safe because these
 * are only called at runtime, never at script-load time.
 */

const ELIGIBILITY_TASK_KEYS = Object.freeze(['tapphoto', 'meter', 'visual', 'chlorine', 'pressure', 'infra']);

/**
 * A task counts as complete for eligibility purposes only if every tap on
 * the job has it marked done — same rule flows/assessment.js already uses
 * in validateAssessmentForComplete(), reused here rather than re-derived.
 */
function buildReportTaskCompletion(job) {
  const taps = (typeof resolveJobTapDataForScore === 'function')
    ? (resolveJobTapDataForScore(job) || [])
    : ((job?.draft?.tapData?.length ? job.draft.tapData : (typeof S !== 'undefined' ? S.tapData : [])) || []);
  const tasks = {};
  ELIGIBILITY_TASK_KEYS.forEach(key => {
    tasks[key] = taps.length > 0 && taps.every(tap => Boolean(tap?.tasks?.[key]));
  });
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
