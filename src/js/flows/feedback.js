const GOOGLE_REVIEW_URL = 'https://g.page/r/Ce0EFhVtUyRpEBM/review';

let feedbackRating = null;
let feedbackSuggestBusy = false;

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
  if (qrEl) qrEl.src = `${feedbackAssetPath('src/assets/google-review-qr.png')}?v=3`;
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
  S.googleReviewUrl = resolveGoogleReviewUrl();
  syncFeedbackReviewUi();
  if (typeof applyI18n === 'function') applyI18n(S.lang);
  document.getElementById('feedback-overlay')?.classList.remove('hidden');
}

function closeFeedbackModal() {
  document.getElementById('feedback-overlay')?.classList.add('hidden');
}

function packageLabelForSuggest(pkg) {
  const key = String(pkg || '').toLowerCase();
  if (key.includes('full')) return S.lang === 'th' ? 'Full Assessment' : 'Full Assessment';
  if (key.includes('essential') || key.includes('free')) return 'Water Score Check';
  return key || '';
}

function shortLocationForSuggest(fields = {}, job = null) {
  const city = String(fields['ci-city'] || '').trim();
  const addr = String(fields['ci-addr'] || job?.addr || '').trim();
  if (city) return city;
  if (!addr) return '';
  return addr.split(',')[0].trim().slice(0, 48);
}

function collectFeedbackSuggestContext() {
  const job = S.activeJob;
  const draft = job?.draft || {};
  const fields = draft.fields || {};
  const rating = feedbackRating || Number(S.rating) || 5;
  const scoreRaw = Number(S.scoreVal ?? draft.scoreVal ?? job?.result?.waterScore);
  const waterScore = Number.isFinite(scoreRaw) ? scoreRaw : null;

  let findings = [];
  try {
    if (typeof resolveScoreReadings === 'function' && typeof buildScoreFindings === 'function') {
      const readings = resolveScoreReadings(job);
      findings = buildScoreFindings(readings).map(item => item.label).filter(Boolean);
    } else if (Array.isArray(S.currentScoreResult?.findings)) {
      findings = S.currentScoreResult.findings.map(item => item.label || item.note).filter(Boolean);
    }
  } catch (error) {
    console.warn('Feedback context findings unavailable', error);
  }

  return {
    rating,
    lang: S.lang || 'en',
    technicianName: S.user?.name || '',
    location: shortLocationForSuggest(fields, job),
    propertyType: String(fields['ci-proptype'] || '').trim(),
    packageLabel: packageLabelForSuggest(draft.pkg || S.pkg || job?.pkg),
    waterScore,
    findings: findings.slice(0, 4),
    concerns: Array.isArray(draft.msConcerns) ? draft.msConcerns.slice(0, 4) : [],
    inspectionDone: Boolean(S.stepsDone?.assess || draft.stepsDone?.assess),
    scoreDone: Boolean(S.stepsDone?.score || draft.stepsDone?.score || Number.isFinite(waterScore)),
    tapsCount: (S.taps || draft.taps || []).length || null,
    variationSeed: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  };
}

function setAiSuggestLoading(isLoading) {
  const btn = document.querySelector('.ai-suggest');
  if (!btn) return;
  btn.disabled = Boolean(isLoading);
  btn.classList.toggle('is-loading', Boolean(isLoading));
  btn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  if (isLoading) {
    btn.dataset.prevLabel = btn.textContent;
    btn.textContent = typeof t === 'function' ? t('fb.aiLoading') : 'Suggesting…';
    return;
  }
  if (btn.dataset.prevLabel) {
    btn.textContent = btn.dataset.prevLabel;
    delete btn.dataset.prevLabel;
  } else if (typeof applyI18n === 'function') {
    applyI18n(S.lang);
  }
}

