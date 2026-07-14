async function initApp() {
  try {
    await loadPagePartials();
    runInitStep(applyStaticIcons);
    if (typeof syncFeedbackReviewUi === 'function') syncFeedbackReviewUi();
    let jobsLoaded = false;
    if (typeof loadJobsFromApi === 'function') {
      jobsLoaded = await loadJobsFromApi();
    }
    if (!jobsLoaded) {
      const csvSeedVersion = 'clients-30-v1';
      if (localStorage.getItem('wm-csv-seed-version') !== csvSeedVersion && typeof loadJobsFromCsv === 'function') {
        const loadedCsv = await loadJobsFromCsv();
        if (loadedCsv) localStorage.setItem('wm-csv-seed-version', csvSeedVersion);
      } else if (!loadJobsFromStorage() && typeof loadJobsFromCsv === 'function') {
        await loadJobsFromCsv();
      }
    }
    runInitStep(initTaps);
    runInitStep(initOwnerRadios);
    runInitStep(initChipGroups);
    runInitStep(initPreassessmentValidation);
    runInitStep(updateAssessScreen);
    runInitStep(updatePayToggle);
    runInitStep(() => setLanguage(S.lang, { silent: true }));
    if (typeof initAuthUI === 'function') await initAuthUI();
    if (typeof openPublicPreassessmentIfRequested === 'function' && openPublicPreassessmentIfRequested()) return;
    if (typeof restoreLoginSession === 'function') await restoreLoginSession();
    if (typeof initDriveUploadQueue === 'function') initDriveUploadQueue();
  } catch (error) {
    document.getElementById('app').innerHTML = '<div class="content"><div class="card">Unable to load app pages. Please run this app through a local web server.</div></div>';
    console.error(error);
  }
}

function getPreassessmentRequestId() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('preassessment') || '').trim();
}

function findPreassessmentJob(id) {
  if (!id) return null;
  return JOBS.find(job =>
    String(job.id) === String(id)
    || String(job.notionId || '') === String(id)
    || String(job.legacyNumericId || '') === String(id)
    || String(job.result?.publicReportToken || '') === String(id)
    || String(job.feedback?.token || '') === String(id)
  ) || null;
}

function configurePublicPreassessmentView() {
  document.body.classList.add('public-preassessment-mode');
  document.querySelector('#s-preassess .hdr-back')?.classList.add('hidden');
  document.querySelector('#s-preassess .hdr-action')?.classList.add('hidden');
  document.querySelector('#s-preassess .btn-draft')?.classList.add('hidden');
  const done = document.getElementById('btn-preassess-done');
  if (done) done.textContent = S.lang === 'th' ? 'ส่งข้อมูล' : 'Submit';
}

function showPublicPreassessmentError(id) {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div class="content">
      <div class="card gap12">
        <h2 style="margin:0">Pre-assessment link not found</h2>
        <p style="margin:0;color:var(--muted)">We could not find pre-assessment ID ${id || ''}. Please contact Water Motion.</p>
      </div>
    </div>
  `;
}

function openPublicPreassessmentIfRequested() {
  const id = getPreassessmentRequestId();
  if (!id) return false;

  S.publicPreassessment = true;
  const job = findPreassessmentJob(id);
  if (!job) {
    showPublicPreassessmentError(id);
    return true;
  }

  S.activeJob = job;
  loadJobState(job);
  configurePublicPreassessmentView();
  goScreen('s-preassess');
  return true;
}

function runInitStep(fn) {
  try {
    if (typeof fn === 'function') fn();
  } catch (error) {
    console.error(error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

const _origGoScreen = goScreen;
window.goScreen = function(id) {
  _origGoScreen(id);
  try {
    if (id === 's-assess') renderAssessList();
    if (typeof restoreCurrentPhotoScreen === 'function') restoreCurrentPhotoScreen(id);
    if (id === 's-meter' && window.MeterReadingCapture) MeterReadingCapture.init();
    if (id === 's-feedback' && typeof initFeedbackScreen === 'function') initFeedbackScreen();
    if (id === 's-score') {
      S.scoreStandardKey = typeof DEFAULT_SCORE_STANDARD_KEY !== 'undefined' ? DEFAULT_SCORE_STANDARD_KEY : 'thailand';
      calcAndShowScore();
    }
    if (id === 's-payment') updatePaymentScreen();
    if (id === 's-preassess') {
      if (typeof updateProvinceOptions === 'function') updateProvinceOptions();
      if (typeof updatePreassessmentOptionText === 'function') updatePreassessmentOptionText();
      if (typeof updatePackageVisibility === 'function') updatePackageVisibility();
      if (typeof updatePreassessmentCompletionState === 'function') updatePreassessmentCompletionState();
      if (typeof initAddressAutocomplete === 'function') initAddressAutocomplete();
    }
    if (id === 's-payment' && typeof updatePaymentScreen === 'function') updatePaymentScreen();
  } catch (error) {
    console.error('Screen hook error:', id, error);
    showToast('Could not refresh this screen');
  }
};
