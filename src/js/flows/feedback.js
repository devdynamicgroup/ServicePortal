function setRating(n) {
  S.rating = n;
  document.querySelectorAll('.star-btn').forEach((b,i) => b.classList.toggle('active', i < n));
}
function toggleFbConsent(){ const cb=document.getElementById('fb-consent'); cb.checked=!cb.checked; }
function aiSuggestFeedback(){ document.getElementById('fb-comment').value='The specialist was thorough and explained everything clearly. Very helpful visit!'; showToast('Suggestion added'); }
function openGoogleReview() { window.open('https://www.google.com/maps/search/Water+Motion+Bangkok', '_blank'); }
function shareReportLink() { showToast('Report link copied — send to client'); }
function completeFeedback() {
  S.stepsDone.feedback = true;
  saveActiveJobState();
  renderJobSteps();
  goScreen('s-job');
  showToast('Feedback saved');
}
