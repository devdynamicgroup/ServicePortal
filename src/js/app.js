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
    runInitStep(restoreLoginSession);
  } catch (error) {
    document.getElementById('app').innerHTML = '<div class="content"><div class="card">Unable to load app pages. Please run this app through a local web server.</div></div>';
    console.error(error);
  }
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
  if (id === 's-feedback') {
    openFeedbackModal();
    return;
  }
  _origGoScreen(id);
  try {
    if (id === 's-assess') renderAssessList();
    if (typeof restoreCurrentPhotoScreen === 'function') restoreCurrentPhotoScreen(id);
    if (id === 's-meter' && window.MeterReadingCapture) MeterReadingCapture.init();
    if (id === 's-score') calcAndShowScore();
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