function applyFeedbackSuggestion(text) {
  const commentEl = document.getElementById('fb-comment');
  if (!commentEl || !text) return;
  commentEl.value = text;
  commentEl.dispatchEvent(new Event('input', { bubbles: true }));
  commentEl.focus();
  // Keep caret at end so customers can edit immediately.
  const len = commentEl.value.length;
  try { commentEl.setSelectionRange(len, len); } catch { /* ignore */ }
}

async function requestFeedbackSuggestion(context) {
  const response = await fetch('/api/feedback/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(context)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !data.suggestion) {
    throw new Error(data.error || 'Could not generate suggestion');
  }
  return data;
}

function buildLocalFeedbackDraft(context) {
  const rating = Number(context.rating) || 5;
  const tech = context.technicianName || (S.lang === 'th' ? 'ผู้เชี่ยวชาญ' : 'the specialist');
  const score = Number.isFinite(Number(context.waterScore)) ? Math.round(Number(context.waterScore)) : null;
  const area = context.location || '';
  const finding = Array.isArray(context.findings) && context.findings[0] ? context.findings[0] : '';
  const variants = {
    en: {
      5: [
        `Today’s assessment was clear and practical. ${tech} explained the readings without jargon${score != null ? `, and our Water Score landed around ${score}/100` : ''}${finding ? ` — ${finding.toLowerCase()} stood out` : ''}. ${area ? `For our home in ${area}, ` : ''}the summary made it easier to understand what actually matters day to day.`,
        `I appreciated how straightforward the visit felt. ${tech} walked us through the results calmly${score != null ? ` (about ${score}/100)` : ''}${finding ? ` and flagged ${finding.toLowerCase()}` : ''}. Helpful, grounded, and easy to act on.`
      ],
      4: [
        `Overall a good visit. ${tech} explained most things clearly${score != null ? `, including a Water Score around ${score}/100` : ''}. A slightly sharper note on next steps would make it excellent.`,
        `Mostly positive experience — professional and easy to follow${finding ? `, especially around ${finding.toLowerCase()}` : ''}. Just one or two details could have been clearer.`
      ],
      3: [
        `The appointment was fine. We got a usable overview${score != null ? ` (around ${score}/100)` : ''}, though a more concrete follow-up plan would help.`,
        `Useful in parts. ${tech} covered the basics${finding ? ` and mentioned ${finding.toLowerCase()}` : ''}, but we’re still looking for clearer next steps.`
      ],
      2: [
        `Some parts were helpful, but the explanations felt incomplete. ${tech} was polite; we’d just like clearer recommendations${finding ? ` around ${finding.toLowerCase()}` : ''}.`,
        `We left with data, not enough direction. A tighter summary of options would improve the experience.`
      ],
      1: [
        `Today didn’t meet what we hoped for. Communication around the results needs to be clearer${finding ? `, especially regarding ${finding.toLowerCase()}` : ''}.`,
        `We’re still unsure what to do next. Please follow up with a clearer explanation of findings and options.`
      ]
    },
    th: {
      5: [
        `วันนี้เข้าตรวจชัดเจนและเข้าใจง่าย ${tech} อธิบายผลได้อย่างเป็นกันเอง${score != null ? ` คะแนนน้ำอยู่ราว ${score}/100` : ''}${finding ? ` โดยเฉพาะเรื่อง${finding}` : ''} ทำให้มั่นใจในน้ำของบ้านมากขึ้น`,
        `ประทับใจการเข้าบริการ ${tech} สรุปผลเข้าใจง่าย${area ? ` สำหรับบ้านย่าน${area}` : ''} และช่วยให้รู้ว่าควรสนใจอะไรเป็นลำดับถัดไป`
      ],
      4: [
        `โดยรวมดี ${tech} อธิบายได้ชัด${score != null ? ` (ประมาณ ${score}/100)` : ''} ถ้าสรุปขั้นตอนถัดไปให้กระชับอีกนิดจะสมบูรณ์`,
        `บริการดีและเป็นมืออาชีพ มีจุดเล็กน้อยที่อยากได้รายละเอียดเพิ่ม`
      ],
      3: [
        `การเข้าบริการโอเค ได้ภาพรวมคุณภาพน้ำ${score != null ? ` ประมาณ ${score}/100` : ''} แต่ยังอยากได้แนวทางต่อที่ชัดกว่านี้`,
        `มีประโยชน์บางส่วน ข้อมูลพื้นฐานครบ แต่ยังไม่ถึงขั้นประทับใจมาก`
      ],
      2: [
        `มีบางส่วนที่เป็นประโยชน์ แต่การอธิบายยังไม่ชัดพอ อยากได้คำแนะนำที่เป็นรูปธรรมกว่านี้${finding ? ` โดยเฉพาะ${finding}` : ''}`,
        `ทีมสุภาพ แต่ยังคาดหวังการสรุปตัวเลือกแก้ไขที่ชัดกว่านี้`
      ],
      1: [
        `วันนี้ยังไม่ตรงความคาดหวัง การสื่อสารผลควรชัดและต่อเนื่องกว่านี้`,
        `ยังมีคำถามหลังการเข้าตรวจ หวังว่าจะมีการติดตามพร้อมคำอธิบายที่ชัดเจน`
      ]
    }
  };
  const lang = context.lang === 'th' ? 'th' : 'en';
  const list = variants[lang][rating] || variants[lang][5];
  return list[Math.floor(Math.random() * list.length)];
}

