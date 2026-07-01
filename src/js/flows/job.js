function openJob(id) {
  if (S.activeJob && S.activeJob.id !== id) saveActiveJobState();
  S.activeJob = JOBS.find(j => j.id === id);
  if (!S.activeJob) return;
  loadJobState(S.activeJob);
  updateJobHeader(S.activeJob);
  renderJobSteps();
  updateAssessScreen();
  goScreen('s-job');
}

const STEP_SVGS = STEP_ICONS;

function renderJobSteps() {
  const container = document.getElementById('job-steps');
  if(!container) return;
  const steps = [
    { id: 'preassess', title: t('job.step.preassess.title'), sub: t('job.step.preassess.sub'), screen: 's-preassess' },
    { id: 'assess', title: t('job.step.assess.title'), sub: t('job.step.assess.sub'), screen: 's-assess' },
    { id: 'score', title: t('job.step.score.title'), sub: t('job.step.score.sub'), screen: 's-score' },
    { id: 'payment', title: t('job.step.payment.title'), sub: t('job.step.payment.sub'), screen: 's-payment' },
    { id: 'feedback', title: t('job.step.feedback.title'), sub: t('job.step.feedback.sub'), screen: 's-feedback' },
  ];
  container.innerHTML = steps.map(s => `
    <div class="step-card ${S.stepsDone[s.id]?'done':''}" onclick="goScreen('${s.screen}')">
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
    validatePreassessment({ showErrors: false });
    return;
  }
  document.getElementById('btn-preassess-done').disabled = !document.getElementById('ci-consent').checked;
}
function completePreassess() {
  if (typeof validatePreassessment === 'function') {
    const result = validatePreassessment({ showErrors: true });
    if (!result.valid) {
      showToast(result.errors[0] || 'Please complete required fields');
      return;
    }
  }
  S.stepsDone.preassess = true;
  saveActiveJobState();
  renderJobSteps();
  goScreen('s-job');
}
function selPkg(p) {
  S.pkg = p;
  if (S.activeJob) S.activeJob.pkg = p;
  document.getElementById('pkg-ess')?.classList.toggle('sel', p === 'essential');
  document.getElementById('pkg-full')?.classList.toggle('sel', p === 'full');
  syncPkgSheetSelection();
  if (document.getElementById('s-payment') || S.screen === 's-payment') updatePaymentScreen();
  updateAssessScreen();
}
function updatePayToggle() {
  const ess = document.getElementById('pay-toggle-ess');
  const full = document.getElementById('pay-toggle-full');
  if(ess) ess.classList.toggle('sel', S.pkg==='essential');
  if(full) full.classList.toggle('sel', S.pkg==='full');
}
function showPkgSheet() {
  document.getElementById('pkg-overlay').classList.remove('hidden');
  document.getElementById('pkg-sheet').classList.remove('hidden');
  syncPkgSheetSelection();
}
function hidePkgSheet()  { document.getElementById('pkg-overlay').classList.add('hidden'); document.getElementById('pkg-sheet').classList.add('hidden'); }
function syncPkgSheetSelection() {
  document.getElementById('pkg-detail-ess')?.classList.toggle('sel', S.pkg==='essential');
  document.getElementById('pkg-detail-full')?.classList.toggle('sel', S.pkg==='full');
}
function selPkgFromSheet(p) { selPkg(p); syncPkgSheetSelection(); hidePkgSheet(); }
