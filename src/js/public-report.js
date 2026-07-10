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

function configurePublicScoreChrome({ feedbackUrl, reviewUrl }) {
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

  const foot = document.querySelector('#s-score .foot');
  if (!foot) return;

  const buttons = [];
  if (feedbackUrl) {
    buttons.push(`<a class="btn btn-primary public-report-feedback" href="${escapeHtml(feedbackUrl)}">${S.lang === 'th' ? 'ให้คะแนนความพึงพอใจ' : 'Give feedback'}</a>`);
  }
  if (reviewUrl) {
    buttons.push(`<a class="btn btn-secondary public-report-review" href="${escapeHtml(reviewUrl)}" target="_blank" rel="noopener noreferrer">${S.lang === 'th' ? 'รีวิวบน Google' : 'Google review'}</a>`);
  }

  if (!buttons.length) {
    foot.classList.add('hidden');
    return;
  }

  foot.innerHTML = buttons.join('');
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

    const response = await fetch(`/api/report/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload.report) {
      throw new Error(payload.error || 'Report not found');
    }

    configurePublicScoreChrome({
      feedbackUrl: config.feedbackUrl || '',
      reviewUrl: config.reviewUrl || ''
    });

    // Same renderer as the in-app Water Score screen.
    renderWaterScore(payload.report, { publicView: true });
  } catch (error) {
    console.error('Public report load failed', error);
    showPublicReportError(error.message || 'Could not load report');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPublicReport);
} else {
  initPublicReport();
}
