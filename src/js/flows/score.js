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

/**
 * Drinking-water limit sets for Standard Comparison simulation.
 * WHO mirrors the production DWQI formula in computeScoreFromReadings().
 * Other keys are comparison-only and must never overwrite saved waterScore.
 */
const WATER_QUALITY_STANDARDS = Object.freeze({
  who: Object.freeze({
    key: 'who',
    labelKey: 'score.refStandard.who',
    shortKey: 'score.refStandard.short.who',
    display: Object.freeze({
      ph: '6.5 - 8.5',
      tds: '<= 500 mg/L',
      chlorine: '0.2 - 0.5 mg/L',
      turbidity: '<= 1 NTU',
      orp: '200 - 600 mV',
      do: '>= 6 mg/L',
      temp: '<= 30°C'
    }),
    limits: Object.freeze({
      ph: { min: 6.5, max: 8.5, fairMin: 6, fairMax: 9, poorMin: 5.5, poorMax: 9.5 },
      tds: { ideal: 300, fair: 600, poor: 1000, displayMax: 500 },
      chlorine: { idealMin: 0.2, idealMax: 0.5, fair: 1, poor: 2 },
      turbidity: { ideal: 1, fair: 5, poor: 10 },
      orp: { min: 200, max: 600 },
      do: { min: 6 },
      temp: { max: 30 }
    })
  }),
  thailand: Object.freeze({
    key: 'thailand',
    labelKey: 'score.refStandard.thailand',
    shortKey: 'score.refStandard.short.thailand',
    display: Object.freeze({
      ph: '6.5 - 8.5',
      tds: '<= 1000 mg/L',
      chlorine: '0.2 - 2.5 mg/L',
      turbidity: '<= 5 NTU',
      orp: '200 - 600 mV',
      do: '>= 5 mg/L',
      temp: '<= 30°C'
    }),
    limits: Object.freeze({
      ph: { min: 6.5, max: 8.5, fairMin: 6, fairMax: 9, poorMin: 5.5, poorMax: 9.5 },
      tds: { ideal: 500, fair: 1000, poor: 1500, displayMax: 1000 },
      chlorine: { idealMin: 0.2, idealMax: 2.5, fair: 3, poor: 4 },
      turbidity: { ideal: 5, fair: 8, poor: 12 },
      orp: { min: 200, max: 600 },
      do: { min: 5 },
      temp: { max: 30 }
    })
  }),
  eu: Object.freeze({
    key: 'eu',
    labelKey: 'score.refStandard.eu',
    shortKey: 'score.refStandard.short.eu',
    display: Object.freeze({
      ph: '6.5 - 9.5',
      tds: '<= 500 mg/L',
      chlorine: '<= 0.5 mg/L',
      turbidity: '<= 1 NTU',
      orp: '200 - 600 mV',
      do: '>= 6 mg/L',
      temp: '<= 25°C'
    }),
    limits: Object.freeze({
      ph: { min: 6.5, max: 9.5, fairMin: 6, fairMax: 10, poorMin: 5.5, poorMax: 10.5 },
      tds: { ideal: 300, fair: 500, poor: 1000, displayMax: 500 },
      chlorine: { idealMin: 0.1, idealMax: 0.5, fair: 0.8, poor: 1.5 },
      turbidity: { ideal: 1, fair: 4, poor: 8 },
      orp: { min: 200, max: 600 },
      do: { min: 6 },
      temp: { max: 25 }
    })
  }),
  usEpa: Object.freeze({
    key: 'usEpa',
    labelKey: 'score.refStandard.usEpa',
    shortKey: 'score.refStandard.short.usEpa',
    display: Object.freeze({
      ph: '6.5 - 8.5',
      tds: '<= 500 mg/L',
      chlorine: '<= 4 mg/L',
      turbidity: '<= 1 NTU',
      orp: '200 - 600 mV',
      do: '>= 6 mg/L',
      temp: '<= 30°C'
    }),
    limits: Object.freeze({
      ph: { min: 6.5, max: 8.5, fairMin: 6, fairMax: 9, poorMin: 5.5, poorMax: 9.5 },
      tds: { ideal: 300, fair: 500, poor: 1000, displayMax: 500 },
      chlorine: { idealMin: 0.2, idealMax: 4, fair: 4, poor: 5 },
      turbidity: { ideal: 1, fair: 5, poor: 10 },
      orp: { min: 200, max: 600 },
      do: { min: 6 },
      temp: { max: 30 }
    })
  }),
  japan: Object.freeze({
    key: 'japan',
    labelKey: 'score.refStandard.japan',
    shortKey: 'score.refStandard.short.japan',
    display: Object.freeze({
      ph: '5.8 - 8.6',
      tds: '<= 500 mg/L',
      chlorine: '<= 1 mg/L',
      turbidity: '<= 2 NTU',
      orp: '200 - 600 mV',
      do: '>= 5 mg/L',
      temp: '<= 30°C'
    }),
    limits: Object.freeze({
      ph: { min: 5.8, max: 8.6, fairMin: 5.5, fairMax: 9, poorMin: 5, poorMax: 9.5 },
      tds: { ideal: 300, fair: 500, poor: 1000, displayMax: 500 },
      chlorine: { idealMin: 0.1, idealMax: 1, fair: 1.5, poor: 2 },
      turbidity: { ideal: 2, fair: 5, poor: 10 },
      orp: { min: 200, max: 600 },
      do: { min: 5 },
      temp: { max: 30 }
    })
  })
});

