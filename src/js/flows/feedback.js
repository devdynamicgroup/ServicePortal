const GOOGLE_REVIEW_URL = 'https://g.page/r/Ce0EFhVtUyRpEBM/review';

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
  const linkEl = document.getElementById('fb-review-link-display');
  if (linkEl) {
    linkEl.href = GOOGLE_REVIEW_URL;
    linkEl.textContent = GOOGLE_REVIEW_URL;
  }
  const qrEl = document.getElementById('fb-review-qr');
  if (qrEl) {
    qrEl.src = `${feedbackAssetPath('src/assets/google-review-qr.png')}?v=3`;
  }
}

function openFeedbackModal() {
  S.googleReviewUrl = GOOGLE_REVIEW_URL;
  syncFeedbackReviewUi();
  if (typeof applyI18n === 'function') applyI18n(S.lang);
  document.getElementById('feedback-overlay')?.classList.remove('hidden');
}

function closeFeedbackModal() {
  document.getElementById('feedback-overlay')?.classList.add('hidden');
}

function openGoogleReview() {
  window.open(GOOGLE_REVIEW_URL, '_blank', 'noopener,noreferrer');
}

function completeFeedback() {
  S.stepsDone.feedback = true;
  S.googleReviewUrl = GOOGLE_REVIEW_URL;
  saveActiveJobState();
  renderJobSteps();
  closeFeedbackModal();
  showToast(typeof t === 'function' ? t('fb.saved') : 'Feedback saved');
}
