let sharingPublicReport = false;

const INSPECTION_TASK_LABELS = {
  tapphoto: 'Tap photo',
  visual: 'Visual check',
  meter: 'Meter reading',
  chlorine: 'Chlorine test',
  pressure: 'Pressure / flow',
  infra: 'Infrastructure'
};

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

function customerDisplayName(job) {
  const fields = job?.draft?.fields || {};
  const full = [fields['ci-fname'], fields['ci-lname']].filter(Boolean).join(' ').trim();
  return full || job?.name || '';
}

function jobHasStoredReadings(job) {
  const draft = job?.draft || {};
  if (draft.scoreBaseReadings && typeof draft.scoreBaseReadings === 'object') {
    return Object.values(draft.scoreBaseReadings).some(value => value !== undefined && value !== null && value !== '');
  }
  const fields = draft.fields || {};
  return ['m-ph', 'm-tds', 'm-turb', 'm-orp', 'm-do', 'm-free-cl', 'm-temp'].some(key => {
    const value = fields[key];
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
}

function resolvePublishedTaps(job) {
  const draft = job?.draft || {};
  const names = Array.isArray(draft.taps) ? draft.taps : [];
  const tapData = Array.isArray(draft.tapData) ? draft.tapData : [];
  const active = names.filter((_, index) => {
    const entry = tapData[index] || {};
    const tasks = Object.values(entry.tasks || {}).some(Boolean);
    const photos = Object.values(entry.photos || {}).some(src => String(src || '').trim());
    return tasks || photos;
  });
  return active.length ? active : ['Tap 1'];
}

function buildInspectionSections(job) {
  const draft = job?.draft || {};
  const taps = Array.isArray(draft.taps) ? draft.taps : [];
  const tapData = Array.isArray(draft.tapData) ? draft.tapData : [];
  const sections = [];

  taps.forEach((tapName, index) => {
    const entry = tapData[index] || { tasks: {}, photos: {} };
    const tasks = entry.tasks || {};
    const photos = entry.photos || {};
    const checklist = Object.keys(INSPECTION_TASK_LABELS)
      .filter(key => tasks[key])
      .map(key => INSPECTION_TASK_LABELS[key]);
    const photoItems = Object.entries(photos)
      .filter(([, src]) => String(src || '').trim())
      .map(([key, src]) => ({
        label: INSPECTION_TASK_LABELS[key] || key,
        src: String(src)
      }))
      .filter(item => item.src.startsWith('http') || item.src.startsWith('data:image'));

    if (!checklist.length && !photoItems.length) return;

    let html = `<div class="card gap12"><h3 class="public-report-section-title">${escapeHtml(tapName)}</h3>`;
    if (checklist.length) {
      html += `<ul class="public-report-checklist">${checklist.map(label => `<li>${escapeHtml(label)}</li>`).join('')}</ul>`;
    }
    if (photoItems.length) {
      html += `<div class="public-report-photo-grid">${photoItems.map(item => `
        <figure>
          <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.label)}">
          <figcaption>${escapeHtml(item.label)}</figcaption>
        </figure>`).join('')}</div>`;
    }
    html += '</div>';
    sections.push(html);
  });

  return sections;
}

function insertReportSection(scrollEl, html, beforeEl) {
  if (!html || !scrollEl) return null;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const node = wrapper.firstElementChild;
  if (!node) return null;
  if (beforeEl) scrollEl.insertBefore(node, beforeEl);
  else scrollEl.appendChild(node);
  return node;
}

