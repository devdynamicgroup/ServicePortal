function getScoreStyle(wq) {
  if (wq >= 90) return { band: t('score.band.exceptional'), pill: '#5b8def', pillText: '#fff', arc: '#5b8def', glow: 'rgba(91,141,239,.35)' };
  if (wq >= 80) return { band: t('score.band.international'), pill: '#2e9b6f', pillText: '#0c0a09', arc: '#2e9b6f', glow: 'rgba(46,155,111,.4)' };
  if (wq >= 65) return { band: t('score.band.good'), pill: '#d9a441', pillText: '#0c0a09', arc: '#d9a441', glow: 'rgba(217,164,65,.35)' };
  if (wq >= 50) return { band: t('score.band.fair'), pill: '#c48a3a', pillText: '#0c0a09', arc: '#c48a3a', glow: 'rgba(196,138,58,.35)' };
  return { band: t('score.band.attention'), pill: '#f07b7b', pillText: '#0c0a09', arc: '#f07b7b', glow: 'rgba(240,123,123,.35)' };
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
  if (fcl > 0.5) findings.push({ label: 'High chlorine', val: fcl + ' mg/L' });
  if (turb > 5) findings.push({ label: 'High turbidity', val: turb + ' NTU' });
  if (fcl < 0.2) findings.push({ label: 'Low chlorine', val: fcl + ' mg/L' });
  if (ph < 6.5 || ph > 8.5) findings.push({ label: 'pH out of range', val: ph });
  if (tds > 600) findings.push({ label: 'High TDS', val: tds + ' mg/L' });
  return findings;
}

function paramImpactText(paramName) {
  const key = String(paramName || '').toLowerCase();
  if (key === 'ph') return t('score.impact.ph');
  if (key === 'tds') return t('score.impact.tds');
  if (key === 'chlorine') return t('score.impact.chlorine');
  if (key === 'turbidity') return t('score.impact.turbidity');
  if (key === 'orp') return t('score.impact.orp');
  if (key === 'do') return t('score.impact.do');
  if (key === 'temp') return t('score.impact.temp');
  return t('score.impact.default');
}

function renderScoreSegments(wq) {
  const filled = Math.max(0, Math.min(10, Math.round((Number(wq) || 0) / 10)));
  return Array.from({ length: 10 }, (_, i) =>
    `<span class="score-seg${i < filled ? ' is-on' : ''}"></span>`
  ).join('');
}

function renderScoreDisplay(wq, readings) {
  const style = getScoreStyle(wq);
  const hero = document.getElementById('score-hero');
  const bandEl = document.getElementById('score-summary-band');
  const findingEl = document.getElementById('score-summary-finding');
  const noteEl = document.getElementById('score-summary-note');
  const segmentsEl = document.getElementById('score-summary-segments');
  const findings = buildScoreFindings(readings);
  const mainFinding = findings[0]?.label || t('score.finding.allOk');
  const note = wq >= 50 ? t('score.msg.sub') : t('score.msg.subShort');

  if (hero) {
    hero.className = 'score-hero score-live';
    hero.dataset.tier = wq >= 80 ? 'high' : wq >= 50 ? 'mid' : 'low';
  }
  if (bandEl) {
    bandEl.textContent = style.band;
    bandEl.style.color = style.arc;
  }
  if (findingEl) findingEl.textContent = mainFinding;
  if (noteEl) noteEl.textContent = note;
  if (segmentsEl) segmentsEl.innerHTML = renderScoreSegments(wq);

  S.scoreParamOpen = null;
  animateScoreNumber(document.getElementById('gauge-val'), wq);
  renderScoreReadings();
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
  if (!hasMultipleTaps && S.scoreTapFilter === 'all') S.scoreTapFilter = taps[0];
  if (!S.scoreTapFilter) S.scoreTapFilter = hasMultipleTaps ? 'all' : taps[0];

  const tabs = hasMultipleTaps
    ? [{ label: `${t('score.allTaps')} (${taps.length})`, key: 'all' }, ...taps.map(tap => ({ label: tap, key: tap }))]
    : taps.map(tap => ({ label: tap, key: tap }));
  const tabBar = document.getElementById('score-tap-tabs');
  const listEl = document.getElementById('score-readings-rows');
  if (!tabBar || !listEl) return;

  tabBar.innerHTML = tabs.map(tab =>
    `<button type="button" class="readings-tab${S.scoreTapFilter === tab.key ? ' active' : ''}" onclick="setScoreTapFilter('${tab.key}')">${tab.label}</button>`
  ).join('');

  const labels = { good: t('score.status.good'), attn: t('score.status.attn'), intl: t('score.status.intl') };
  const rows = scoreTapRows(S.scoreTapFilter);
  const openIndex = Number.isInteger(S.scoreParamOpen) ? S.scoreParamOpen : -1;

  listEl.innerHTML = rows.map((r, index) => {
    const open = openIndex === index;
    const statusLabel = labels[r.st] || labels.good;
    return `<div class="score-param-item${open ? ' is-open' : ''} score-reveal" style="animation-delay:${80 + index * 40}ms">
  <button type="button" class="score-param-head" onclick="toggleScoreParam(${index})" aria-expanded="${open ? 'true' : 'false'}">
    <div class="score-param-main">
      <div class="score-param-name">${r.p}</div>
      <div class="score-param-value">${r.r}</div>
      <div class="score-param-status"><span class="score-param-badge ${r.st}">${statusLabel}</span></div>
    </div>
    <span class="score-param-chevron" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
    </span>
  </button>
  <div class="score-param-body"${open ? '' : ' hidden'}>
    <div class="score-param-divider" aria-hidden="true"></div>
    <div class="score-param-detail">
      <span>${t('score.standard')}</span>
      <strong>${r.std}</strong>
    </div>
    <div class="score-param-detail">
      <span>${t('score.impact')}</span>
      <strong>${paramImpactText(r.p)}</strong>
    </div>
    <div class="score-param-detail">
      <span>${t('score.status')}</span>
      <strong class="score-param-badge ${r.st}">${statusLabel}</strong>
    </div>
  </div>
</div>`;
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
