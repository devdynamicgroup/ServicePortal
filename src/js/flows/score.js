function getScoreStyle(wq) {
  if (wq >= 90) return { band: t('score.band.exceptional'), pill: '#5b8def', pillText: '#fff', arc: '#5b8def', glow: 'rgba(91,141,239,.35)' };
  if (wq >= 80) return { band: t('score.band.international'), pill: '#2e9b6f', pillText: '#0c0a09', arc: '#2e9b6f', glow: 'rgba(46,155,111,.4)' };
  if (wq >= 65) return { band: t('score.band.good'), pill: '#d9a441', pillText: '#0c0a09', arc: '#d9a441', glow: 'rgba(217,164,65,.35)' };
  if (wq >= 50) return { band: t('score.band.fair'), pill: '#c48a3a', pillText: '#0c0a09', arc: '#c48a3a', glow: 'rgba(196,138,58,.35)' };
  return { band: t('score.band.attention'), pill: '#f07b7b', pillText: '#0c0a09', arc: '#f07b7b', glow: 'rgba(240,123,123,.35)' };
}

/** Customer-facing verdict shown on the summary card (not the DWQI band legend). */
function customerVerdict(wq) {
  if (wq >= 80) return { label: t('score.verdict.excellent'), color: '#6ee7b7' };
  if (wq >= 65) return { label: t('score.verdict.good'), color: '#93c5fd' };
  return { label: t('score.verdict.attention'), color: '#fbbf24' };
}

