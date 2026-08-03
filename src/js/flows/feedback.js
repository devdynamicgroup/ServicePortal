const GOOGLE_REVIEW_URL = 'https://g.page/r/Ce0EFhVtUyRpEBM/review';

function resolveGoogleReviewUrl() {
  return String(S.googleReviewUrl || GOOGLE_REVIEW_URL).trim() || GOOGLE_REVIEW_URL;
}

function feedbackAssetPath(assetPath) {
  const pathName = window.location.pathname;
  const appBase = pathName.endsWith('/')
    ? pathName
    : pathName.includes('.')
      ? pathName.slice(0, pathName.lastIndexOf('/') + 1)
      : '/';
  return `${appBase}${assetPath}`;
}

function syncFeedbackReviewUi() {
  const reviewUrl = resolveGoogleReviewUrl();
  const linkEl = document.getElementById('fb-review-link-display');
  if (linkEl) {
    linkEl.href = reviewUrl;
    linkEl.textContent = reviewUrl;
  }
  const qrEl = document.getElementById('fb-review-qr');
  if (qrEl) qrEl.src = `${feedbackAssetPath('src/assets/google-review-qr.png')}?v=4`;
}

function openFeedbackModal() {
  S.googleReviewUrl = resolveGoogleReviewUrl();
  syncFeedbackReviewUi();
  if (typeof applyI18n === 'function') applyI18n(S.lang);
  document.getElementById('feedback-overlay')?.classList.remove('hidden');
}

function closeFeedbackModal() {
  document.getElementById('feedback-overlay')?.classList.add('hidden');
}

/** Job Feedback step — popup only (no form screen). */
function initFeedbackScreen() {
  openFeedbackModal();
}

function openGoogleReview() {
  const reviewUrl = resolveGoogleReviewUrl();
  S.googleReviewUrl = reviewUrl;
  window.open(reviewUrl, '_blank', 'noopener,noreferrer');
}

function completeFeedback() {
  closeFeedbackModal();
  S.stepsDone.feedback = true;
  S.googleReviewUrl = resolveGoogleReviewUrl();
  if (S.activeJob?.draft) {
    S.activeJob.draft.stepsDone = S.activeJob.draft.stepsDone || {};
    S.activeJob.draft.stepsDone.feedback = true;
  }
  saveActiveJobState();
  renderJobSteps();
  if (S.screen === 's-feedback') goScreen('s-job');
  showToast(typeof t === 'function' ? t('fb.saved') : 'Feedback saved');
}
