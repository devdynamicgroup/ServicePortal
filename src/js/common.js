/**
 * Re-entrancy guard + visible "Saving…" state (2026-08-18 fix): the awaited
 * Notion syncs below can take a moment, and with no feedback the button
 * looked unresponsive — inviting a second tap that fired a fully separate
 * concurrent save (duplicate Notion writes / a race between the two calls'
 * writes to the same job). Navigation to the dashboard already only happens
 * after both syncs resolve; this only makes that wait visible and single-flight.
 */
async function saveDraft() {
  if (S._savingDraft) return;
  S._savingDraft = true;
  const draftBtns = document.querySelectorAll('.btn-draft');
  draftBtns.forEach(btn => { btn.disabled = true; });
  try {
    if (S.activeJob) {
      if (typeof commitManualCaseIfNeeded === 'function') commitManualCaseIfNeeded();
      saveActiveJobState();
      persistJobs();
      // Create Notion row on Save Draft if create-time sync had not succeeded yet.
      if (typeof ensureCaseSyncedToNotion === 'function') {
        const synced = await ensureCaseSyncedToNotion(S.activeJob);
        if (!synced?.ok && S.activeJob?.manual && !S.activeJob?.notionId) {
          showToast(S.lang === 'th' ? 'บันทึกร่างแล้ว แต่ยังซิงค์ Notion ไม่สำเร็จ' : 'Draft saved, but Notion sync failed');
        }
      }
      if (typeof syncJobAssessmentToNotion === 'function' && S.activeJob?.notionId) {
        await syncJobAssessmentToNotion(S.activeJob);
      }
      if (typeof renderCalendar === 'function') renderCalendar();
      else if (typeof renderJobs === 'function') renderJobs();
    }
    showToast('Draft saved');
    const profileJob = S.activeJob;
    goScreen('s-dash');
    if (profileJob?.notionId && typeof syncJobProfileToNotion === 'function') {
      syncJobProfileToNotion(profileJob).catch(() => {});
    }
  } finally {
    S._savingDraft = false;
    draftBtns.forEach(btn => { btn.disabled = false; });
  }
}

function requiredJobSteps(pkg = S.pkg) {
  return pkg === 'full'
    ? ['preassess', 'assess', 'score', 'payment', 'feedback']
    : ['preassess', 'assess', 'score', 'feedback'];
}

function missingJobSteps(pkg = S.pkg, stepsDone = S.stepsDone) {
  return requiredJobSteps(pkg).filter(key => !stepsDone?.[key]);
}

function allJobStepsDone(pkg = S.pkg, stepsDone = S.stepsDone) {
  return missingJobSteps(pkg, stepsDone).length === 0;
}

function publishIdempotencyStorageKey(caseRef, intent) {
  return `wm-pub-idem:${String(caseRef || '')}:${String(intent || 'publish')}`;
}

