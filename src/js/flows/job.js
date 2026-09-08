function openJob(id) {
  if (S.activeJob && String(S.activeJob.id) !== String(id)) saveActiveJobState();
  JOBS.forEach(job => {
    if (String(job.id) !== String(id) && job.status === 'in_progress') job.status = 'new';
  });
  S.activeJob = JOBS.find(j => String(j.id) === String(id));
  if (!S.activeJob) return;
  if (S.activeJob.status !== 'done') S.activeJob.status = 'in_progress';
  persistJobs();
  if (typeof persistActiveCaseRef === 'function') persistActiveCaseRef(S.activeJob);
  loadJobState(S.activeJob);
  updateJobHeader(S.activeJob);
  if (typeof updateJobEditability === 'function') updateJobEditability(S.activeJob);
  renderJobSteps();
  updateAssessScreen();
  renderCalendar();
  goScreen('s-job');
  if (typeof maybeAutoPromptLineConnect === 'function') maybeAutoPromptLineConnect(S.activeJob);
  pushCaseOpenToNotion(S.activeJob).then(result => {
    if (!result?.ok) return;
    if (result.deferred) return;
    if (typeof persistActiveCaseRef === 'function') persistActiveCaseRef(S.activeJob);
    if (typeof OperatorNotificationBridge?.emitCaseAssigned === 'function') {
      OperatorNotificationBridge.emitCaseAssigned(S.activeJob);
    }
    if (S.activeJob && String(S.activeJob.id) === String(id)) {
      updateJobHeader(S.activeJob);
      renderCalendar();
    }
  });
}

/** Job header "Call" button -- real tel: link using the customer's own phone number. */
function callActiveJobClient() {
  const job = S.activeJob;
  const phone = String(getJobDraft(job)?.fields?.['ci-phone'] || '').trim();
  if (!phone) {
    showToast(S.lang === 'th' ? 'ไม่พบเบอร์โทรลูกค้า' : 'No phone number on file');
    return;
  }
  window.location.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
}

let _chattingActiveJob = false;

/**
 * Job header "Chat" button -- there is no way to deep-link into a live 1:1
 * LINE chat with a specific customer (only their opaque lineUserId is ever
 * stored, never a public LINE ID), so this does the closest real thing
 * instead of a fake/no-op button: if already connected, resend the latest
 * result via LINE (sendResultToLineNow, existing); if not connected yet,
 * open the same connect-QR popup the auto-prompt uses (GET
 * /api/cases/:id/line-connect) -- deliberately NOT sendResultToLineNow's own
 * unlinked fallback, since that requires eligible score data first and
 * would otherwise dead-end with an "incomplete" toast on early jobs where
 * connecting is exactly what staff want to do before data is ready
 * (2026-09-08).
 */
