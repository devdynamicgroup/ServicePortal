function setRating(n) {
  S.rating = n;
  document.querySelectorAll('.star-btn').forEach((b, i) => b.classList.toggle('active', i < n));
}
function toggleFbConsent() { const cb = document.getElementById('fb-consent'); cb.checked = !cb.checked; }

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

function openGoogleReview() { window.open('https://www.google.com/maps/search/Water+Motion+Bangkok', '_blank'); }
function shareReportLink() { showToast('Report link copied — send to client'); }
function completeFeedback() {
  S.stepsDone.feedback = true;
  saveActiveJobState();
  renderJobSteps();
  goScreen('s-job');
  showToast('Feedback saved');
}
