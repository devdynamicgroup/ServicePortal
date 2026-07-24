function closeTransientOverlays() {
  if (typeof closeCameraCapture === 'function') closeCameraCapture();
  [
    'camera-overlay',
    'action-sheet-overlay',
    'search-overlay',
    'notif-overlay',
    'lang-overlay',
    'signout-overlay',
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

    (async () => {
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
}
function goBack(id) { goScreen(id); }
