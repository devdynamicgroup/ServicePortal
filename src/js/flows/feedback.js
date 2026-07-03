function setRating(n) {
  S.rating = n;
  document.querySelectorAll('#fb-stars .star-btn, .stars .star-btn').forEach((b, i) => b.classList.toggle('active', i < n));
}

function toggleFbConsent() {
  const cb = document.getElementById('fb-consent');
  cb.checked = !cb.checked;
}

const FEEDBACK_SUGGESTIONS = [
  'The specialist explained each step clearly and helped us understand what to improve. The visit felt professional and useful.',
  'We thought our filter solved everything — the Water Score showed us the rest of the home had never been checked. Very eye-opening.',
  'Good service, clear explanation, and practical recommendations for improving our water quality at every tap.',
  'The team was on time, checked everything carefully, and made the results easy to understand without jargon.',
  'Very helpful visit. I appreciated the clear report and advice that matched our home setup and daily habits.',
  'I believed my hair issues came from shampoo — learning about chlorine in our water changed how we think about the whole home.',
  'New home, new renovation — we did not expect water to be the issue. The assessment gave us a clear baseline to act on.',
  'Professional, calm, and thorough. We now know our Water Score and what to improve before it becomes a bigger problem.'
];

function aiSuggestFeedback() {
  S.feedbackSuggestionIndex = ((S.feedbackSuggestionIndex ?? -1) + 1) % FEEDBACK_SUGGESTIONS.length;
  document.getElementById('fb-comment').value = FEEDBACK_SUGGESTIONS[S.feedbackSuggestionIndex];
  showToast(typeof t === 'function' ? t('fb.suggestUpdated') : 'Suggestion updated');
}

function syncFeedbackReviewLink() {
  const linkEl = document.getElementById('fb-review-link');
  if (!linkEl) return;
  linkEl.value = S.googleReviewUrl || '';
  linkEl.placeholder = typeof t === 'function' ? t('fb.reviewLinkPh') : 'Link will be added soon';
}

function openFeedbackModal() {
  setRating(S.rating);
  syncFeedbackReviewLink();
  if (typeof applyI18n === 'function') applyI18n(S.lang);
  document.getElementById('feedback-overlay')?.classList.remove('hidden');
}

function closeFeedbackModal() {
  document.getElementById('feedback-overlay')?.classList.add('hidden');
}

function openGoogleReview() {
  const url = (S.googleReviewUrl || document.getElementById('fb-review-link')?.value || '').trim();
  if (!url) {
    showToast(typeof t === 'function' ? t('fb.reviewLinkPending') : 'Review link not ready yet');
    return;
  }
  window.open(url, '_blank');
}

function shareReportLink() {
  showToast(typeof t === 'function' ? t('fb.linkCopied') : 'Report link copied — send to client');
}

function completeFeedback() {
  S.stepsDone.feedback = true;
  saveActiveJobState();
  renderJobSteps();
  closeFeedbackModal();
  showToast(typeof t === 'function' ? t('fb.saved') : 'Feedback saved');
}
