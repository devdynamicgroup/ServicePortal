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

function initFeedbackScreen() {
  openFeedbackModal();
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

function openGoogleReview() {
  const reviewUrl = resolveGoogleReviewUrl();
  S.googleReviewUrl = reviewUrl;
  window.open(reviewUrl, '_blank', 'noopener,noreferrer');
}

function completeFeedback() {
  closeFeedbackModal();
  S.googleReviewUrl = resolveGoogleReviewUrl();
  S.stepsDone.feedback = true;
  if (S.activeJob?.draft) {
    S.activeJob.draft.stepsDone = S.activeJob.draft.stepsDone || {};
    S.activeJob.draft.stepsDone.feedback = true;
  }
  if (typeof saveActiveJobState === 'function') saveActiveJobState();
  if (typeof renderJobSteps === 'function') renderJobSteps();
  if (typeof goScreen === 'function') goScreen('s-job');
  if (typeof showToast === 'function') {
    showToast(typeof t === 'function' ? t('fb.saved') : 'Feedback saved');
  }
}
