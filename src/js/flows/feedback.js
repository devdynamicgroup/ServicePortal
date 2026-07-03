const GOOGLE_REVIEW_URL = 'https://g.page/r/Ce0EFhVtUyRpEAE/review';

function openFeedbackModal() {
  S.googleReviewUrl = GOOGLE_REVIEW_URL;
  const linkEl = document.getElementById('fb-review-link-display');
  if (linkEl) {
    linkEl.href = GOOGLE_REVIEW_URL;
    linkEl.textContent = GOOGLE_REVIEW_URL;
  }
  if (typeof applyI18n === 'function') applyI18n(S.lang);
  document.getElementById('feedback-overlay')?.classList.remove('hidden');
}

function closeFeedbackModal() {
  document.getElementById('feedback-overlay')?.classList.add('hidden');
}

function openGoogleReview() {
  window.open(GOOGLE_REVIEW_URL, '_blank');
}

function completeFeedback() {
  S.stepsDone.feedback = true;
  S.googleReviewUrl = GOOGLE_REVIEW_URL;
  saveActiveJobState();
  renderJobSteps();
  closeFeedbackModal();
  showToast(typeof t === 'function' ? t('fb.saved') : 'Feedback saved');
}
