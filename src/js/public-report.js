let sharingPublicReport = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showPublicReportError(message) {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <div class="content">
      <div class="card gap12">
        <h2 style="margin:0">Report not found</h2>
        <p style="margin:0;color:var(--muted)">${escapeHtml(message || 'This report link may be expired or incorrect.')}</p>
      </div>
    </div>
  `;
}

function configurePublicScoreChrome() {
  document.body.classList.add('public-report-mode');
  S.screen = 's-score';
  S.publicScoreView = true;

  const screen = document.getElementById('s-score');
  screen?.classList.add('active');

  document.querySelector('#s-score .hdr-back')?.classList.add('hidden');

  const shareBtn = document.querySelector('#s-score .hdr-action');
  if (shareBtn) {
    shareBtn.removeAttribute('onclick');
    shareBtn.type = 'button';
    shareBtn.onclick = sharePublicReport;
  }

  // Public report is read-only: no Give Feedback / Google Review footer.
  document.querySelector('#s-score .foot')?.classList.add('hidden');
}

async function sharePublicReport() {
  if (sharingPublicReport) return;

  const shareData = {
    title: 'Water Motion - Water Score',
    text: Number.isFinite(Number(S.scoreVal)) ? `ผล Water Score: ${S.scoreVal}/100` : 'Water Motion Water Score',
    url: window.location.href
  };

  sharingPublicReport = true;
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      showToast('Score shared');
      return;
    }
    await navigator.clipboard.writeText(window.location.href);
    showToast('Score link copied');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('Share report failed', error);
    showToast('Could not share score');
  } finally {
    sharingPublicReport = false;
  }
}

function mountPublicWaterScore(report) {
  console.log('[public-report] renderWaterScore called', {
    keys: Object.keys(report || {}),
    draftKeys: Object.keys(report?.draft || {}),
    waterScore: report?.result?.waterScore,
    scoreBaseReadings: report?.draft?.scoreBaseReadings,
    tapDataCount: Array.isArray(report?.draft?.tapData) ? report.draft.tapData.length : 0
  });

  configurePublicScoreChrome();
  S.scoreStandardKey = typeof DEFAULT_SCORE_STANDARD_KEY !== 'undefined' ? DEFAULT_SCORE_STANDARD_KEY : 'thailand';

  const score = renderWaterScore(report, { publicView: true });
  console.log('[public-report] renderWaterScore finished', {
    score,
    gaugeVal: document.getElementById('gauge-val')?.textContent,
    findings: Boolean(document.getElementById('score-summary-finding')?.textContent),
    readingRows: document.getElementById('score-readings-rows')?.children?.length || 0
  });
  return score;
}

async function initPublicReport() {
  const config = window.__WM_PUBLIC_REPORT__ || {};
  const token = String(config.token || '').trim();
  if (!token) {
    showPublicReportError('Invalid report link.');
    return;
  }

  try {
    S.lang = localStorage.getItem('wm-lang') || 'th';
    if (typeof applyI18n === 'function') applyI18n(S.lang);

    // Prefer embedded report for first paint (no empty flash while waiting on fetch).
    if (config.report) {
      mountPublicWaterScore(config.report);
    }

    const response = await fetch(`/api/report/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload.report) {
      if (!config.report) throw new Error(payload.error || 'Report not found');
      return;
    }

    mountPublicWaterScore(payload.report);
  } catch (error) {
    console.error('Public report load failed', error);
    if (!config.report) showPublicReportError(error.message || 'Could not load report');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPublicReport);
} else {
  initPublicReport();
}
