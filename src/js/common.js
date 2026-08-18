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
  const alreadyPublished = Number.isFinite(Number(job?.result?.waterScore));
  const eligibility = alreadyPublished
    ? (typeof EligibilityContract !== 'undefined' ? EligibilityContract.buildLegacy() : null)
    : (typeof resolveReportEligibility === 'function' ? resolveReportEligibility(job) : null);
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