function renderPublicReportSections(job) {
  const scrollEl = document.querySelector('#s-score .content-bare.score-scroll');
  const heroEl = document.getElementById('score-hero');
  const readingsEl = document.querySelector('#s-score .score-readings');
  const standardEl = document.querySelector('#s-score .wq-standard-section');
  if (!scrollEl || !heroEl) return;

  insertReportSection(scrollEl, '<div class="public-report-brand">WATER MOTION</div>', heroEl);

  const fields = job?.draft?.fields || {};
  const appointment = [job.date, job.timeStart, job.timeEnd].filter(Boolean).join(' · ');
  const property = [fields['ci-proptype'], fields['ci-propage']].filter(Boolean).join(' · ');
  const customerHtml = `
    <div class="public-report-stack">
      <div class="card gap12">
        <h2 class="public-report-section-title">${escapeHtml(customerDisplayName(job))}</h2>
        <div class="public-report-meta">
          ${appointment ? `<div class="public-report-meta-row"><span>${S.lang === 'th' ? 'วันนัดหมาย' : 'Service date'}</span><strong>${escapeHtml(appointment)}</strong></div>` : ''}
          ${fields['ci-addr'] || job.addr ? `<div class="public-report-meta-row"><span>${S.lang === 'th' ? 'ที่อยู่' : 'Address'}</span><strong>${escapeHtml(fields['ci-addr'] || job.addr)}</strong></div>` : ''}
          ${fields['ci-phone'] ? `<div class="public-report-meta-row"><span>${S.lang === 'th' ? 'โทรศัพท์' : 'Phone'}</span><strong>${escapeHtml(fields['ci-phone'])}</strong></div>` : ''}
          ${fields['ci-email'] ? `<div class="public-report-meta-row"><span>Email</span><strong>${escapeHtml(fields['ci-email'])}</strong></div>` : ''}
          ${property || job.meta ? `<div class="public-report-meta-row"><span>${S.lang === 'th' ? 'ทรัพย์สิน' : 'Property'}</span><strong>${escapeHtml(property || job.meta)}</strong></div>` : ''}
        </div>
      </div>
    </div>`;
  insertReportSection(scrollEl, customerHtml, heroEl);

  const summary = String(job?.result?.summary || '').trim();
  const recommendations = String(job?.result?.recommendations || '').trim();
  const narrativeParts = [];
  if (summary) {
    narrativeParts.push(`
      <div class="card gap12">
        <h3 class="public-report-section-title">${S.lang === 'th' ? 'สรุปผล' : 'Summary'}</h3>
        <p class="public-report-body">${escapeHtml(summary)}</p>
      </div>`);
  }
  if (recommendations) {
    narrativeParts.push(`
      <div class="card gap12">
        <h3 class="public-report-section-title">${S.lang === 'th' ? 'คำแนะนำ' : 'Recommendations'}</h3>
        <p class="public-report-body">${escapeHtml(recommendations)}</p>
      </div>`);
  }
  if (narrativeParts.length) {
    insertReportSection(scrollEl, `<div class="public-report-stack">${narrativeParts.join('')}</div>`, readingsEl || standardEl);
  }

  if (!jobHasStoredReadings(job) && readingsEl) {
    readingsEl.remove();
  }

  const inspectionSections = buildInspectionSections(job);
  if (inspectionSections.length) {
    insertReportSection(
      scrollEl,
      `<div class="public-report-stack"><div class="sec-label">${S.lang === 'th' ? 'รายละเอียดการตรวจ' : 'Inspection details'}</div>${inspectionSections.join('')}</div>`,
      standardEl
    );
  }

  const concerns = Array.isArray(job?.draft?.msConcerns) ? job.draft.msConcerns.filter(Boolean) : [];
  if (concerns.length) {
    insertReportSection(
      scrollEl,
      `<div class="public-report-stack">
        <div class="card gap12">
          <h3 class="public-report-section-title">${S.lang === 'th' ? 'ข้อกังวลด้านน้ำ' : 'Water concerns'}</h3>
          <div class="public-report-concerns">${concerns.map(item => `<span class="public-report-concern">${escapeHtml(item)}</span>`).join('')}</div>
        </div>
      </div>`,
      standardEl
    );
  }
}

function configurePublicReportView({ feedbackUrl, reviewUrl }) {
  document.body.classList.add('public-report-mode');
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
    foot.remove();
    return;
  }

  foot.innerHTML = `<div class="public-report-foot-actions">${buttons.join('')}</div>`;
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

function renderPublishedReport(job) {
  S.taps = resolvePublishedTaps(job);
  renderPublicReportSections(job);
  renderPublishedScore(job);
}

async function initPublicReport() {
  const config = window.__WM_PUBLIC_REPORT__ || {};
  const token = String(config.token || '').trim();
  if (!token) {
    showPublicReportError('Invalid report link.');
    return;
  }

  try {
    setLanguage(localStorage.getItem('wm-lang') || 'th', { silent: true });
    const response = await fetch(`/api/report/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload.report) {
      throw new Error(payload.error || 'Report not found');
    }

    configurePublicReportView({
      feedbackUrl: config.feedbackUrl || '',
      reviewUrl: config.reviewUrl || ''
    });
    renderPublishedReport(payload.report);
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