const SCORE_STANDARD_ORDER = Object.freeze(['thailand', 'who', 'eu', 'usEpa', 'japan']);
/** UI comparison default — Thai product audience. Production/share score stays WHO. */
const DEFAULT_SCORE_STANDARD_KEY = 'thailand';

function getWaterQualityStandard(standardKey) {
  return WATER_QUALITY_STANDARDS[standardKey] || WATER_QUALITY_STANDARDS[DEFAULT_SCORE_STANDARD_KEY];
}

function clampScore(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function scorePhAgainstLimits(ph, lim) {
  if (ph >= lim.min && ph <= lim.max) return 100;
  if (ph >= lim.fairMin && ph <= lim.fairMax) return 70;
  if (ph >= lim.poorMin && ph <= lim.poorMax) return 40;
  return 15;
}

function scoreTdsAgainstLimits(tds, lim) {
  if (tds <= lim.ideal) return 100;
  if (tds <= lim.fair) return 100 - (tds - lim.ideal) / (lim.fair - lim.ideal) * 20;
  if (tds <= lim.poor) return 80 - (tds - lim.fair) / (lim.poor - lim.fair) * 30;
  return clampScore(50 - (tds - lim.poor) / 30);
}

function scoreTurbidityAgainstLimits(turb, lim) {
  if (turb <= lim.ideal) return 100;
  if (turb <= lim.fair) return 100 - (turb - lim.ideal) / (lim.fair - lim.ideal) * 30;
  if (turb <= lim.poor) return 70 - (turb - lim.fair) / (lim.poor - lim.fair) * 40;
  return clampScore(30 - (turb - lim.poor) * 3);
}

function scoreOrpAgainstLimits(orp, lim) {
  if (orp >= lim.min && orp <= lim.max) return 100;
  if (orp < lim.min) return clampScore(orp / lim.min * 100);
  return clampScore(100 - (orp - lim.max) / 10);
}

function scoreChlorineAgainstLimits(fcl, lim) {
  // WHO production ladder: ideal band → fair → poor → critical (low residual uses fair tier).
  if (fcl >= lim.idealMin && fcl <= lim.idealMax) return 100;
  if (fcl <= lim.fair) return 80;
  if (fcl <= lim.poor) return 50;
  return 25;
}

function scoreDoAgainstLimits(doValue, lim) {
  if (doValue >= lim.min) return 100;
  return clampScore(doValue / lim.min * 100);
}

/** Parameter sub-scores + weighted overall for a selected standard. */
function computeParamScoresForStandard(readings, standardKey = DEFAULT_SCORE_STANDARD_KEY) {
  const lim = getWaterQualityStandard(standardKey).limits;
  const ph = Number(readings.ph) || 7.2;
  const tds = Number(readings.tds) || 450;
  const turb = Number(readings.turbidity) || 1.2;
  const orp = Number(readings.orp) || 320;
  const fcl = Number(readings.chlorine) || 2.1;
  const do_ = Number(readings.do) || 6.8;
  const params = {
    ph: scorePhAgainstLimits(ph, lim.ph),
    tds: scoreTdsAgainstLimits(tds, lim.tds),
    turbidity: scoreTurbidityAgainstLimits(turb, lim.turbidity),
    orp: scoreOrpAgainstLimits(orp, lim.orp),
    chlorine: scoreChlorineAgainstLimits(fcl, lim.chlorine),
    do: scoreDoAgainstLimits(do_, lim.do)
  };
  const score = Math.round((params.ph + params.tds + params.turbidity + params.orp + params.chlorine + params.do) / 6);
  return { score, params };
}

function evaluateParamStatus(paramName, value, standardKey = DEFAULT_SCORE_STANDARD_KEY) {
  const lim = getWaterQualityStandard(standardKey).limits;
  const key = paramKey(paramName);
  const n = Number(value);
  if (!Number.isFinite(n)) return 'good';

  // Status is Good only when inside the selected standard's recommended range.
  // Outside that band → Attention (drives Thailand vs WHO/EU differences in the UI).
  if (key === 'ph') {
    return n >= lim.ph.min && n <= lim.ph.max ? 'good' : 'attn';
  }
  if (key === 'tds') {
    return n <= lim.tds.displayMax ? 'good' : 'attn';
  }
  if (key === 'chlorine') {
    return n >= lim.chlorine.idealMin && n <= lim.chlorine.idealMax ? 'good' : 'attn';
  }
  if (key === 'turbidity') {
    return n <= lim.turbidity.ideal ? 'good' : 'attn';
  }
  if (key === 'orp') {
    return n >= lim.orp.min && n <= lim.orp.max ? 'good' : 'attn';
  }
  if (key === 'do') {
    return n >= lim.do.min ? 'good' : 'attn';
  }
  if (key === 'temp') {
    return n <= lim.temp.max ? 'good' : 'attn';
  }
  return 'good';
}

function buildScoreFindings(readings, standardKey = DEFAULT_SCORE_STANDARD_KEY) {
  const lim = getWaterQualityStandard(standardKey).limits;
  const ph = Number(readings.ph);
  const fcl = Number(readings.chlorine);
  const turb = Number(readings.turbidity);
  const tds = Number(readings.tds);
  const findings = [];
  if (Number.isFinite(fcl) && fcl > lim.chlorine.idealMax) {
    findings.push({ label: t('score.concern.highChlorine'), val: fcl + ' mg/L', note: t('score.note.highChlorine') });
  }
  if (Number.isFinite(turb) && turb > lim.turbidity.fair) {
    findings.push({ label: t('score.concern.highTurbidity'), val: turb + ' NTU', note: t('score.note.highTurbidity') });
  }
  if (Number.isFinite(fcl) && fcl < lim.chlorine.idealMin) {
    findings.push({ label: t('score.concern.lowChlorine'), val: fcl + ' mg/L', note: t('score.note.lowChlorine') });
  }
  if (Number.isFinite(ph) && (ph < lim.ph.min || ph > lim.ph.max)) {
    findings.push({ label: t('score.concern.phRange'), val: String(ph), note: t('score.note.phRange') });
  }
  if (Number.isFinite(tds) && tds > lim.tds.fair) {
    findings.push({ label: t('score.concern.highTds'), val: tds + ' mg/L', note: t('score.note.highTds') });
  }
  return findings;
}

/** Comparison-only result. Never write this to job.result / API. */
function buildComparisonScoreResult(readings, standardKey = DEFAULT_SCORE_STANDARD_KEY) {
  const key = WATER_QUALITY_STANDARDS[standardKey] ? standardKey : DEFAULT_SCORE_STANDARD_KEY;
  const standard = getWaterQualityStandard(key);
  const scored = computeParamScoresForStandard(readings, key);
  // Always recalculate display score from the selected standard (simulation only).
  // Production/share score stays on S.scoreVal / currentScoreResult.
  return {
    standardKey: key,
    standard,
    readings: { ...readings },
    score: scored.score,
    paramScores: scored.params,
    findings: buildScoreFindings(readings, key),
    verdict: customerVerdict(scored.score)
  };
}

/**
 * Single evaluation context for the whole report view.
 * Room Analysis + Parameter Analysis must both use this — never hardcoded limits.
 */
function getScoreEvalContext(result = activeComparisonResult()) {
  const standardKey = result?.standardKey
    || (WATER_QUALITY_STANDARDS[S.scoreStandardKey] ? S.scoreStandardKey : DEFAULT_SCORE_STANDARD_KEY);
  const standard = result?.standard || getWaterQualityStandard(standardKey);
  const readings = result?.readings || S.scoreBaseReadings || S.currentScoreResult?.readings || {};
  return {
    selectedStandard: standardKey,
    standard,
    standardLimits: standard.limits,
    display: standard.display,
    readings
  };
}

/** UI status: only values inside the selected standard's recommended band are Good. */
function paramStatusUiKey(status) {
  return status === 'good' ? 'good' : 'attn';
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
  const fill = document.getElementById('score-progress-fill');
  const score = Math.max(0, Math.min(100, Number(wq) || 0));
  if (bar) bar.setAttribute('aria-label', `Water Score ${Math.round(score)} of 100`);
  if (fill) fill.style.width = `${score}%`;
}

function activeComparisonResult() {
  return S.comparisonScoreResult || null;
}

function activeStandardKey() {
  return activeComparisonResult()?.standardKey || S.scoreStandardKey || DEFAULT_SCORE_STANDARD_KEY;
}

function renderStandardSwitcher(context = getScoreEvalContext()) {
  const listEl = document.getElementById('score-standard-switch');
  if (!listEl) return;
  const selected = context.selectedStandard;
  listEl.replaceChildren();
  SCORE_STANDARD_ORDER.forEach(key => {
    const standard = getWaterQualityStandard(key);
    const active = selected === key;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `score-standard-chip${active ? ' is-active' : ''}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.dataset.standardKey = key;
    btn.textContent = t(standard.shortKey);
    btn.addEventListener('click', () => setScoreReferenceStandard(key));
    listEl.appendChild(btn);
  });
}

function renderAboutForStandard(standardKey) {
  const aboutP1 = document.getElementById('score-about-p1');
  const thaiTitle = document.getElementById('score-about-thai-title');
  const aboutP2 = document.getElementById('score-about-p2');
  const aboutP3 = document.getElementById('score-about-p3');
  const compareNote = document.getElementById('score-about-compare');
  const key = WATER_QUALITY_STANDARDS[standardKey] ? standardKey : DEFAULT_SCORE_STANDARD_KEY;

  if (aboutP1) aboutP1.textContent = t(`score.about.${key}.p1`);
  if (compareNote) {
    compareNote.textContent = t('score.about.compareNote');
    // Primary view is Thailand — note appears when comparing other standards.
    compareNote.hidden = key === DEFAULT_SCORE_STANDARD_KEY;
  }
  const showThaiDiff = key === 'who';
  if (thaiTitle) {
    thaiTitle.textContent = t('score.thaiDiffTitle');
    thaiTitle.hidden = !showThaiDiff;
  }
  if (aboutP2) {
    aboutP2.textContent = t('score.aboutP2');
    aboutP2.hidden = !showThaiDiff;
  }
  if (aboutP3) aboutP3.textContent = t(showThaiDiff ? 'score.aboutP3' : `score.about.${key}.p2`);
}

/**
 * Renders the on-screen report from comparisonScoreResult.
 * Does not mutate S.scoreVal / currentScoreResult / backend values.
 */
function renderScoreDisplay() {
  const result = activeComparisonResult();
  if (!result) return;

  const context = getScoreEvalContext(result);
  // Summary number comes from computeScoreFromReadings (fresh), never a cached draft.scoreVal.
  // Selected standard still drives parameter status, recommended ranges, and findings.
  const computedWho = Number(S.currentScoreResult?.computedScore);
  const comparisonScore = Number(result.score);
  const wq = Number.isFinite(computedWho) ? computedWho : comparisonScore;
  console.log('RENDER SCORE DISPLAY', {
    score: wq,
    computedWho,
    comparisonScore,
    standard: result.standardKey,
    readings: result.readings
  });
  const findings = result.findings || [];
  const top = findings[0];
  const verdict = customerVerdict(wq);
  const hero = document.getElementById('score-hero');
  const bandEl = document.getElementById('score-summary-band');
  const noteEl = document.getElementById('score-summary-note');
  const standardEl = document.getElementById('score-standard-label');

  if (hero) {
    hero.className = 'score-report score-live';
    hero.dataset.tier = wq >= 80 ? 'high' : wq >= 65 ? 'mid' : 'low';
  }
  const summaryCard = hero?.querySelector('.score-summary-card');
  if (summaryCard) {
    summaryCard.style.setProperty('--score-accent', verdict.color);
  }
  if (standardEl) {
    standardEl.textContent = t(context.standard.labelKey);
  }
  if (bandEl) {
    bandEl.textContent = verdict.label;
    bandEl.style.color = '';
  }
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
  S.scoreParamOpen = null;
  if (!S.scoreTapFilter) {
    S.scoreTapFilter = (S.taps?.length || 0) > 1 ? 'all' : (S.taps?.[0] || 'all');
  }
  animateScoreNumber(document.getElementById('gauge-val'), wq);
  renderStandardSwitcher(context);
  renderAboutForStandard(context.selectedStandard);
  renderScoreReadings(context);
  renderRoomAnalysis(context);
}

/** Switch comparison standard — recalculates statuses from the same resolved readings. */
function setScoreReferenceStandard(standardKey) {
  const key = WATER_QUALITY_STANDARDS[standardKey] ? standardKey : DEFAULT_SCORE_STANDARD_KEY;
  const readings = resolveScoreReadings(S.activeJob);
  const computedScore = computeScoreFromReadings(readings);

  S.scoreStandardKey = key;
  S.scoreBaseReadings = readings;
  S.scoreVal = computedScore;
  S.currentScoreResult = {
    ...(S.currentScoreResult || {}),
    score: computedScore,
    computedScore,
    readings: { ...readings },
    source: 'computed'
  };
  S.comparisonScoreResult = buildComparisonScoreResult(readings, key);
  S.scoreParamOpen = null;
  console.log('STANDARD SWITCH', {
    key,
    readings,
    computedWho: computedScore,
    comparisonScore: S.comparisonScoreResult.score
  });
  renderScoreDisplay();
}

function meterFieldValue(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const value = parseFloat(el.value);
  return Number.isFinite(value) ? value : fallback;
}

function numOrUndefined(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Map draft/DOM field ids → scoring keys expected by computeScoreFromReadings. */
function readingsFromFieldMap(fields = {}) {
  return {
    ph: numOrUndefined(fields['m-ph'] ?? fields.ph),
    tds: numOrUndefined(fields['m-tds'] ?? fields.tds),
    chlorine: numOrUndefined(fields['m-free-cl'] ?? fields.freeChlorine ?? fields.chlorine),
    turbidity: numOrUndefined(fields['m-turb'] ?? fields.turbidity),
    orp: numOrUndefined(fields['m-orp'] ?? fields.orp),
    do: numOrUndefined(fields['m-do'] ?? fields.do),
    temp: numOrUndefined(fields['m-temp'] ?? fields.temp)
  };
}

function readingsFromDomFields() {
  return {
    ph: numOrUndefined(document.getElementById('m-ph')?.value),
    tds: numOrUndefined(document.getElementById('m-tds')?.value),
    chlorine: numOrUndefined(document.getElementById('m-free-cl')?.value),
    turbidity: numOrUndefined(document.getElementById('m-turb')?.value),
    orp: numOrUndefined(document.getElementById('m-orp')?.value),
    do: numOrUndefined(document.getElementById('m-do')?.value),
    temp: numOrUndefined(document.getElementById('m-temp')?.value)
  };
}

/**
 * Prefer Layer 2 standardMeasurement stored on tapData; fall back to legacy
 * meterReadings/chlorineReadings per-key when standardMeasurement is absent.
 * Maps freeChlorine → chlorine for the scorer (legacy path only).
 */
function readingsFromTapData(tapData) {
  const taps = Array.isArray(tapData) ? tapData : [];
  const standardRows = taps
    .map(tap => tap?.standardMeasurement)
    .filter(row => row && typeof row === 'object' && Object.keys(row).length);
  const meterRows = taps.map(tap => tap?.meterReadings).filter(Boolean);
  const chlorineRows = taps.map(tap => tap?.chlorineReadings).filter(Boolean);
  if (!standardRows.length && !meterRows.length && !chlorineRows.length) return {};

  const avgKey = (rows, key) => {
    const vals = rows.map(row => numOrUndefined(row[key])).filter(v => v !== undefined);
    if (!vals.length) return undefined;
    return vals.reduce((sum, n) => sum + n, 0) / vals.length;
  };

  return {
    ph: avgKey(standardRows, 'ph') ?? avgKey(meterRows, 'ph'),
    tds: avgKey(standardRows, 'tds') ?? avgKey(meterRows, 'tds'),
    turbidity: avgKey(standardRows, 'turbidity') ?? avgKey(meterRows, 'turbidity'),
    orp: avgKey(standardRows, 'orp') ?? avgKey(meterRows, 'orp'),
    do: avgKey(standardRows, 'do') ?? avgKey(meterRows, 'do'),
    temp: avgKey(standardRows, 'temp') ?? avgKey(meterRows, 'temp'),
    chlorine: avgKey(standardRows, 'chlorine') ?? avgKey(chlorineRows, 'freeChlorine') ?? avgKey(chlorineRows, 'chlorine')
  };
}

function mergeReadingLayers(...layers) {
  const keys = ['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp'];
  const out = {};
  keys.forEach(key => {
    for (const layer of layers) {
      if (layer && layer[key] !== undefined && layer[key] !== null && layer[key] !== '') {
        const n = numOrUndefined(layer[key]);
        if (n !== undefined) {
          out[key] = n;
          break;
        }
      }
    }
  });
  return out;
}

const SCORE_READING_FALLBACKS = Object.freeze({
  ph: 7.2,
  tds: 450,
  chlorine: 2.1,
  turbidity: 1.2,
  orp: 320,
  do: 6.8,
  temp: 28
});

/**
 * Resolve readings for scoring. Never let a stale scoreBaseReadings cache
 * hide fresher randomized tap/field/DOM values.
 */
function resolveScoreReadings(job) {
  const draft = job?.draft || {};
  const fromTaps = readingsFromTapData(draft.tapData?.length ? draft.tapData : S.tapData);
  const fromFields = readingsFromFieldMap(draft.fields || {});
  const fromDom = readingsFromDomFields();
  // scoreBaseReadings is last-resort fill only (not a wholesale override).
  const fromCache = draft.scoreBaseReadings && typeof draft.scoreBaseReadings === 'object'
    ? { ...draft.scoreBaseReadings }
    : (S.scoreBaseReadings && typeof S.scoreBaseReadings === 'object' ? { ...S.scoreBaseReadings } : {});

  const merged = mergeReadingLayers(fromTaps, fromFields, fromDom, fromCache);
  const readings = { ...SCORE_READING_FALLBACKS, ...merged };

  console.log('INPUT READINGS', {
    readings,
    fromTaps,
    fromFields,
    fromDom,
    fromCache
  });

  return readings;
}

function readingsFromJob(job) {
  return resolveScoreReadings(job);
}

function computeScoreFromReadings(readings) {
  // Production / saved score — original WHO (DWQI) formula. Unchanged for share/API.
  const ph = Number(readings.ph) || 7.2;
  const tds = Number(readings.tds) || 450;
  const turb = Number(readings.turbidity) || 1.2;
  const orp = Number(readings.orp) || 320;
  const fcl = Number(readings.chlorine) || 2.1;
  const do_ = Number(readings.do) || 6.8;
  console.log('PARAMETER VALUES', { ph, tds, turbidity: turb, orp, chlorine: fcl, do: do_ });
  const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
  const pHs = ph >= 6.5 && ph <= 8.5 ? 100 : ph >= 6 && ph <= 9 ? 70 : ph >= 5.5 && ph <= 9.5 ? 40 : 15;
  const tdss = tds <= 300 ? 100 : tds <= 600 ? 100 - (tds - 300) / 300 * 20 : tds <= 1000 ? 80 - (tds - 600) / 400 * 30 : clamp(50 - (tds - 1000) / 30);
  const turbs = turb <= 1 ? 100 : turb <= 5 ? 100 - (turb - 1) / 4 * 30 : turb <= 10 ? 70 - (turb - 5) / 5 * 40 : clamp(30 - (turb - 10) * 3);
  const orps = orp >= 200 && orp <= 600 ? 100 : orp < 200 ? clamp(orp / 200 * 100) : clamp(100 - (orp - 600) / 10);
  const cls = fcl >= 0.2 && fcl <= 0.5 ? 100 : fcl <= 1 ? 80 : fcl <= 2 ? 50 : 25;
  const dos = do_ >= 6 ? 100 : clamp(do_ / 6 * 100);
  const score = Math.round((pHs + tdss + turbs + orps + cls + dos) / 6);
  console.log('FINAL SCORE', score, { pHs, tdss, turbs, orps, cls, dos });
  return score;
}

/**
 * Single Water Score renderer used by both the field app and /r/{token}.
 * publicView only changes chrome (handled by caller); display path is identical.
 *
 * currentScoreResult  → production / published score (share + backend)
 * comparisonScoreResult → selected-standard simulation (UI only)
 */
function renderWaterScore(job, options = {}) {
  const publicView = Boolean(options.publicView);
  const draft = job?.draft || {};
  // Always resolve from tapData / fields / DOM — do not trust stale score-only cache.
  const readings = resolveScoreReadings(job);

  const published = Number(job?.result?.waterScore ?? draft.scoreVal);
  const computedScore = computeScoreFromReadings(readings);
  // Public report may show the published score; field app always uses the fresh calculation.
  const productionScore = publicView && Number.isFinite(published)
    ? Math.max(0, Math.min(100, Math.round(published)))
    : computedScore;

  const taps = draft.taps?.length
    ? [...draft.taps]
    : (S.taps?.length ? [...S.taps] : ['Kitchen', 'Master bath', 'Shower', 'Laundry', 'Guest']);

  if (job) S.activeJob = job;
  // Saved / shareable score stays on the WHO production path.
  S.scoreVal = productionScore;
  S.scoreBaseReadings = readings;
  S.currentScoreResult = {
    score: productionScore,
    standardKey: 'who',
    readings: { ...readings },
    source: publicView && Number.isFinite(published) ? 'published' : 'computed',
    computedScore
  };
  if (!S.scoreStandardKey || !WATER_QUALITY_STANDARDS[S.scoreStandardKey]) {
    S.scoreStandardKey = DEFAULT_SCORE_STANDARD_KEY;
  }
  S.comparisonScoreResult = buildComparisonScoreResult(readings, S.scoreStandardKey);
  console.log('DISPLAY SCORE PATH', {
    productionScore,
    computedScore,
    comparisonScore: S.comparisonScoreResult?.score,
    standard: S.scoreStandardKey,
    published: Number.isFinite(published) ? published : null
  });
  S.taps = taps;
  // Default Room Analysis = All when multiple taps are available.
  S.scoreTapFilter = taps.length > 1 ? 'all' : taps[0];
  S.publicScoreView = publicView;

  renderScoreDisplay();
  return productionScore;
}

function calcAndShowScore() {
  renderWaterScore(S.activeJob, { publicView: Boolean(S.publicScoreView) });
}

function renderPublishedScore(job) {
  return renderWaterScore(job, { publicView: true });
}

function readingsFromBase(base, index, tapCount) {
  // Per-room offsets so Kitchen / Master bath / etc. stay independent values
  // when a tap has no OCR/meter snapshot yet.
  const delta = index - Math.floor(tapCount / 2);
  return {
    ph: Number(base.ph) + delta * 0.22,
    tds: Number(base.tds) + delta * 42,
    chlorine: Math.max(0, Number(base.chlorine) + delta * 0.28),
    turbidity: Math.max(0.1, Number(base.turbidity) + delta * 0.35),
    orp: Number(base.orp) + delta * 18,
    do: Math.max(0, Number(base.do) - delta * 0.18),
    temp: Math.max(0, Number(base.temp) + delta * 0.45)
  };
}

function averageRoomReadings(base, tapCount) {
  const list = Array.from({ length: tapCount }, (_, i) => readingsFromBase(base, i, tapCount));
  const keys = ['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp'];
  const avg = {};
  keys.forEach(key => {
    avg[key] = list.reduce((sum, row) => sum + Number(row[key]), 0) / list.length;
  });
  return avg;
}

function readingsFromSingleTap(tap, fallback) {
  const standard = tap?.standardMeasurement && typeof tap.standardMeasurement === 'object'
    ? tap.standardMeasurement
    : null;
  const meter = tap?.meterReadings || {};
  const chlorine = tap?.chlorineReadings || {};
  const mapped = {
    ph: numOrUndefined(standard?.ph ?? meter.ph),
    tds: numOrUndefined(standard?.tds ?? meter.tds),
    turbidity: numOrUndefined(standard?.turbidity ?? meter.turbidity),
    orp: numOrUndefined(standard?.orp ?? meter.orp),
    do: numOrUndefined(standard?.do ?? meter.do),
    temp: numOrUndefined(standard?.temp ?? meter.temp),
    chlorine: numOrUndefined(standard?.chlorine ?? (chlorine.freeChlorine ?? chlorine.chlorine))
  };
  return { ...fallback, ...Object.fromEntries(Object.entries(mapped).filter(([, v]) => v !== undefined)) };
}

/** True when a tap has any Standard (Layer 2) or legacy reading source. */
function hasTapReadingSource(tap) {
  return Boolean(
    (tap?.standardMeasurement && Object.keys(tap.standardMeasurement).length)
    || tap?.meterReadings
    || tap?.chlorineReadings
  );
}

/** Resolve display readings for one room (or overall average). Does not mutate raw base readings. */
function getRoomReadings(tapKey, context = getScoreEvalContext()) {
  const base = context.readings && Object.keys(context.readings).length
    ? context.readings
    : (S.scoreBaseReadings || { ...SCORE_READING_FALLBACKS });
  const taps = S.taps?.length ? S.taps : ['Tap 1'];
  const tapData = (S.activeJob?.draft?.tapData?.length ? S.activeJob.draft.tapData : S.tapData) || [];

  if (tapKey === 'all') {
    const rows = taps.map((_, i) => {
      const tap = tapData[i];
      if (hasTapReadingSource(tap)) return readingsFromSingleTap(tap, base);
      return readingsFromBase(base, i, taps.length);
    });
    const keys = ['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp'];
    const avg = {};
    keys.forEach(key => {
      avg[key] = rows.reduce((sum, row) => sum + Number(row[key]), 0) / rows.length;
    });
    return avg;
  }

  const index = taps.indexOf(tapKey);
  const safeIndex = index >= 0 ? index : 0;
  const tap = tapData[safeIndex];
  if (hasTapReadingSource(tap)) {
    return readingsFromSingleTap(tap, base);
  }
  return readingsFromBase(base, safeIndex, taps.length);
}

/** Build metric rows for one room using selectedStandard limits — never shared across rooms. */
function buildMetricRowsForReadings(readings, context = getScoreEvalContext()) {
  const standardKey = context.selectedStandard || DEFAULT_SCORE_STANDARD_KEY;
  const display = context.display || getWaterQualityStandard(standardKey).display;
  const ph = Number(readings.ph);
  const tds = Number(readings.tds);
  const chlorine = Number(readings.chlorine);
  const turbidity = Number(readings.turbidity);
  const orp = Number(readings.orp);
  const doVal = Number(readings.do);
  const temp = Number(readings.temp);
  return [
    { p: 'pH', r: ph.toFixed(1), std: display.ph, st: evaluateParamStatus('ph', ph, standardKey) },
    { p: 'TDS', r: Math.round(tds) + ' mg/L', std: display.tds, st: evaluateParamStatus('tds', tds, standardKey) },
    { p: 'Chlorine', r: chlorine.toFixed(1) + ' mg/L', std: display.chlorine, st: evaluateParamStatus('chlorine', chlorine, standardKey) },
    { p: 'Turbidity', r: turbidity.toFixed(1) + ' NTU', std: display.turbidity, st: evaluateParamStatus('turbidity', turbidity, standardKey) },
    { p: 'ORP', r: Math.round(orp) + ' mV', std: display.orp, st: evaluateParamStatus('orp', orp, standardKey) },
    { p: 'DO', r: doVal.toFixed(1) + ' mg/L', std: display.do, st: evaluateParamStatus('do', doVal, standardKey) },
    { p: 'Temp', r: temp.toFixed(1) + '°C', std: display.temp, st: evaluateParamStatus('temp', temp, standardKey) }
  ];
}

function scoreTapRows(key, context = getScoreEvalContext()) {
  return buildMetricRowsForReadings(getRoomReadings(key, context), context);
}

function renderScoreReadings(context = getScoreEvalContext()) {
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

  const rows = scoreTapRows(S.scoreTapFilter, context);
  const openIndex = Number.isInteger(S.scoreParamOpen) ? S.scoreParamOpen : -1;
  const statusLabels = {
    good: t('score.status.good'),
    attn: t('score.status.attn')
  };

  listEl.innerHTML = rows.map((r, index) => {
    const open = openIndex === index;
    const statusKey = paramStatusUiKey(r.st);
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

function renderRoomAnalysis(context = getScoreEvalContext()) {
  const section = document.getElementById('score-rooms-section');
  const listEl = document.getElementById('score-room-list');
  const taps = S.taps?.length ? S.taps : [];
  if (!section || !listEl) return;

  if (taps.length <= 1) {
    section.classList.add('hidden');
    listEl.replaceChildren();
    return;
  }

  section.classList.remove('hidden');
  const rows = [
    { key: 'all', label: `${t('score.roomsAll')} (${taps.length})` },
    ...taps.map(tap => ({ key: tap, label: tap }))
  ];

  listEl.replaceChildren();
  rows.forEach(row => {
    const active = S.scoreTapFilter === row.key;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `score-room-row${active ? ' is-active' : ''}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.dataset.roomKey = row.key;
    btn.dataset.standard = context.selectedStandard;

    const name = document.createElement('span');
    name.className = 'score-room-name';
    name.textContent = row.label;
    btn.appendChild(name);

    btn.addEventListener('click', () => {
      setScoreTapFilter(row.key);
    });

    listEl.appendChild(btn);
  });
}

function toggleScoreParam(index) {
  S.scoreParamOpen = S.scoreParamOpen === index ? null : index;
  renderScoreReadings(getScoreEvalContext());
}

function setScoreTapFilter(key) {
  const context = getScoreEvalContext();
  S.scoreTapFilter = key;
  S.scoreParamOpen = null;
  renderScoreReadings(context);
  renderRoomAnalysis(context);
  document.getElementById('score-readings-rows')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
