let feedbackRating = null;
let feedbackSubmitting = false;

function prefillsForFeedbackForm() {
  const job = S.activeJob;
  const fields = job?.draft?.fields || {};
  const first = String(fields['ci-fname'] || '').trim();
  const last = String(fields['ci-lname'] || '').trim();
  const name = [first, last].filter(Boolean).join(' ') || String(job?.name || '').trim();
  const email = String(fields['ci-email'] || '').trim();
  return { name, email };
}

function setFeedbackStars(rating) {
  feedbackRating = Number.isFinite(Number(rating)) ? Number(rating) : null;
  document.querySelectorAll('#fb-stars .fb-star').forEach(btn => {
    const value = Number(btn.dataset.rating);
    const active = feedbackRating != null && value <= feedbackRating;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-checked', feedbackRating === value ? 'true' : 'false');
  });
  const err = document.getElementById('fb-rating-error');
  if (err && feedbackRating) err.classList.add('hidden');
}

function bindFeedbackStars() {
  const root = document.getElementById('fb-stars');
  if (!root || root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';
  root.querySelectorAll('.fb-star').forEach(btn => {
    btn.addEventListener('click', () => setFeedbackStars(btn.dataset.rating));
  });
}

function showFeedbackFormView() {
  document.getElementById('fb-form-view')?.classList.remove('hidden');
  document.getElementById('fb-success-view')?.classList.add('hidden');
  document.getElementById('fb-form-foot')?.classList.remove('hidden');
  document.getElementById('fb-success-foot')?.classList.add('hidden');
}

function showFeedbackSuccessView() {
  document.getElementById('fb-form-view')?.classList.add('hidden');
  document.getElementById('fb-success-view')?.classList.remove('hidden');
  document.getElementById('fb-form-foot')?.classList.add('hidden');
  document.getElementById('fb-success-foot')?.classList.remove('hidden');
}

function resetFeedbackForm() {
  feedbackRating = null;
  feedbackSubmitting = false;
  setFeedbackStars(null);
  const nameEl = document.getElementById('fb-name');
  const emailEl = document.getElementById('fb-email');
  const commentEl = document.getElementById('fb-comment');
  const prefills = prefillsForFeedbackForm();
  if (nameEl) nameEl.value = prefills.name;
  if (emailEl) emailEl.value = prefills.email;
  if (commentEl) commentEl.value = '';
  document.getElementById('fb-rating-error')?.classList.add('hidden');
  document.getElementById('fb-comment-error')?.classList.add('hidden');
  document.getElementById('fb-submit-error')?.classList.add('hidden');
  const btn = document.getElementById('fb-submit-btn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = typeof t === 'function' ? t('fb.submit') : 'Submit Feedback';
  }
  showFeedbackFormView();
}

function initFeedbackScreen() {
  bindFeedbackStars();
  resetFeedbackForm();
  if (typeof applyI18n === 'function') applyI18n(S.lang);
}

function openFeedbackModal() {
  // Legacy entry point — open the in-app Feedback screen instead of Google Review.
  goScreen('s-feedback');
}

function closeFeedbackModal() {
  document.getElementById('feedback-overlay')?.classList.add('hidden');
}

function validateFeedbackForm() {
  const comment = String(document.getElementById('fb-comment')?.value || '').trim();
  let ok = true;

  const ratingError = document.getElementById('fb-rating-error');
  if (!feedbackRating) {
    ratingError?.classList.remove('hidden');
    ok = false;
  } else {
    ratingError?.classList.add('hidden');
  }

  const commentError = document.getElementById('fb-comment-error');
  if (!comment) {
    commentError?.classList.remove('hidden');
    ok = false;
  } else {
    commentError?.classList.add('hidden');
  }

  return ok;
}

async function submitFeedbackForm() {
  if (feedbackSubmitting) return;
  if (!validateFeedbackForm()) return;

  const job = S.activeJob;
  const caseRef = job?.notionId || job?.id;
  if (!caseRef) {
    const err = document.getElementById('fb-submit-error');
    if (err) {
      err.textContent = typeof t === 'function' ? t('fb.err.case') : 'Please open a job before submitting feedback';
      err.classList.remove('hidden');
    }
    return;
  }

  const payload = {
    rating: feedbackRating,
    name: String(document.getElementById('fb-name')?.value || '').trim(),
    email: String(document.getElementById('fb-email')?.value || '').trim(),
    comment: String(document.getElementById('fb-comment')?.value || '').trim()
  };

  feedbackSubmitting = true;
  const btn = document.getElementById('fb-submit-btn');
  const submitError = document.getElementById('fb-submit-error');
  submitError?.classList.add('hidden');
  if (btn) {
    btn.disabled = true;
    btn.textContent = typeof t === 'function' ? t('fb.submitting') : 'Submitting...';
  }

  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseRef)}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Could not submit feedback');
    }

    if (job) {
      job.feedback = {
        ...(job.feedback || {}),
        token: result.feedbackToken || job.feedback?.token,
        status: 'submitted',
        rating: payload.rating,
        comment: payload.comment,
        submittedAt: result.submittedAt || new Date().toISOString()
      };
    }
    S.rating = payload.rating;
    showFeedbackSuccessView();
  } catch (error) {
    console.error('Feedback submit failed', error);
    if (submitError) {
      submitError.textContent = error.message || (typeof t === 'function' ? t('fb.err.submit') : 'Could not submit feedback');
      submitError.classList.remove('hidden');
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = typeof t === 'function' ? t('fb.submit') : 'Submit Feedback';
    }
  } finally {
    feedbackSubmitting = false;
  }
}

function completeFeedback() {
  S.stepsDone.feedback = true;
  saveActiveJobState();
  renderJobSteps();
  closeFeedbackModal();
  goScreen('s-job');
  showToast(typeof t === 'function' ? t('fb.saved') : 'Feedback saved');
}