function animateScoreNumber(el, target) {
  if (!el) return;
  const dur = 1100;
  const t0 = performance.now();
  function step(t) {
    const p = Math.min((t - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * ease);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function buildScoreFindings(readings) {
  const ph = Number(readings.ph);
  const fcl = Number(readings.chlorine);
  const turb = Number(readings.turbidity);
  const tds = Number(readings.tds);
  const findings = [];
  if (fcl > 0.5) findings.push({ label: t('score.concern.highChlorine'), val: fcl + ' mg/L', note: t('score.note.highChlorine') });
  if (turb > 5) findings.push({ label: t('score.concern.highTurbidity'), val: turb + ' NTU', note: t('score.note.highTurbidity') });
  if (fcl < 0.2) findings.push({ label: t('score.concern.lowChlorine'), val: fcl + ' mg/L', note: t('score.note.lowChlorine') });
  if (ph < 6.5 || ph > 8.5) findings.push({ label: t('score.concern.phRange'), val: String(ph), note: t('score.note.phRange') });
  if (tds > 600) findings.push({ label: t('score.concern.highTds'), val: tds + ' mg/L', note: t('score.note.highTds') });
  return findings;
}

function paramKey(paramName) {
  return String(paramName || '').toLowerCase();
}

/** One-line status hint shown on the collapsed metric row. */
function paramCollapsedHint(paramName, status) {
  if (status === 'good') return t('score.explain.withinRange');
  const key = paramKey(paramName);
  if (key === 'ph') return t('score.impact.ph');
  if (key === 'tds') return t('score.impact.tds');
  if (key === 'chlorine') return t('score.impact.chlorine');
  if (key === 'turbidity') return t('score.impact.turbidity');
  if (key === 'orp') return t('score.impact.orp');
  if (key === 'do') return t('score.impact.do');
  if (key === 'temp') return t('score.impact.temp');
  return t('score.impact.default');
}

/** Expanded “Meaning” line — calm wording for good rows, impact for attention. */
function paramMeaningText(paramName, status) {
  const key = paramKey(paramName);
  if (status === 'good') {
    if (key === 'ph') return t('score.meaning.ph');
    if (key === 'tds') return t('score.meaning.tds');
    if (key === 'chlorine') return t('score.meaning.chlorine');
    if (key === 'turbidity') return t('score.meaning.turbidity');
    if (key === 'orp') return t('score.meaning.orp');
    if (key === 'do') return t('score.meaning.do');
    if (key === 'temp') return t('score.meaning.temp');
    return t('score.explain.withinRange');
  }
  return paramCollapsedHint(paramName, status);
}

function renderScoreStatusBar(wq) {
  const bar = document.getElementById('score-status-bar');
  if (!bar) return;
  const score = Math.max(0, Math.min(100, Number(wq) || 0));
  // Score level visualization (0–7), not one segment per parameter.
  const lit = Math.max(0, Math.min(7, Math.round(score / 100 * 7)));
  bar.setAttribute('aria-label', `Water Score ${Math.round(score)} of 100`);
  bar.innerHTML = Array.from({ length: 7 }, (_, index) =>
    `<span class="${index < lit ? 'is-on' : ''}"></span>`
  ).join('');
}

function renderScoreDisplay(wq, readings) {
  const hero = document.getElementById('score-hero');
  const bandEl = document.getElementById('score-summary-band');
  const noteEl = document.getElementById('score-summary-note');
  const findings = buildScoreFindings(readings);
  const top = findings[0];
  const verdict = customerVerdict(wq);

  if (hero) {
    hero.className = 'score-report score-live';
    hero.dataset.tier = wq >= 80 ? 'high' : wq >= 65 ? 'mid' : 'low';
  }
  if (bandEl) {
    bandEl.textContent = verdict.label;
    bandEl.style.color = '';
  }
  // Keep summary note short for comfortable scrolling; full detail lives in expanded rows.
  if (noteEl) {
    if (top) {
      noteEl.textContent = top.note;
    } else if (wq >= 80) {
      noteEl.textContent = t('score.msg.high');
    } else if (wq >= 65) {
      noteEl.textContent = t('score.msg.good');
    } else {
      noteEl.textContent = t('score.msg.subShort');
    }
  }

  renderScoreStatusBar(wq);
  if (!S.scoreTapFilter) S.scoreTapFilter = 'all';
  S.scoreParamOpen = null;
  animateScoreNumber(document.getElementById('gauge-val'), wq);
  renderScoreReadings();
  renderRoomAnalysis();
}

function meterFieldValue(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const value = parseFloat(el.value);
  return Number.isFinite(value) ? value : fallback;
}

function readingsFromJob(job) {
  const draft = job?.draft || {};
  const fields = draft.fields || {};
  if (draft.scoreBaseReadings && typeof draft.scoreBaseReadings === 'object') {
    return { ...draft.scoreBaseReadings };
  }
  return {
    ph: parseFloat(fields['m-ph']) || 7.2,
    tds: parseFloat(fields['m-tds']) || 450,
    chlorine: parseFloat(fields['m-free-cl']) || 2.1,
    turbidity: parseFloat(fields['m-turb']) || 1.2,
    orp: parseFloat(fields['m-orp']) || 320,
    do: parseFloat(fields['m-do']) || 6.8,
    temp: parseFloat(fields['m-temp']) || 28
  };
}

function computeScoreFromReadings(readings) {
  const ph = Number(readings.ph) || 7.2;
  const tds = Number(readings.tds) || 450;
  const turb = Number(readings.turbidity) || 1.2;
  const orp = Number(readings.orp) || 320;
  const fcl = Number(readings.chlorine) || 2.1;
  const do_ = Number(readings.do) || 6.8;
  const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
  const pHs = ph >= 6.5 && ph <= 8.5 ? 100 : ph >= 6 && ph <= 9 ? 70 : ph >= 5.5 && ph <= 9.5 ? 40 : 15;
  const tdss = tds <= 300 ? 100 : tds <= 600 ? 100 - (tds - 300) / 300 * 20 : tds <= 1000 ? 80 - (tds - 600) / 400 * 30 : clamp(50 - (tds - 1000) / 30);
  const turbs = turb <= 1 ? 100 : turb <= 5 ? 100 - (turb - 1) / 4 * 30 : turb <= 10 ? 70 - (turb - 5) / 5 * 40 : clamp(30 - (turb - 10) * 3);
  const orps = orp >= 200 && orp <= 600 ? 100 : orp < 200 ? clamp(orp / 200 * 100) : clamp(100 - (orp - 600) / 10);
  const cls = fcl >= 0.2 && fcl <= 0.5 ? 100 : fcl <= 1 ? 80 : fcl <= 2 ? 50 : 25;
  const dos = do_ >= 6 ? 100 : clamp(do_ / 6 * 100);
  return Math.round((pHs + tdss + turbs + orps + cls + dos) / 6);
}

/**
 * Single Water Score renderer used by both the field app and /r/{token}.
 * publicView only changes chrome (handled by caller); display path is identical.
 */
function renderWaterScore(job, options = {}) {
  const publicView = Boolean(options.publicView);
  const draft = job?.draft || {};
  const readings = publicView
    ? readingsFromJob(job)
    : {
        ph: meterFieldValue('m-ph', 7.2),
        tds: meterFieldValue('m-tds', 450),
        chlorine: meterFieldValue('m-free-cl', 2.1),
        turbidity: meterFieldValue('m-turb', 1.2),
        orp: meterFieldValue('m-orp', 320),
        do: meterFieldValue('m-do', 6.8),
        temp: meterFieldValue('m-temp', 28)
      };

  const published = Number(job?.result?.waterScore ?? draft.scoreVal);
  const wq = publicView && Number.isFinite(published)
    ? Math.max(0, Math.min(100, Math.round(published)))
    : computeScoreFromReadings(readings);

  const taps = draft.taps?.length
    ? [...draft.taps]
    : (S.taps?.length ? [...S.taps] : ['Kitchen', 'Master bath', 'Shower', 'Laundry', 'Guest']);

  if (job) S.activeJob = job;
  S.scoreVal = wq;
  S.scoreBaseReadings = readings;
  S.taps = taps;
  S.scoreTapFilter = taps.length > 1 ? (S.scoreTapFilter || 'all') : taps[0];
  S.publicScoreView = publicView;

  renderScoreDisplay(wq, readings);
  return wq;
}

function calcAndShowScore() {
  renderWaterScore(S.activeJob, { publicView: false });
}

function renderPublishedScore(job) {
  return renderWaterScore(job, { publicView: true });
}

function scoreTapRows(key) {
  const base = S.scoreBaseReadings || { ph: 7.2, tds: 450, chlorine: 2.1, turbidity: 1.2, orp: 320, do: 6.8, temp: 28 };
  const taps = S.taps?.length ? S.taps : ['Tap 1'];
  const rowsFor = index => {
    const delta = index - Math.floor(taps.length / 2);
    return [
      { p: 'pH', r: (base.ph + delta * 0.08).toFixed(1), std: '6.5 - 8.5', st: 'good' },
      { p: 'TDS', r: Math.round(base.tds + delta * 18) + ' mg/L', std: '<= 500 mg/L', st: base.tds + delta * 18 <= 500 ? 'good' : 'intl' },
      { p: 'Chlorine', r: Math.max(0, base.chlorine + delta * 0.12).toFixed(1) + ' mg/L', std: '<= 0.5 mg/L', st: base.chlorine + delta * 0.12 <= 0.5 ? 'good' : 'attn' },
      { p: 'Turbidity', r: Math.max(0.1, base.turbidity + delta * 0.1).toFixed(1) + ' NTU', std: '<= 1 NTU', st: base.turbidity + delta * 0.1 <= 1 ? 'good' : 'intl' },
      { p: 'ORP', r: Math.round(base.orp + delta * 9) + ' mV', std: '> 200 mV', st: 'good' },
      { p: 'DO', r: Math.max(0, base.do - delta * 0.08).toFixed(1) + ' mg/L', std: '> 6 mg/L', st: 'good' },
      { p: 'Temp', r: Math.max(0, base.temp + delta * 0.2).toFixed(1) + '°C', std: '<= 30°C', st: 'good' }
    ];
  };

  if (key !== 'all') return rowsFor(Math.max(0, taps.indexOf(key)));

  const all = taps.map((_, i) => rowsFor(i));
  return all[0].map((row, rowIndex) => {
    const values = all.map(rows => parseFloat(rows[rowIndex].r));
    const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
    const unit = row.r.replace(/^[\d.]+\s?/, '');
    const precision = row.p === 'pH' || row.p === 'Chlorine' || row.p === 'Turbidity' || row.p === 'DO' || row.p === 'Temp' ? 1 : 0;
    const display = precision ? avg.toFixed(1) : Math.round(avg);
    const st = all.some(rows => rows[rowIndex].st === 'attn') ? 'attn' : all.some(rows => rows[rowIndex].st === 'intl') ? 'intl' : 'good';
    return { ...row, r: `${display}${unit ? ' ' + unit.trim() : ''}`, st };
  });
}

function renderScoreReadings() {
  const taps = S.taps?.length ? S.taps : ['Tap 1'];
  const hasMultipleTaps = taps.length > 1;
  if (!hasMultipleTaps) S.scoreTapFilter = taps[0];
  if (!S.scoreTapFilter) S.scoreTapFilter = hasMultipleTaps ? 'all' : taps[0];

  const listEl = document.getElementById('score-readings-rows');
  const scopeEl = document.getElementById('score-params-scope');
  if (!listEl) return;

  if (scopeEl) {
    scopeEl.textContent = S.scoreTapFilter === 'all'
      ? t('score.paramsOverall')
      : `${t('score.viewingRoom')}: ${S.scoreTapFilter}`;
  }

  const rows = scoreTapRows(S.scoreTapFilter);
  const openIndex = Number.isInteger(S.scoreParamOpen) ? S.scoreParamOpen : -1;
  const statusLabels = {
    good: t('score.status.good'),
    attn: t('score.status.attn')
  };

  listEl.innerHTML = rows.map((r, index) => {
    const open = openIndex === index;
    const statusKey = r.st === 'attn' ? 'attn' : 'good';
    const statusLabel = statusLabels[statusKey];
    const detail = paramMeaningText(r.p, statusKey);
    return `<div class="score-metric${open ? ' is-open' : ''} is-${statusKey}">
  <button type="button" class="score-metric-head" onclick="toggleScoreParam(${index})" aria-expanded="${open ? 'true' : 'false'}">
    <span class="score-metric-name">${r.p}</span>
    <span class="score-metric-right">
      <span class="score-metric-value">${r.r}</span>
      <span class="score-metric-status">${statusLabel}</span>
    </span>
  </button>
  <div class="score-metric-body"${open ? '' : ' hidden'}>
    <div class="score-metric-detail">
      <span>${t('score.currentValue')}</span>
      <strong>${r.r}</strong>
    </div>
    <div class="score-metric-detail">
      <span>${t('score.recommended')}</span>
      <strong>${r.std}</strong>
    </div>
    <p class="score-metric-meaning">${detail}</p>
  </div>
</div>`;
  }).join('');
}

function renderRoomAnalysis() {
  const section = document.getElementById('score-rooms-section');
  const listEl = document.getElementById('score-room-list');
  const taps = S.taps?.length ? S.taps : [];
  if (!section || !listEl) return;

  if (taps.length <= 1) {
    section.classList.add('hidden');
    listEl.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');
  const rows = [
    { key: 'all', label: t('score.paramsOverall') },
    ...taps.map(tap => ({ key: tap, label: tap }))
  ];

  listEl.innerHTML = rows.map(row => {
    const active = S.scoreTapFilter === row.key;
    return `<button type="button" class="score-room-row${active ? ' is-active' : ''}" onclick="setScoreTapFilter('${row.key}')">
  <span class="score-room-name">${row.label}</span>
  <span class="score-room-chevron" aria-hidden="true">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
  </span>
</button>`;
  }).join('');
}

function toggleScoreParam(index) {
  S.scoreParamOpen = S.scoreParamOpen === index ? null : index;
  renderScoreReadings();
}

function setScoreTapFilter(key) {
  S.scoreTapFilter = key;
  S.scoreParamOpen = null;
  renderScoreReadings();
  renderRoomAnalysis();
  document.getElementById('score-readings-rows')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

let sharingScore = false;

async function shareScore() {
  if (sharingScore) return;

  if (S.publicScoreView) {
    if (typeof sharePublicReport === 'function') return sharePublicReport();
  }

  const job = S.activeJob;
  const caseRef = job?.notionId || job?.id;
  if (!caseRef || !Number.isFinite(Number(S.scoreVal))) {
    showToast('Please calculate the Water Score first');
    return;
  }

  sharingScore = true;
  saveActiveJobState();
  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseRef)}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: Number(S.scoreVal) })
    });
    const result = await response.json();
    if (!response.ok || !result.reportUrl) throw new Error(result.error || 'Could not publish score');

    job.result = { ...(job.result || {}), waterScore: result.score, reportUrl: result.reportUrl, publicReportToken: result.reportToken };
    const shareData = {
      title: 'Water Motion - Water Score',
      text: `ผล Water Score ของคุณ: ${result.score}/100`,
      url: result.reportUrl
    };
    if (navigator.share) {
      await navigator.share(shareData);
      showToast('Score shared');
      return;
    }
    await navigator.clipboard.writeText(result.reportUrl);
    showToast('Score link copied - share with client');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('Share Score failed', error);
    showToast('Could not share score');
  } finally {
    sharingScore = false;
  }
}

function completeScore() {
  S.stepsDone.score = true;
  saveActiveJobState();
  renderJobSteps();
  goScreen('s-job');
}
