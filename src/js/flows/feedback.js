const GOOGLE_REVIEW_URL = 'https://g.page/r/Ce0EFhVtUyRpEBM/review';

const AI_FEEDBACK_SUGGESTIONS = Object.freeze({
  5: 'The specialist was thorough and explained everything clearly. I feel more confident about our water quality now.',
  4: 'Helpful visit overall. The readings and recommendations were easy to understand.',
  3: 'The service was fine. A bit more detail on next steps would be helpful.',
  2: 'Some parts of the visit were useful, but I hoped for clearer recommendations.',
  1: 'The visit did not meet my expectations. I would like clearer communication next time.'
});

let feedbackRating = null;

function resolveGoogleReviewUrl() {
  return String(S.googleReviewUrl || GOOGLE_REVIEW_URL).trim() || GOOGLE_REVIEW_URL;
}

function setFeedbackStars(rating) {
  const value = Number(rating);
  feedbackRating = Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
  S.rating = feedbackRating || S.rating || 0;
  document.querySelectorAll('#fb-stars .star-btn').forEach(btn => {
    const starValue = Number(btn.dataset.rating);
    const active = feedbackRating != null && starValue <= feedbackRating;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function bindFeedbackStars() {
  const root = document.getElementById('fb-stars');
  if (!root || root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';
  root.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', () => setFeedbackStars(btn.dataset.rating));
  });
}

function resetFeedbackForm() {
  const savedRating = Number(S.rating);
  setFeedbackStars(Number.isFinite(savedRating) && savedRating >= 1 && savedRating <= 5 ? savedRating : 5);
  const commentEl = document.getElementById('fb-comment');
  const consentEl = document.getElementById('fb-consent');
  const draftComment = S.activeJob?.draft?.fields?.['fb-comment'];
  if (commentEl) commentEl.value = draftComment != null ? String(draftComment) : '';
  if (consentEl) {
    const draftConsent = S.activeJob?.draft?.fields?.['fb-consent'];
    consentEl.checked = draftConsent == null ? true : String(draftConsent) !== 'false';
  }
}

function initFeedbackScreen() {
  S.googleReviewUrl = resolveGoogleReviewUrl();
  bindFeedbackStars();
  resetFeedbackForm();
  if (typeof applyI18n === 'function') applyI18n(S.lang);
}

function openFeedbackModal() {
  goScreen('s-feedback');
}

function closeFeedbackModal() {
  document.getElementById('feedback-overlay')?.classList.add('hidden');
}

function aiSuggestFeedback() {
  const rating = feedbackRating || Number(S.rating) || 5;
  const suggestion = AI_FEEDBACK_SUGGESTIONS[rating] || AI_FEEDBACK_SUGGESTIONS[5];
  const commentEl = document.getElementById('fb-comment');
  if (commentEl) commentEl.value = suggestion;
  showToast(typeof t === 'function' ? t('fb.aiApplied') : 'Suggestion added');
}

async function shareFeedbackLink() {
  const url = resolveGoogleReviewUrl();
  const shareData = {
    title: 'Water Motion Review',
    text: typeof t === 'function' ? t('fb.shareText') : 'Share your experience with Water Motion',
    url
  };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    await navigator.clipboard.writeText(url);
    showToast(typeof t === 'function' ? t('fb.linkCopied') : 'Review link copied');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    try {
      await navigator.clipboard.writeText(url);
      showToast(typeof t === 'function' ? t('fb.linkCopied') : 'Review link copied');
    } catch {
      showToast(typeof t === 'function' ? t('fb.shareFailed') : 'Could not share link');
    }
  }
}

function openGoogleReview() {
  const url = resolveGoogleReviewUrl();
  S.googleReviewUrl = url;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function completeFeedback() {
  const commentEl = document.getElementById('fb-comment');
  const consentEl = document.getElementById('fb-consent');
  if (feedbackRating) S.rating = feedbackRating;
  if (S.activeJob?.draft) {
    S.activeJob.draft.fields = S.activeJob.draft.fields || {};
    if (commentEl) S.activeJob.draft.fields['fb-comment'] = commentEl.value;
    if (consentEl) S.activeJob.draft.fields['fb-consent'] = consentEl.checked ? 'true' : 'false';
  }
  S.stepsDone.feedback = true;
  S.googleReviewUrl = resolveGoogleReviewUrl();
  saveActiveJobState();
  renderJobSteps();
  closeFeedbackModal();
  goScreen('s-job');
  showToast(typeof t === 'function' ? t('fb.saved') : 'Feedback saved');
}
