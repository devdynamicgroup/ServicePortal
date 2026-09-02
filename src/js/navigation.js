function closeTransientOverlays() {
  if (typeof closeCameraCapture === 'function') closeCameraCapture();
  [
    'camera-overlay',
    'action-sheet-overlay',
    'search-overlay',
    'notif-overlay',
    'lang-overlay',
    'signout-overlay',
    'cancel-case-overlay',
    'month-overlay',
    'pkg-overlay',
    'pkg-sheet'
  ].forEach(id => document.getElementById(id)?.classList.add('hidden'));
}

function goScreen(id) {
  if (id === 's-dash') {
    // Manual Create cases only become cards after Save Draft.
    if (typeof discardUnsavedManualCases === 'function') discardUnsavedManualCases();
    if (S.activeJob) saveActiveJobState();
    closeTransientOverlays();
    document.getElementById(S.screen)?.classList.remove('active');
    S.prev = S.screen;
    S.screen = id;
    const next = document.getElementById(id);
    next?.classList.add('active');
    const scroller = next?.querySelector('.content, .content-bare, .content-consent');
    if (typeof scroller?.scrollTo === 'function') scroller.scrollTo(0, 0);
    else if (scroller) scroller.scrollTop = 0;
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);

    // Show local name immediately, then sync profile to Notion before re-fetch
    // so the dashboard refresh does not flash the create-time placeholder name.
    if (typeof renderCalendar === 'function') renderCalendar();
    else if (typeof renderJobs === 'function') renderJobs();

    (async () => {
      if (typeof syncJobProfileToNotion === 'function' && S.activeJob?.notionId) {
        await syncJobProfileToNotion(S.activeJob);
      }
      if (typeof syncJobAssessmentToNotion === 'function' && S.activeJob?.notionId) {
        await syncJobAssessmentToNotion(S.activeJob);
      }
      if (typeof loadJobsFromApi === 'function') await loadJobsFromApi();
      if (typeof renderCalendar === 'function') renderCalendar();
      else if (typeof renderJobs === 'function') renderJobs();
    })();
    return;
  }
  closeTransientOverlays();
  document.getElementById(S.screen)?.classList.remove('active');
  S.prev = S.screen; S.screen = id;
  const next = document.getElementById(id);
  next?.classList.add('active');
  const scroller = next?.querySelector('.content, .content-bare, .content-consent');
  if (typeof scroller?.scrollTo === 'function') scroller.scrollTo(0, 0);
  else if (scroller) scroller.scrollTop = 0;
  if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);

  // Meter Readings: jump straight into the camera on entry instead of
  // landing on the form first -- only when this tap has no meter photo
  // yet, so re-opening an already-photographed tap to edit values doesn't
  // keep reopening the camera every time.
  if (id === 's-meter' && typeof openCameraCapture === 'function') {
    const tap = S.tapData?.[S.activeTap];
    const hasMeterPhoto = Boolean(tap?.meterImages?.length || tap?.photos?.meter);
    if (!hasMeterPhoto) {
      openCameraCapture('meter-photo-input', 'meter-photo-preview');
    }
  }
}
function goBack(id) { goScreen(id); }
