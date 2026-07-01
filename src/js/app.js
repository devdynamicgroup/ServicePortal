async function initApp() {
  try {
    await loadPagePartials();
    const csvSeedVersion = 'clients-30-v1';
    if (localStorage.getItem('wm-csv-seed-version') !== csvSeedVersion && typeof loadJobsFromCsv === 'function') {
      const loadedCsv = await loadJobsFromCsv();
      if (loadedCsv) localStorage.setItem('wm-csv-seed-version', csvSeedVersion);
    } else if (!loadJobsFromStorage() && typeof loadJobsFromCsv === 'function') {
      await loadJobsFromCsv();
    }
    runInitStep(initTaps);
    runInitStep(initOwnerRadios);
    runInitStep(initChipGroups);
    runInitStep(initPreassessmentValidation);
    runInitStep(updateAssessScreen);
    runInitStep(updatePayToggle);
    runInitStep(() => setLanguage(S.lang, { silent: true }));
    runInitStep(() => setRating(S.rating));
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
  _origGoScreen(id);
  try {
    if (id === 's-assess') renderAssessList();
    if (id === 's-score') calcAndShowScore();
    if (id === 's-payment') updatePaymentScreen();
    if (id === 's-preassess') {
      if (typeof updateProvinceOptions === 'function') updateProvinceOptions();
      if (typeof updatePreassessmentOptionText === 'function') updatePreassessmentOptionText();
    }
  } catch (error) {
    console.error('Screen hook error:', id, error);
    showToast('Could not refresh this screen');
  }
};