function getOrCreatePublishIdempotencyKey(caseRef, intent = 'publish') {
  const storageKey = publishIdempotencyStorageKey(caseRef, intent);
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const minted = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `idemp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(storageKey, minted);
    return minted;
  } catch {
    return `idemp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function clearPublishIdempotencyKey(caseRef, intent = 'publish') {
  try {
    sessionStorage.removeItem(publishIdempotencyStorageKey(caseRef, intent));
  } catch {
    /* ignore */
  }
}

/**
 * Persist Water Score before close. Hard-fails — callers must not close / LINE on error.
 * Report token may be created here; closeCase() still guarantees token before LINE.
 */
async function publishScoreBeforeClose(job) {
  // Single source of truth: an already-published job may always be re-saved
  // (backward compatibility — existing published scores must not change or
  // become newly blocked). Anything not yet published must pass Eligibility.
  // The bypass still produces a (legacy-tagged) contract rather than silently
  // skipping one, so every publish is traceable to the architecture that
  // produced it — see calculationMetadata.eligibilityVersion below.
  // Ensure forensic session exists for non-Assessment entry (e.g. completeJob).
  if (typeof CompleteTrace !== 'undefined' && !window.__WM_COMPLETE_TRACE_SESSION__) {
    CompleteTrace.beginComplete(job);
  }
  const alreadyPublished = Number.isFinite(Number(job?.result?.waterScore));
  const eligibility = alreadyPublished
    ? (typeof EligibilityContract !== 'undefined' ? EligibilityContract.buildLegacy() : null)
    : (typeof resolveReportEligibility === 'function' ? resolveReportEligibility(job) : null);
  // Read-only Complete dual-gate forensic (opt-in).
  if (typeof CompleteTrace !== 'undefined') {
    CompleteTrace.recordGate2(job, eligibility);
  }
  // Official close/publish requires canPublishReport (measurements + inspection).
  // Score display uses canCalculateScore separately — do not collapse them here.
  if (eligibility && !eligibility.canPublishReport) {
    const error = new Error(
      S.lang === 'th'
        ? `ยังไม่พร้อมปิดเคส: ${eligibility.reason || 'ข้อมูลไม่ครบ'}`
        : `Not eligible to publish yet: ${eligibility.reason || 'incomplete report'}`
    );
    error.code = 'NOT_ELIGIBLE';
    error.eligibility = eligibility;
    throw error;
  }
  const score = Number(S.scoreVal ?? job?.result?.waterScore ?? job?.draft?.scoreVal);
  if (!Number.isFinite(score)) {
    // Retained as a defensive fallback only — Eligibility above is the real
    // gate now. This still catches a score that is somehow non-finite even
    // though Eligibility passed (e.g. a bug elsewhere), so publish never
    // silently sends a bad score.
    const error = new Error(S.lang === 'th' ? 'ยังไม่มีคะแนนน้ำ' : 'Water Score is missing');
    error.code = 'SCORE_MISSING';
    throw error;
  }
  const caseRef = job?.notionId || job?.id;
  if (!caseRef || !(job.notionId || job.notionSource)) {
    const error = new Error(S.lang === 'th' ? 'ยังไม่มีเคสในระบบ' : 'Case is not synced yet');
    error.code = 'NO_CASE';
    throw error;
  }
  const intent = 'publish';
  const idempotencyKey = getOrCreatePublishIdempotencyKey(caseRef, intent);
  const response = await fetch(`/api/cases/${encodeURIComponent(caseRef)}/score`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    credentials: 'same-origin',
    body: JSON.stringify({
      score,
      resultSummary: `Water score ${Math.round(score)}/100`,
      eligibilityVersion: eligibility?.calculationMetadata?.eligibilityVersion || 'unknown',
      complianceStatus: S.currentScoreResult?.complianceStatus || null,
      intent,
      idempotencyKey,
      modelVersion: (typeof QUALITY_SCORE_ENGINE_VERSION !== 'undefined' && !alreadyPublished)
        ? QUALITY_SCORE_ENGINE_VERSION
        : undefined
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    if (typeof isSessionExpiredResponse === 'function' && isSessionExpiredResponse(response, payload)) {
      if (typeof handleSessionExpired === 'function') handleSessionExpired();
      const error = new Error(payload.error || 'Session expired');
      error.code = 'SCORE_SAVE_FAILED';
      error.sessionExpired = true;
      throw error;
    }
    const error = new Error(payload.error || (S.lang === 'th' ? 'บันทึกคะแนนไม่สำเร็จ' : 'Could not save score'));
    error.code = 'SCORE_SAVE_FAILED';
    throw error;
  }
  clearPublishIdempotencyKey(caseRef, intent);
  job.result = {
    ...(job.result || {}),
    waterScore: payload.score != null ? payload.score : score,
    reportUrl: payload.reportUrl || job.result?.reportUrl || '',
    publicReportToken: payload.reportToken || job.result?.publicReportToken || '',
    eligibilityVersion: eligibility?.calculationMetadata?.eligibilityVersion || job.result?.eligibilityVersion || 'unknown'
  };
  return Number.isFinite(Number(payload.score)) ? Number(payload.score) : score;
}

/**
 * Shared production completion orchestration (no workflow / assessment validation).
 * publishScoreBeforeClose → POST /close → closeCase (report + LINE) → dashboard.
 * Score publish failure aborts before close (no LINE).
 */
async function finalizeCaseCompletion(job, options = {}) {
  if (!job) {
    const error = new Error(S.lang === 'th' ? 'ไม่พบงานที่เปิดอยู่' : 'No active job');
    error.code = 'NO_JOB';
    throw error;
  }

  const completeBtn = options.completeBtn
    || (options.buttonSelector ? document.querySelector(options.buttonSelector) : null);
  if (completeBtn) {
    completeBtn.disabled = true;
    completeBtn.dataset.prevLabel = completeBtn.textContent;
    completeBtn.textContent = options.busyLabel
      || (S.lang === 'th' ? 'กำลังส่งผล…' : 'Sending…');
  }

  try {
    const score = await publishScoreBeforeClose(job);
    const caseRef = job.notionId || job.id;

    if (!(caseRef && (job.notionId || job.notionSource))) {
      const error = new Error(S.lang === 'th' ? 'ยังไม่มีเคสในระบบ' : 'Case is not synced yet');
      error.code = 'NO_CASE';
      throw error;
    }

    const response = await fetch(`/api/cases/${encodeURIComponent(caseRef)}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        score: Number.isFinite(Number(score)) ? Number(score) : null,
        completedBy: 'Water Motion Specialist'
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      if (typeof CompleteTrace !== 'undefined') {
        CompleteTrace.recordClose({
          ok: false,
          stage: 'POST_/close',
          httpStatus: response.status,
          error: payload.error || null
        });
      }
      if (typeof isSessionExpiredResponse === 'function' && isSessionExpiredResponse(response, payload)) {
        if (typeof handleSessionExpired === 'function') handleSessionExpired();
        const error = new Error(payload.error || 'Session expired');
        error.code = 'CLOSE_FAILED';
        error.sessionExpired = true;
        throw error;
      }
      const error = new Error(payload.error || (S.lang === 'th' ? 'ปิดเคสไม่สำเร็จ' : 'Could not close case'));
      error.code = 'CLOSE_FAILED';
      throw error;
    }

    if (payload.case) {
      Object.assign(job, {
        status: 'done',
        result: { ...(job.result || {}), ...(payload.case.result || {}) },
        workflow: { ...(job.workflow || {}), ...(payload.case.workflow || {}) },
        notification: { ...(job.notification || {}), ...(payload.case.notification || {}) },
        feedback: { ...(job.feedback || {}), ...(payload.case.feedback || {}) },
        line: { ...(job.line || {}), ...(payload.case.line || {}) }
      });
    } else {
      job.status = 'done';
    }

    const lineStatus = payload.line?.status || payload.case?.notification?.status;
    if (lineStatus === 'sent' || payload.line?.ok) {
      showToast(S.lang === 'th' ? 'ส่งผลให้ลูกค้าแล้ว' : 'Results sent to customer');
    } else if (lineStatus === 'skipped' || payload.line?.reason === 'no_line_user_id') {
      showToast(S.lang === 'th' ? 'ปิดเคสแล้ว (ยังไม่ได้เชื่อม LINE)' : 'Job complete (LINE not linked)');
    } else if (lineStatus === 'failed') {
      showToast(S.lang === 'th' ? 'ปิดเคสแล้ว แต่ส่ง LINE ไม่สำเร็จ' : 'Job complete — LINE send failed');
    } else {
      showToast(S.lang === 'th' ? 'ปิดเคสแล้ว' : 'Job complete');
    }

    if (typeof OperatorNotificationBridge?.emitFromCloseResult === 'function') {
      try {
        await OperatorNotificationBridge.emitFromCloseResult(job, payload);
      } catch (error) {
        console.warn('[notifications] close bridge failed', error);
      }
    }

    if (typeof CompleteTrace !== 'undefined') {
      CompleteTrace.recordClose({
        ok: true,
        stage: 'POST_/close',
        lineStatus: payload.line?.status || payload.case?.notification?.status || null,
        lineOk: payload.line?.ok ?? null
      });
    }

    persistJobs();
    S.activeJob = null;
    if (typeof clearActiveCaseRef === 'function') clearActiveCaseRef();
    if (typeof renderCalendar === 'function') renderCalendar();
    else if (typeof renderJobs === 'function') renderJobs();
    goScreen('s-dash');
    return { ok: true, payload };
  } finally {
    if (completeBtn) {
      completeBtn.disabled = false;
      completeBtn.textContent = completeBtn.dataset.prevLabel
        || (typeof t === 'function' ? t('common.complete') : (S.lang === 'th' ? 'เสร็จสิ้น' : 'Complete'));
      delete completeBtn.dataset.prevLabel;
    }
  }
}

// In-flight guard for sendResultToLineNow(), same established pattern as
// completeJob._inFlight / sharingScore (score.js) -- a second rapid click
// while a send is already running must not fire a second publish/send.
let sendingResultToLine = false;

/**
 * Explicit "Send Result via LINE" action (2026-08-31) -- deliberately
 * separate from completeJob()/finalizeCaseCompletion(): Complete finishes
 * the on-site workflow and auto-sends once; this is the repeatable action
 * for "publish and send whatever the current valid result is, right now,"
 * usable both to (repair-)send a Case that was completed but never
 * successfully notified, and to explicitly resend after the assessment was
 * edited post-send. Does not touch scoring -- reads the same live S.scoreVal
 * Complete already reads, through the same publish endpoint Complete already
 * uses.
 *
 * Reuses existing infrastructure only:
 *  - resolveReportEligibility(job).canCalculateScore -- a DIFFERENT, already-
 *    existing signal from the one Complete uses (Complete/publishScoreBeforeClose
 *    reads canPublishReport, which additionally requires every inspection
 *    task -- tapphoto/meter/visual/chlorine/pressure/infra -- checked on
 *    every tap). canCalculateScore already exists in eligibilityEngine.js
 *    specifically as "measurements valid, inspection not required" (its own
 *    doc comment: "Score UI must NOT use [canPublishReport] for showScore --
 *    use canCalculateScore instead"), and neither the customer-facing
 *    publication snapshot (score-publication-snapshot.js) nor the LINE
 *    message itself (line-notifications.js) ever reference inspection/task/
 *    photo data -- confirmed by reading both before making this change
 *    (2026-08-31). Send Result asks "can we calculate and send the current
 *    result," not "is the whole on-site inspection workflow finished" --
 *    that second question stays Complete's alone, unchanged.
 *  - POST /api/cases/:id/score (publishCaseScore/createOrReusePublication)
 *    -- the same write-once/republish publication ledger Complete uses.
 *    intent:'publish' when the customer has never been sent a result yet
 *    (mirrors write-once reuse semantics exactly); intent:'republish' when
 *    already sent once (mints a NEW immutable publication + report token --
 *    the old token/link is never touched, by design of that existing
 *    service).
 *  - POST /api/cases/:id/send-result (sendCaseResult/executeSendCaseResult)
 *    -- the same LINE-destination-resolution/notification-lifecycle code
 *    Retry-LINE already uses. `force:true` is passed ONLY when a result was
 *    already sent, to opt into the narrow resend bypass added to that
 *    function's idempotency guard -- never for a genuinely first send.
 */
async function sendResultToLineNow() {
  if (sendingResultToLine) return;
  const job = S.activeJob;
  if (!job) {
    showToast(S.lang === 'th' ? 'ไม่พบงานที่เปิดอยู่' : 'No active job');
    return;
  }

  const btn = document.getElementById('btn-send-result-line');
  sendingResultToLine = true;
  if (btn) {
    btn.disabled = true;
    btn.dataset.prevLabel = btn.textContent;
    btn.textContent = S.lang === 'th' ? 'กำลังส่งผล…' : 'Sending…';
  }

  try {
    saveActiveJobState();

    // Deliberately NOT canPublishReport (that's Complete's stricter gate,
    // which also requires every inspection task checked). Send Result only
    // needs enough valid measurement data to calculate/send the current
    // result -- inspection-task completion is internal audit data the
    // customer-facing result never includes, so it must never appear as a
    // blocker here. Missing-field detail comes straight from the existing
    // Eligibility Contract's own output -- never inspection fields.
    const eligibility = typeof resolveReportEligibility === 'function' ? resolveReportEligibility(job) : null;
    if (eligibility && !eligibility.canCalculateScore) {
      const missing = eligibility.missingMeasurements || [];
      const detail = missing.length ? missing.join(', ') : (eligibility.reason || '');
      showToast(S.lang === 'th'
        ? `ส่งผลไม่ได้ — ข้อมูลค่าน้ำยังไม่ครบ${detail ? ': ' + detail : ''}`
        : `Cannot send yet — measurement data incomplete${detail ? ': ' + detail : ''}`);
      return;
    }

    const score = Number(S.scoreVal ?? job?.result?.waterScore ?? job?.draft?.scoreVal);
    if (!Number.isFinite(score)) {
      showToast(S.lang === 'th' ? 'ยังไม่มีคะแนนน้ำ' : 'Water Score is missing');
      return;
    }

    const caseRef = job.notionId || job.id;
    if (!caseRef || !(job.notionId || job.notionSource)) {
      showToast(S.lang === 'th' ? 'ยังไม่มีเคสในระบบ' : 'Case is not synced yet');
      return;
    }

    const alreadySent = job?.notification?.status === 'sent';
    const intent = alreadySent ? 'republish' : 'publish';
    const idempotencyKey = getOrCreatePublishIdempotencyKey(caseRef, intent);

    const publishResponse = await fetch(`/api/cases/${encodeURIComponent(caseRef)}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      credentials: 'same-origin',
      body: JSON.stringify({
        score,
        resultSummary: `Water score ${Math.round(score)}/100`,
        complianceStatus: S.currentScoreResult?.complianceStatus || null,
        intent,
        idempotencyKey
      })
    });
    const publishPayload = await publishResponse.json().catch(() => ({}));
    if (!publishResponse.ok || publishPayload.ok === false) {
      if (typeof isSessionExpiredResponse === 'function' && isSessionExpiredResponse(publishResponse, publishPayload)) {
        if (typeof handleSessionExpired === 'function') handleSessionExpired();
        return;
      }
      showToast(publishPayload.error || (S.lang === 'th' ? 'บันทึกคะแนนไม่สำเร็จ' : 'Could not save score'));
      return;
    }
    clearPublishIdempotencyKey(caseRef, intent);
    job.result = {
      ...(job.result || {}),
      waterScore: publishPayload.score != null ? publishPayload.score : score,
      reportUrl: publishPayload.reportUrl || job.result?.reportUrl || '',
      publicReportToken: publishPayload.reportToken || job.result?.publicReportToken || ''
    };

    const sendResponse = await fetch(`/api/cases/${encodeURIComponent(caseRef)}/send-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(alreadySent ? { force: true } : {})
    });
    const sendPayload = await sendResponse.json().catch(() => ({}));
    if (!sendResponse.ok || sendPayload.ok === false) {
      if (typeof isSessionExpiredResponse === 'function' && isSessionExpiredResponse(sendResponse, sendPayload)) {
        if (typeof handleSessionExpired === 'function') handleSessionExpired();
        return;
      }
      showToast(sendPayload.error || (S.lang === 'th' ? 'ส่งผล LINE ไม่สำเร็จ' : 'Could not send result via LINE'));
      return;
    }

    if (sendPayload.case) {
      Object.assign(job, {
        result: { ...(job.result || {}), ...(sendPayload.case.result || {}) },
        workflow: { ...(job.workflow || {}), ...(sendPayload.case.workflow || {}) },
        notification: { ...(job.notification || {}), ...(sendPayload.case.notification || {}) },
        line: { ...(job.line || {}), ...(sendPayload.case.line || {}) }
      });
    }
    persistJobs();

    const lineOk = Boolean(sendPayload.line?.ok) || sendPayload.line?.status === 'sent';
    if (lineOk) {
      showToast(alreadySent
        ? (S.lang === 'th' ? 'ส่งผลล่าสุดให้ลูกค้าทาง LINE สำเร็จ' : 'Latest result sent to customer via LINE')
        : (S.lang === 'th' ? 'ส่งผลให้ลูกค้าทาง LINE สำเร็จ' : 'Result sent to customer via LINE'));
    } else if (sendPayload.line?.reason === 'no_line_user_id' || sendPayload.line?.status === 'skipped') {
      showToast(S.lang === 'th' ? 'ยังไม่ได้เชื่อม LINE กับลูกค้า' : 'Customer is not LINE-linked yet');
    } else {
      showToast(S.lang === 'th' ? 'ส่งผล LINE ไม่สำเร็จ' : 'Could not send result via LINE');
    }
  } catch (error) {
    console.warn('sendResultToLineNow failed', error);
    showToast(S.lang === 'th' ? 'ส่งผล LINE ไม่สำเร็จ' : 'Could not send result via LINE');
  } finally {
    sendingResultToLine = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.prevLabel || (S.lang === 'th' ? 'ส่งผล' : 'Send');
      delete btn.dataset.prevLabel;
    }
  }
}

/**
 * Current Job Complete entry point.
 * Validates workflow steps, then reuses shared production completion orchestration.
 */
async function completeJob() {
  // Ignore re-entry while sync → finalize is in flight (same pattern as completeAssessment).
  if (completeJob._inFlight) return;

  if (!S.activeJob) {
    const missing = missingJobSteps();
    if (missing.length) {
      showToast(S.lang === 'th' ? 'กรุณาทำทุกขั้นตอนให้ครบก่อน' : 'Complete all steps first');
      goScreen('s-dash');
      return;
    }
    goScreen('s-dash');
    return;
  }

  completeJob._inFlight = true;
  try {
    if (typeof commitManualCaseIfNeeded === 'function') commitManualCaseIfNeeded();
    saveActiveJobState();
    if (typeof ensureCaseSyncedToNotion === 'function') {
      await ensureCaseSyncedToNotion(S.activeJob);
    }

    const missing = missingJobSteps();
    if (missing.length) {
      showToast(S.lang === 'th' ? 'กรุณาทำทุกขั้นตอนให้ครบก่อน' : 'Complete all steps first');
      goScreen('s-dash');
      return;
    }

    const job = S.activeJob;
    if (!job) {
      goScreen('s-dash');
      return;
    }

    try {
      await finalizeCaseCompletion(job, {
        buttonSelector: '#s-job .foot .btn-primary',
        busyLabel: S.lang === 'th' ? 'กำลังส่งผล…' : 'Sending…'
      });
    } catch (error) {
      console.warn('completeJob failed', error);
      // handleSessionExpired() already redirected to login with its own
      // message -- a second generic toast on top would be confusing.
      if (error?.sessionExpired) return;
      showToast(error?.message || (S.lang === 'th' ? 'ปิดเคสไม่สำเร็จ' : 'Could not close case'));
    }
  } finally {
    completeJob._inFlight = false;
  }
}
completeJob._inFlight = false;

function showToast(msg) {
  let t = document.getElementById('toast');
  if(!t){ t=document.createElement('div'); t.id='toast'; Object.assign(t.style,{position:'fixed',bottom:'88px',left:'50%',transform:'translateX(-50%)',background:'rgba(15,23,42,.9)',color:'#fff',padding:'10px 18px',borderRadius:'20px',fontSize:'14px',fontWeight:'500',zIndex:'99',transition:'opacity .3s',whiteSpace:'nowrap',pointerEvents:'none'}); document.body.appendChild(t); }
  t.textContent=msg; t.style.opacity='1'; clearTimeout(t._timer); t._timer=setTimeout(()=>t.style.opacity='0',2200);
}
