function saveDraft() {
  if (S.activeJob) {
    if (typeof commitManualCaseIfNeeded === 'function') commitManualCaseIfNeeded();
    saveActiveJobState();
    persistJobs();
    if (typeof renderCalendar === 'function') renderCalendar();
    else if (typeof renderJobs === 'function') renderJobs();
  }
  showToast('Draft saved');
  const profileJob = S.activeJob;
  goScreen('s-dash');
  // Fire-and-forget: keep Notion Full Name aligned with the draft the specialist just saved.
  if (profileJob?.notionId && typeof syncJobProfileToNotion === 'function') {
    syncJobProfileToNotion(profileJob).catch(() => {});
  }
}

async function completeJob() {
  if (S.activeJob) {
    if (typeof commitManualCaseIfNeeded === 'function') commitManualCaseIfNeeded();
    saveActiveJobState();
  }
  const required = S.pkg === 'full'
    ? ['preassess', 'assess', 'score', 'payment', 'feedback']
    : ['preassess', 'assess', 'score', 'feedback'];
  const all = required.every(k => S.stepsDone[k]);
  if (!all) {
    showToast(S.lang === 'th' ? 'กรุณาทำทุกขั้นตอนให้ครบก่อน' : 'Complete all steps first');
    return;
  }

  const job = S.activeJob;
  const caseRef = job?.notionId || job?.id;
  if (caseRef && (job.notionId || job.notionSource)) {
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseRef)}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: Number.isFinite(Number(S.scoreVal)) ? Number(S.scoreVal) : (job.result?.waterScore ?? null),
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
        showToast(S.lang === 'th' ? 'ปิดเคสแล้ว และส่งผลทาง LINE แล้ว' : 'Job complete — result sent on LINE');
      } else if (lineStatus === 'skipped' || payload.line?.reason === 'no_line_user_id') {
        showToast(S.lang === 'th' ? 'ปิดเคสแล้ว (ยังไม่ได้เชื่อม LINE)' : 'Job complete (LINE not linked)');
      } else if (lineStatus === 'failed') {
        showToast(S.lang === 'th' ? 'ปิดเคสแล้ว แต่ส่ง LINE ไม่สำเร็จ' : 'Job complete — LINE send failed');
      } else {
        showToast(S.lang === 'th' ? 'ปิดเคสแล้ว' : 'Job complete');
      }
    } catch (error) {
      console.warn('completeJob close failed', error);
      showToast(S.lang === 'th' ? 'ปิดเคสไม่สำเร็จ' : 'Could not close case');
      return;
    }
  } else if (job) {
    job.status = 'done';
    showToast(S.lang === 'th' ? 'ปิดเคสแล้ว' : 'Job complete');
  }

  if (job) {
    persistJobs();
    if (typeof renderCalendar === 'function') renderCalendar();
  }
  goScreen('s-dash');
}

function showToast(msg) {
  let t = document.getElementById('toast');
  if(!t){ t=document.createElement('div'); t.id='toast'; Object.assign(t.style,{position:'fixed',bottom:'88px',left:'50%',transform:'translateX(-50%)',background:'rgba(15,23,42,.9)',color:'#fff',padding:'10px 18px',borderRadius:'20px',fontSize:'14px',fontWeight:'500',zIndex:'99',transition:'opacity .3s',whiteSpace:'nowrap',pointerEvents:'none'}); document.body.appendChild(t); }
  t.textContent=msg; t.style.opacity='1';
  clearTimeout(t._t); t._t=setTimeout(()=>t.style.opacity='0',2500);
}