async function aiSuggestFeedback() {
  if (feedbackSuggestBusy) return;
  const commentEl = document.getElementById('fb-comment');
  if (!commentEl) return;

  feedbackSuggestBusy = true;
  setAiSuggestLoading(true);
  const context = collectFeedbackSuggestContext();
  try {
    const data = await requestFeedbackSuggestion(context);
    applyFeedbackSuggestion(String(data.suggestion).trim());
    showToast(typeof t === 'function' ? t('fb.aiApplied') : 'Draft added — edit freely before submitting');
  } catch (error) {
    console.warn('AI Suggest failed, using local draft', error);
    applyFeedbackSuggestion(buildLocalFeedbackDraft(context));
    showToast(typeof t === 'function' ? t('fb.aiApplied') : 'Draft added — edit freely before submitting');
  } finally {
    feedbackSuggestBusy = false;
    setAiSuggestLoading(false);
  }
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
  const reviewUrl = resolveGoogleReviewUrl();
  S.googleReviewUrl = reviewUrl;
  window.open(reviewUrl, '_blank', 'noopener,noreferrer');
  // Opening the review link / QR path must not complete the feedback step.
}

function isFeedbackQrModalOpen() {
  const overlay = document.getElementById('feedback-overlay');
  return Boolean(overlay && !overlay.classList.contains('hidden'));
}

function completeFeedback() {
  // QR popup Complete / dismiss — close only; never mark the step done.
  if (isFeedbackQrModalOpen()) {
    closeFeedbackModal();
    return;
  }

  // Feedback is only completed from the feedback form screen after collecting data.
  if (S.screen !== 's-feedback') return;

  const commentEl = document.getElementById('fb-comment');
  const consentEl = document.getElementById('fb-consent');
  const rating = feedbackRating != null
    ? feedbackRating
    : Number(S.rating);

  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    showToast(typeof t === 'function' ? t('fb.validation.rating') : 'Please select a rating');
    return;
  }

  S.rating = rating;
  if (S.activeJob?.draft) {
    S.activeJob.draft.fields = S.activeJob.draft.fields || {};
    if (commentEl) S.activeJob.draft.fields['fb-comment'] = commentEl.value;
    if (consentEl) S.activeJob.draft.fields['fb-consent'] = consentEl.checked ? 'true' : 'false';
    S.activeJob.draft.rating = rating;
  }
  S.stepsDone.feedback = true;
  S.googleReviewUrl = resolveGoogleReviewUrl();
  saveActiveJobState();
  renderJobSteps();
  goScreen('s-job');
  showToast(typeof t === 'function' ? t('fb.saved') : 'Feedback saved');
}