async function chatActiveJobClient() {
  if (_chattingActiveJob) return;
  const job = S.activeJob;
  if (!job) return;

  if (job.line?.linked) {
    if (typeof sendResultToLineNow === 'function') sendResultToLineNow();
    return;
  }

  const caseRef = job.notionId || job.id;
  if (!caseRef) return;
  _chattingActiveJob = true;
  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseRef)}/line-connect`, {
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      showToast(S.lang === 'th' ? 'เปิดหน้าเชื่อม LINE ไม่สำเร็จ' : 'Could not open LINE connect');
      return;
    }
    if (data.linked) {
      if (typeof sendResultToLineNow === 'function') sendResultToLineNow();
      return;
    }
    if (!data.connectUrl) {
      showToast(S.lang === 'th' ? 'ยังไม่มีลิงก์เชื่อม LINE สำหรับเคสนี้' : 'No LINE connect link for this case yet');
      return;
    }
    if (typeof openLineConnectPromptModal === 'function') {
      openLineConnectPromptModal({ url: data.connectUrl, qr: data.connectQr || '' });
    }
  } catch (error) {
    console.warn('chatActiveJobClient failed', error);
    showToast(S.lang === 'th' ? 'เปิดหน้าเชื่อม LINE ไม่สำเร็จ' : 'Could not open LINE connect');
  } finally {
    _chattingActiveJob = false;
  }
}

function showJobHeaderMenu() {
  const job = S.activeJob;
  if (!job) return;
  document.getElementById('action-sheet-title').textContent = job.name;
  const actions = [
    { label: t('dash.menu.cancel'), fn: () => { closeActionSheet(); cancelCase(job.id); } }
  ];
  document.getElementById('action-sheet-actions').innerHTML = actions.map(a=>`<button class="modal-action" type="button">${a.label}</button>`).join('');
  document.getElementById('action-sheet-actions').querySelectorAll('.modal-action').forEach((btn,i)=>btn.onclick=actions[i].fn);
  document.getElementById('action-sheet-overlay').classList.remove('hidden');
}

const STEP_SVGS = STEP_ICONS;

function renderJobSteps() {
  const container = document.getElementById('job-steps');
  if(!container) return;
  const steps = [
    { id: 'preassess', title: t('job.step.preassess.title'), sub: t('job.step.preassess.sub'), screen: 's-preassess' },
    { id: 'assess', title: t('job.step.assess.title'), sub: t('job.step.assess.sub'), screen: 's-assess' },
    { id: 'score', title: t('job.step.score.title'), sub: t('job.step.score.sub'), screen: 's-score' },
    { id: 'feedback', title: t('job.step.feedback.title'), sub: t('job.step.feedback.sub'), screen: 's-feedback' },
  ];
  if (S.pkg === 'full') {
    steps.splice(3, 0, { id: 'payment', title: t('job.step.payment.title'), sub: t('job.step.payment.sub'), screen: 's-payment' });
  }
  container.innerHTML = steps.map(s => `
    <div class="step-card ${S.stepsDone[s.id]?'done':''}" onclick="${s.id === 'feedback' ? 'openFeedbackModal()' : `goScreen('${s.screen}')`}">
      <div class="step-icon-circle"><img src="${STEP_ICONS[s.id]}" alt=""></div>
      <div class="step-card-body">
        <div class="step-card-title">${s.title}</div>
        <div class="step-card-sub">${s.sub}</div>
      </div>
      <div class="step-done-check"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg></div>
      <span class="step-chevron">${CARET_RIGHT}</span>
    </div>`).join('');
}

/* ── Pre-assessment ──────────────────────────── */
function updatePreassessBtn() {
  if (typeof validatePreassessment === 'function') {
    validatePreassessment({ showErrors: true });
  }
}
function completePreassess() {
  if (typeof validatePreassessment === 'function') {
    const result = validatePreassessment({ showErrors: true });
    if (!result.valid) {
      const first = result.errors[0] || t('preassess.err.fixThese');
      showToast(first);
      const firstInvalid = result.invalidIds?.values().next().value;
      const target = firstInvalid && document.getElementById(firstInvalid);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }
  saveActiveJobState();
  S.stepsDone.preassess = true;

  const showPublicSuccess = () => {
    document.querySelector('#s-preassess .content-consent')?.classList.add('hidden');
    document.getElementById('preassess-blocker')?.classList.add('hidden');
    document.querySelector('#s-preassess .foot')?.classList.add('hidden');
    const title = document.querySelector('#s-preassess .hdr-title');
    if (title) title.textContent = S.lang === 'th' ? 'ส่งข้อมูลเรียบร้อย' : 'Submitted';
    const screen = document.getElementById('s-preassess');
    if (screen && !document.getElementById('preassess-success-card')) {
      const done = document.createElement('div');
      done.id = 'preassess-success-card';
      done.className = 'content';
      done.innerHTML = `
        <div class="card gap12" style="margin-top:16px">
          <h2 style="margin:0">${S.lang === 'th' ? 'ขอบคุณสำหรับข้อมูล' : 'Thank you'}</h2>
          <p style="margin:0;color:var(--muted)">${S.lang === 'th' ? 'ทีม Water Motion ได้รับข้อมูล pre-assessment แล้ว' : 'Water Motion has received your pre-assessment details.'}</p>
        </div>
      `;
      screen.appendChild(done);
    }
    showToast(S.lang === 'th' ? 'ส่งข้อมูลเรียบร้อย' : 'Submitted');
  };

  if (S.publicPreassessment) {
    const draft = getJobDraft(S.activeJob);
    const payload = {
      fields: { ...(draft?.fields || {}) },
      msConcerns: draft?.msConcerns || [],
      owner: draft?.owner || 'yes',
      package: draft?.pkg || S.pkg
    };
    const caseRef = S.activeJob?.notionId || S.activeJob?.id;
    const endpoint = caseRef
      ? `/api/cases/${encodeURIComponent(caseRef)}/preassessment`
      : '/api/cases';

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload)
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        showToast(data.error || (S.lang === 'th' ? 'ส่งข้อมูลไม่สำเร็จ' : 'Could not submit'));
        return;
      }
      if (data.case) {
        Object.assign(S.activeJob, data.case);
        persistJobs();
      }
      showPublicSuccess();
    }).catch(() => {
      showToast(S.lang === 'th' ? 'ส่งข้อมูลไม่สำเร็จ' : 'Could not submit');
    });
    return;
  }

  renderJobSteps();
  goScreen('s-dash');
  if (typeof ensureCaseSyncedToNotion === 'function') {
    ensureCaseSyncedToNotion(S.activeJob).then((synced) => {
      if (synced?.ok && typeof syncJobProfileToNotion === 'function') {
        return syncJobProfileToNotion(S.activeJob);
      }
      return synced;
    }).then(() => {
      if (S.activeJob) updateJobHeader(S.activeJob);
    }).catch(() => {});
  } else if (S.activeJob?.notionId && typeof syncJobProfileToNotion === 'function') {
    syncJobProfileToNotion(S.activeJob).then(() => {
      if (S.activeJob) updateJobHeader(S.activeJob);
    }).catch(() => {});
  }
}
// Payment screen: both package cards stay visible side by side, with the
// unselected one shown muted (2026-09-04 spec) -- the customer can still
// see what the other tier offers even after picking one. The Preassessment
// screen's own pkg-row must stay as two side-by-side cards that only
// swap which one is highlighted -- selPkg()'s own .sel toggle already
// handles that, so this function must not touch #pkg-ess/.pkg-row at all.
function updatePackageVisibility() {
  document.getElementById('pay-toggle-ess')?.classList.remove('hidden');
  document.querySelectorAll('.pay-pkg-row').forEach(row => row.classList.remove('pkg-row-single'));
  document.getElementById('pay-toggle-full')?.classList.toggle('sel', S.pkg === 'full');
  document.getElementById('pay-toggle-ess')?.classList.toggle('sel', S.pkg === 'essential');
}

function selPkg(p) {
  S.pkg = p;
  if (S.activeJob) S.activeJob.pkg = p;
  document.getElementById('pkg-ess')?.classList.toggle('sel', p === 'essential');
  document.getElementById('pkg-full')?.classList.toggle('sel', p === 'full');
  syncPkgSheetSelection();
  updatePackageVisibility();
  if (document.getElementById('s-payment') || S.screen === 's-payment') updatePaymentScreen();
  updateAssessScreen();
  if (S.activeJob && typeof updateJobHeader === 'function') updateJobHeader(S.activeJob);
}
function updatePayToggle() {
  const ess = document.getElementById('pay-toggle-ess');
  const full = document.getElementById('pay-toggle-full');
  if(ess) ess.classList.toggle('sel', S.pkg==='essential');
  if(full) full.classList.toggle('sel', S.pkg==='full');
  updatePackageVisibility();
}
function showPkgSheet({ readOnly = false } = {}) {
  document.getElementById('pkg-overlay').classList.remove('hidden');
  document.getElementById('pkg-sheet').classList.remove('hidden');
  document.getElementById('pkg-sheet')?.classList.toggle('pkg-sheet-readonly', readOnly);
  syncPkgSheetSelection();
}
function hidePkgSheet()  { document.getElementById('pkg-overlay').classList.add('hidden'); document.getElementById('pkg-sheet').classList.add('hidden'); }
function syncPkgSheetSelection() {
  document.getElementById('pkg-detail-ess')?.classList.toggle('sel', S.pkg==='essential');
  document.getElementById('pkg-detail-full')?.classList.toggle('sel', S.pkg==='full');
}
function selPkgFromSheet(p) { selPkg(p); syncPkgSheetSelection(); hidePkgSheet(); }
