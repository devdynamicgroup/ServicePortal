function setRating(n) {
  S.rating = n;
  document.querySelectorAll('.star-btn').forEach((b,i) => b.classList.toggle('active', i < n));
}
function toggleFbConsent(){ const cb=document.getElementById('fb-consent'); cb.checked=!cb.checked; }
const FEEDBACK_SUGGESTIONS = [
  'The specialist explained each step clearly and helped us understand what to improve. The visit felt professional and useful.',
  'Good service, clear explanation, and practical recommendations for improving our water quality.',
  'The team was on time, checked everything carefully, and made the results easy to understand.',
  'Very helpful visit. I appreciated the clear report and the advice that matched our home setup.'
];
function aiSuggestFeedback(){
  S.feedbackSuggestionIndex = ((S.feedbackSuggestionIndex ?? -1) + 1) % FEEDBACK_SUGGESTIONS.length;
  document.getElementById('fb-comment').value = FEEDBACK_SUGGESTIONS[S.feedbackSuggestionIndex];
  showToast('Suggestion updated');
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
