async function saveDraft() {
  if (S.activeJob) {
    if (typeof commitManualCaseIfNeeded === 'function') commitManualCaseIfNeeded();
    saveActiveJobState();
    persistJobs();
    // Create Notion row only after Save Draft (manual cases stay local until then).
    if (typeof ensureCaseSyncedToNotion === 'function') {
      const synced = await ensureCaseSyncedToNotion(S.activeJob);
      if (!synced?.ok && S.activeJob?.manual && !S.activeJob?.notionId) {
        showToast(S.lang === 'th' ? 'บันทึกร่างแล้ว แต่ยังซิงค์ Notion ไม่สำเร็จ' : 'Draft saved, but Notion sync failed');
      }
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

async function publishScoreBeforeClose(job) {
  const score = Number(S.scoreVal ?? job?.result?.waterScore ?? job?.draft?.scoreVal);
  if (!Number.isFinite(score)) return null;
  const caseRef = job?.notionId || job?.id;
  if (!caseRef || !(job.notionId || job.notionSource)) return score;
  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseRef)}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        score,
        resultSummary: `Water score ${Math.round(score)}/100`
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.ok !== false) {
      job.result = {
        ...(job.result || {}),
        waterScore: score,
        reportUrl: payload.reportUrl || job.result?.reportUrl || '',
        publicReportToken: payload.reportToken || job.result?.publicReportToken || ''
      };
    }
  } catch (error) {
    console.warn('publishScoreBeforeClose failed', error);
  }
  return score;
}

/**
 * Finish the job when every required step is done:
 * publish score → close case (sends result to customer via LINE) → dashboard.
 */
async function completeJob() {
  if (S.activeJob) {
    if (typeof commitManualCaseIfNeeded === 'function') commitManualCaseIfNeeded();
    saveActiveJobState();
    if (typeof ensureCaseSyncedToNotion === 'function') {
      await ensureCaseSyncedToNotion(S.activeJob);
    }
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

  const completeBtn = document.querySelector('#s-job .foot .btn-primary');
  if (completeBtn) {
    completeBtn.disabled = true;
    completeBtn.dataset.prevLabel = completeBtn.textContent;
    completeBtn.textContent = S.lang === 'th' ? 'กำลังส่งผล…' : 'Sending…';
  }

  try {
    const score = await publishScoreBeforeClose(job);
    const caseRef = job.notionId || job.id;

    if (caseRef && (job.notionId || job.notionSource)) {
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
        showToast(payload.error || (S.lang === 'th' ? 'ปิดเคสไม่สำเร็จ' : 'Could not close case'));
        return;
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
    } else {
      job.status = 'done';
      showToast(S.lang === 'th' ? 'ปิดเคสแล้ว' : 'Job complete');
    }

    persistJobs();
    S.activeJob = null;
    if (typeof renderCalendar === 'function') renderCalendar();
    goScreen('s-dash');
  } catch (error) {
    console.warn('completeJob failed', error);
    showToast(S.lang === 'th' ? 'ปิดเคสไม่สำเร็จ' : 'Could not close case');
  } finally {
    if (completeBtn) {
      completeBtn.disabled = false;
      completeBtn.textContent = completeBtn.dataset.prevLabel || (S.lang === 'th' ? 'เสร็จสิ้น' : 'Complete');
      delete completeBtn.dataset.prevLabel;
    }
  }
}

function showToast(msg) {
  let t = document.getElementById('toast');
  if(!t){ t=document.createElement('div'); t.id='toast'; Object.assign(t.style,{position:'fixed',bottom:'88px',left:'50%',transform:'translateX(-50%)',background:'rgba(15,23,42,.9)',color:'#fff',padding:'10px 18px',borderRadius:'20px',fontSize:'14px',fontWeight:'500',zIndex:'99',transition:'opacity .3s',whiteSpace:'nowrap',pointerEvents:'none'}); document.body.appendChild(t); }
  t.textContent=msg; t.style.opacity='1'; clearTimeout(t._timer); t._timer=setTimeout(()=>t.style.opacity='0',2200);
}
