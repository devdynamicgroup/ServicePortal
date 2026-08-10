function getScoreStyle(wq) {
  if (wq >= 90) return { band: t('score.band.exceptional'), pill: '#5b8def', pillText: '#fff', arc: '#5b8def', glow: 'rgba(91,141,239,.35)' };
  if (wq >= 80) return { band: t('score.band.international'), pill: '#2e9b6f', pillText: '#0c0a09', arc: '#2e9b6f', glow: 'rgba(46,155,111,.4)' };
  if (wq >= 60) return { band: t('score.band.good'), pill: '#d9a441', pillText: '#0c0a09', arc: '#d9a441', glow: 'rgba(217,164,65,.35)' };
  if (wq >= 50) return { band: t('score.band.fair'), pill: '#c48a3a', pillText: '#0c0a09', arc: '#c48a3a', glow: 'rgba(196,138,58,.35)' };
  return { band: t('score.band.attention'), pill: '#f07b7b', pillText: '#0c0a09', arc: '#f07b7b', glow: 'rgba(240,123,123,.35)' };
}

/** Customer-facing verdict shown on the summary card (not the DWQI band legend).
 *  Bands follow Excel Report summary: ≥80 Excellent, ≥60 Acceptable, else Action. */
function customerVerdict(wq) {
  if (wq >= 80) return { label: t('score.verdict.excellent'), color: '#284dcd', tier: 'high' };
  if (wq >= 60) return { label: t('score.verdict.good'), color: '#56d096', tier: 'mid' };
  return { label: t('score.verdict.attention'), color: '#f07b7b', tier: 'low' };
}

function scoreSummaryNote(wq, findings) {
  const attnCount = (findings || []).length;
  if (wq >= 80) return t('score.msg.excellent');
  if (wq >= 60) return t('score.msg.goodDetail');
  if (attnCount > 0) {
    return t('score.msg.attentionDetail').replace('{n}', String(attnCount));
  }
  return t('score.msg.low');
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

/** Benchmark comparison — independent country engines via WaterScoreBenchmarkRegistry. */
const DEFAULT_SCORE_STANDARD_KEY = 'thailand';
/** Thai first, then strictest cleanliness expectations → least strict. */
const SCORE_STANDARD_ORDER = Object.freeze(['thailand', 'japan', 'eu', 'who', 'usEpa']);

function benchmarkRegistry() {
  return (typeof window !== 'undefined' && window.WaterScoreBenchmarkRegistry)
    ? window.WaterScoreBenchmarkRegistry
    : (typeof WaterScoreBenchmarkRegistry !== 'undefined' ? WaterScoreBenchmarkRegistry : null);
}

/** Adapter so existing UI can read display/label metadata from engines. */
function getWaterQualityStandard(standardKey) {
  const reg = benchmarkRegistry();
  const engine = reg?.get?.(standardKey) || reg?.get?.(DEFAULT_SCORE_STANDARD_KEY);
  if (!engine) {
    return {
      key: DEFAULT_SCORE_STANDARD_KEY,
      labelKey: 'score.refStandard.thailand',
      shortKey: 'score.refStandard.short.thailand',
      display: {},
      limits: {}
    };
  }
  return {
    key: engine.key,
    labelKey: engine.labelKey,
    shortKey: engine.shortKey,
    display: engine.display || {},
    limits: engine.limits || {}
  };
}

function clampScore(n, lo = 0, hi = 100) {
  return typeof scoreClamp === 'function' ? scoreClamp(n, lo, hi) : Math.max(lo, Math.min(hi, n));
}

/** Comparison only — delegates to the selected country's engine (never production). */
function computeParamScoresForStandard(readings, standardKey = DEFAULT_SCORE_STANDARD_KEY) {
  const reg = benchmarkRegistry();
  const key = reg?.has?.(standardKey) ? standardKey : DEFAULT_SCORE_STANDARD_KEY;
  const out = reg.calculate(key, readings || {});
  return { score: out.score, params: out.params };
}

function evaluateParamStatus(paramName, value, standardKey = DEFAULT_SCORE_STANDARD_KEY) {
  const key = paramKey(paramName);
  const reg = benchmarkRegistry();
  const engine = reg?.get?.(standardKey) || reg?.get?.(DEFAULT_SCORE_STANDARD_KEY);
  if (engine?.evaluateStatus) return engine.evaluateStatus(key, value);
  return Number.isFinite(Number(value)) ? 'good' : 'pending';
}

function buildScoreFindings(readings, standardKey = DEFAULT_SCORE_STANDARD_KEY) {
  const reg = benchmarkRegistry();
  const key = reg?.has?.(standardKey) ? standardKey : DEFAULT_SCORE_STANDARD_KEY;
  const out = reg.calculate(key, readings || {});
  return (out.findings || []).map(f => ({
    label: f.label || (f.labelKey && typeof t === 'function' ? t(f.labelKey) : (f.labelKey || '')),
    val: f.val,
    note: f.note || ''
  }));
}

/** Comparison-only result. Never write this to job.result / API.
 *  Metadata (verdict/summary/reasons) comes from the country engine — UI must not invent it.
 */
function buildComparisonScoreResult(readings, standardKey = DEFAULT_SCORE_STANDARD_KEY) {
  const reg = benchmarkRegistry();
  const key = reg?.has?.(standardKey) ? standardKey : DEFAULT_SCORE_STANDARD_KEY;
  const standard = getWaterQualityStandard(key);
  const scored = reg.calculate(key, readings || {});
  const score = Number.isFinite(scored.score) ? scored.score : null;
  const findings = (scored.findings || []).map(f => ({
    label: f.label || (f.labelKey && typeof t === 'function' ? t(f.labelKey) : (f.labelKey || '')),
    val: f.val,
    note: f.note || ''
  }));
  // Prefer engine-authored verdict; fall back only if an engine omitted metadata.
  const engineVerdict = scored.verdict || null;
  const fallbackVerdict = score == null ? null : customerVerdict(score);
  return {
    standardKey: key,
    standard,
    readings: { ...readings },
    score,
    paramScores: scored.params,
    findings,
    statuses: scored.statuses || null,
    engine: scored.engine || key,
    engineKey: scored.engineKey || key,
    verdict: engineVerdict || fallbackVerdict?.label || null,
    verdictTier: fallbackVerdict?.tier || null,
    summary: scored.summary || null,
    passedParameters: scored.passedParameters || [],
    warningParameters: scored.warningParameters || [],
    failedParameters: scored.failedParameters || [],
    criticalFailures: scored.criticalFailures || [],
    reasons: Array.isArray(scored.reasons) ? scored.reasons : [],
    topPositiveFactors: Array.isArray(scored.topPositiveFactors) ? scored.topPositiveFactors : [],
    topNegativeFactors: Array.isArray(scored.topNegativeFactors) ? scored.topNegativeFactors : [],
    calculationId: scored.calculationId || null,
    engineVersion: scored.engineVersion || null,
    standardRevision: scored.standardRevision || null,
    calculatedAt: scored.calculatedAt || null,
    inputFingerprint: scored.inputFingerprint || null,
    classifications: scored.classifications || null,
    metadata: scored
  };
}

const SCORE_BAR_COLORS = Object.freeze({
  low: '#f07b7b',
  mid: '#56d096',
  high: '#284dcd',
  pending: '#56d096'
});

function scoreBarColorForScore(wq) {
  if (!Number.isFinite(Number(wq))) return SCORE_BAR_COLORS.pending;
  const verdict = customerVerdict(Number(wq));
  return SCORE_BAR_COLORS[verdict.tier] || SCORE_BAR_COLORS.pending;
}

/**
 * Single evaluation context for the whole report view.
 * Room Analysis + Parameter Analysis must both use this — never hardcoded limits.
 */
function getScoreEvalContext(result = activeComparisonResult()) {
  const standardKey = result?.standardKey
    || (benchmarkRegistry()?.has?.(S.scoreStandardKey) ? S.scoreStandardKey : DEFAULT_SCORE_STANDARD_KEY);
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
  if (status === 'pending') return 'pending';
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

function canDisplayScoreNumber(readiness, job = S.activeJob) {
  if (S.publicScoreView) {
    const published = Number(job?.result?.waterScore ?? job?.draft?.scoreVal);
    if (Number.isFinite(published)) return true;
  }
  // Overall score needs the formula inputs. OCR still running must not hide a ready score
  // or block opening this screen — pending metrics keep their own loading state.
  const present = readiness?.present || resolveScoreReadingsPresent(job);
  const scoreKeys = ['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do'];
  return scoreKeys.every(key => present[key] !== undefined);
}

function renderScoreStatusBar(wq, { loading = false } = {}) {
  const bar = document.getElementById('score-status-bar');
  const knob = document.getElementById('score-progress-knob');
  const segments = [
    { from: 0, to: 50, el: document.getElementById('score-seg-fill-0') },
    { from: 50, to: 80, el: document.getElementById('score-seg-fill-1') },
    { from: 80, to: 100, el: document.getElementById('score-seg-fill-2') }
  ];
  const fillColor = scoreBarColorForScore(wq);
  if (bar) {
    bar.classList.toggle('is-loading', loading);
    bar.style.setProperty('--score-bar-fill', fillColor);
    bar.setAttribute(
      'aria-label',
      loading
        ? t('score.readiness.processingTitle')
        : `Water Score ${Math.round(Math.max(0, Math.min(100, Number(wq) || 0)))} of 100`
    );
  }
  if (loading) {
    segments.forEach(seg => { if (seg.el) seg.el.style.width = '0%'; });
    if (knob) knob.style.left = '0%';
    return;
  }
  const score = Math.max(0, Math.min(100, Number(wq) || 0));
  segments.forEach(seg => {
    if (!seg.el) return;
    const span = seg.to - seg.from;
    const filled = Math.max(0, Math.min(span, score - seg.from));
    seg.el.style.width = `${(filled / span) * 100}%`;
    seg.el.style.background = fillColor;
  });
  if (knob) knob.style.left = `${score}%`;
}

function setScoreHeroLoading(loading) {
  const card = document.querySelector('#score-hero .score-summary-card');
  const numEl = document.getElementById('gauge-val');
  const denEl = document.querySelector('#score-summary-score .score-summary-den');
  const loadingEl = document.getElementById('score-summary-loading');
  card?.classList.toggle('is-loading', loading);
  if (loadingEl) loadingEl.hidden = !loading;
  if (numEl) numEl.hidden = loading;
  if (denEl) denEl.hidden = loading;
  if (loading && numEl) numEl.textContent = '—';
}

function activeComparisonResult() {
  return S.comparisonScoreResult || null;
}

function activeStandardKey() {
  return activeComparisonResult()?.standardKey || S.scoreStandardKey || DEFAULT_SCORE_STANDARD_KEY;
}

/** Thai first, then fixed strictness order (not sample score). */
function orderedStandardsForSelect() {
  const reg = benchmarkRegistry();
  return SCORE_STANDARD_ORDER.filter(key => reg?.has?.(key));
}

function renderStandardSelect(context = getScoreEvalContext()) {
  const selectEl = document.getElementById('score-standard-select');
  if (!selectEl) return;
  const selected = context.selectedStandard;
  const order = orderedStandardsForSelect();
  selectEl.innerHTML = order.map(key => {
    const standard = getWaterQualityStandard(key);
    return `<option value="${key}"${selected === key ? ' selected' : ''}>${t(standard.shortKey)}</option>`;
  }).join('');
  selectEl.onchange = () => setScoreReferenceStandard(selectEl.value);
}

/**
 * Renders the on-screen report from comparisonScoreResult.
 * Does not mutate S.scoreVal / currentScoreResult / backend values.
 */
/**
 * Backward compatibility: an already-published report (e.g. /r/{token} for
 * a case that was closed before Eligibility existed, or any already-closed
 * case) must keep showing its published score exactly as before — the new
 * eligibility gate only applies to reports that have not been published yet.
 */
function isPublishedScoreView(job = S.activeJob) {
  if (!S.publicScoreView) return false;
  const published = Number(job?.result?.waterScore ?? job?.draft?.scoreVal);
  return Number.isFinite(published);
}

function renderScoreDisplay() {
  const result = activeComparisonResult();
  if (!result) return;

  const context = getScoreEvalContext(result);
  const readiness = getScoreDataReadiness(S.activeJob);
  // Eligibility contract is the single source of truth for completeness.
  // Score visibility uses canCalculateScore (numeric inputs only).
  // Official publish/close uses canPublishReport (measurements + inspection).
  // A published view still gets a (legacy-tagged) contract rather than none,
  // so the bypass stays traceable instead of silent.
  const eligibility = isPublishedScoreView(S.activeJob)
    ? (typeof EligibilityContract !== 'undefined' ? EligibilityContract.buildLegacy() : null)
    : (typeof resolveReportEligibility === 'function' ? resolveReportEligibility(S.activeJob) : null);
  const showScore = isPublishedScoreView(S.activeJob)
    ? true
    : (eligibility
      ? Boolean(eligibility.canCalculateScore)
      : canDisplayScoreNumber(readiness, S.activeJob));
  // Summary number comes from computeScoreFromReadings (fresh), never a cached draft.scoreVal.
  // Selected standard still drives parameter status, recommended ranges, and findings.
  const computedWho = S.currentScoreResult?.computedScore;
  const comparisonScore = result.score;
  const publishedScore = S.currentScoreResult?.score;
  // Public report page has no live readings to recompute from — it must fall
  // back to the already-published score instead of showing NaN.
  // Display score follows the selected Benchmark so Thai / WHO / EU etc. update the hero.
  // Production/share score remains WHO via currentScoreResult / computeScoreFromReadings.
  const wq = S.publicScoreView && Number.isFinite(publishedScore)
    ? publishedScore
    : Number.isFinite(comparisonScore)
      ? comparisonScore
      : (Number.isFinite(computedWho) ? computedWho : NaN);
  console.log('RENDER SCORE DISPLAY', {
    score: wq,
    computedWho,
    comparisonScore,
    standard: result.standardKey,
    readings: result.readings,
    readiness,
    showScore
  });
  const findings = result.findings || [];
  const verdict = Number.isFinite(wq) ? customerVerdict(wq) : { tier: 'pending', label: '—', color: '#284dcd' };
  const hero = document.getElementById('score-hero');
  const bandEl = document.getElementById('score-summary-band');
  const noteEl = document.getElementById('score-summary-note');
  const standardEl = document.getElementById('score-standard-label');
  const heroSourceEl = document.getElementById('score-hero-source');

  if (hero) {
    hero.className = 'score-report score-live';
    hero.dataset.tier = showScore ? verdict.tier : 'pending';
  }
  const summaryCard = hero?.querySelector('.score-summary-card');
  if (summaryCard) {
    summaryCard.style.setProperty('--score-accent', showScore ? verdict.color : '#284dcd');
  }
  if (standardEl) {
    standardEl.textContent = t(context.standard.labelKey);
  }
  // Clarify that the large hero number is the selected Benchmark comparison
  // (or the published Production score on public report) — not a merged score.
  if (heroSourceEl) {
    if (showScore) {
      if (S.publicScoreView) {
        heroSourceEl.textContent = t('score.hero.published');
      } else {
        const name = t(context.standard.shortKey || context.standard.labelKey);
        heroSourceEl.textContent = t('score.hero.benchmark').replace('{name}', name);
      }
      heroSourceEl.hidden = false;
    } else {
      heroSourceEl.textContent = '';
      heroSourceEl.hidden = true;
    }
  }

  setScoreHeroLoading(!showScore);

  // Presentation text comes only from the Eligibility Contract via the
  // Presentation formatter — UI never recomputes coverage/reason itself.
  const eligibilityPresented = (eligibility && typeof EligibilityPresentation !== 'undefined')
    ? EligibilityPresentation.format(eligibility)
    : null;

  if (bandEl) {
    if (showScore) {
      bandEl.textContent = result.verdict || verdict.label;
    } else if (readiness?.ocrBusy) {
      bandEl.textContent = t('score.readiness.calculatingBadge');
    } else if (eligibilityPresented) {
      bandEl.textContent = eligibilityPresented.badgeText;
    } else {
      bandEl.textContent = t('score.readiness.waitingBadge');
    }
    bandEl.style.color = '';
  }
  if (noteEl) {
    if (showScore) {
      // Score card shows the numeric result only — do not append benchmark
      // prose, measurement/inspection coverage, or "Inspection incomplete".
      noteEl.textContent = '';
      noteEl.hidden = true;
    } else if (readiness?.ocrBusy) {
      noteEl.hidden = false;
      noteEl.textContent = t('score.readiness.processingText');
    } else if (eligibilityPresented && eligibility) {
      noteEl.hidden = false;
      const missingBits = [];
      if (eligibility.missingMeasurements.length) {
        missingBits.push(`Missing measurements: ${eligibility.missingMeasurements.join(', ')}`);
      }
      noteEl.textContent = missingBits.length
        ? missingBits.join(' — ')
        : (eligibilityPresented.reasonText || t('score.readiness.waitingBadge'));
    } else {
      noteEl.hidden = false;
      noteEl.textContent = t('score.readiness.waitingNote')
        .replace('{filled}', String(readiness?.filledCount ?? 0))
        .replace('{total}', String(readiness?.totalCount ?? 7));
    }
  }

  renderScoreStatusBar(showScore ? wq : 0, { loading: !showScore });
  if (!S.scoreTapFilter) {
    S.scoreTapFilter = (S.taps?.length || 0) > 1 ? 'all' : (S.taps?.[0] || 'all');
  }
  if (showScore) {
    animateScoreNumber(document.getElementById('gauge-val'), wq);
  }
  renderStandardSelect(context);
  renderLocationSelect(context);
  renderScoreReadiness(readiness);
  renderScoreReadings(context);
  // Always render improve / all-good from whatever readings are already available.
  renderScoreImprove(context);
  renderScorePhotos(readiness);
}

/** Switch comparison standard — recalculates statuses from the same resolved readings. */
function setScoreReferenceStandard(standardKey) {
  const key = benchmarkRegistry()?.has?.(standardKey) ? standardKey : DEFAULT_SCORE_STANDARD_KEY;
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

const SCORE_READY_KEYS = Object.freeze(['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp']);

/**
 * Real measurements only — never HTML placeholders, never demo fill values.
 * Sources: tap snapshots, saved draft fields, and live DOM input values.
 */
function resolveScoreReadingsPresent(job) {
  const draft = job?.draft || {};
  const fromTaps = readingsFromTapData(draft.tapData?.length ? draft.tapData : S.tapData);
  const fromFields = readingsFromFieldMap(draft.fields || {});
  const fromDom = readingsFromDomFields();
  // Do not use scoreBaseReadings here — older drafts may have cached demo fill values.
  return mergeReadingLayers(fromTaps, fromFields, fromDom);
}

function getScoreDataReadiness(job = S.activeJob) {
  const present = resolveScoreReadingsPresent(job);
  const missing = SCORE_READY_KEYS.filter(key => present[key] === undefined);
  const ocrBusy = Boolean(window.MeterReadingCapture?._processing)
    || Boolean(typeof processAssessmentPhoto === 'function' && processAssessmentPhoto._busy);
  const hasPhotos = (() => {
    const taps = (job?.draft?.tapData?.length ? job.draft.tapData : S.tapData) || [];
    return taps.some(tap => {
      const photos = tap?.photos || {};
      return Boolean(photos.tapphoto || photos.visual || photos.meter || (Array.isArray(tap?.meterImages) && tap.meterImages.length));
    });
  })();
  return {
    present,
    missing,
    ready: missing.length === 0,
    ocrBusy,
    hasPhotos,
    filledCount: SCORE_READY_KEYS.length - missing.length,
    totalCount: SCORE_READY_KEYS.length
  };
}

function renderScoreReadiness(readiness) {
  const banner = document.getElementById('score-readiness');
  const hero = document.getElementById('score-hero');
  const showPending = Boolean(readiness && (!readiness.ready || readiness.ocrBusy));

  // Loading state lives in the summary card — keep the extra banner hidden.
  if (banner) banner.hidden = true;
  hero?.classList.toggle('is-incomplete', showPending);

  if (!showPending) {
    if (S._scoreReadyPoll) {
      clearInterval(S._scoreReadyPoll);
      S._scoreReadyPoll = null;
    }
    return readiness;
  }

  // Keep refreshing while OCR runs so values from each finished photo appear immediately.
  // Incomplete-but-idle screens stay viewable with per-metric pending rows (no forever poll).
  if (readiness.ocrBusy && !S._scoreReadyPoll && !S.publicScoreView) {
    S._scoreReadyPoll = setInterval(() => {
      if (S.screen !== 's-score') {
        clearInterval(S._scoreReadyPoll);
        S._scoreReadyPoll = null;
        return;
      }
      if (typeof calcAndShowScore === 'function') calcAndShowScore();
      const next = getScoreDataReadiness(S.activeJob);
      if (!next.ocrBusy) {
        clearInterval(S._scoreReadyPoll);
        S._scoreReadyPoll = null;
      }
    }, 1200);
  }
  return readiness;
}

/**
 * Resolve readings for scoring from entered/OCR values only.
 * Empty inputs and HTML placeholders are never treated as measurements.
 */
function resolveScoreReadings(job) {
  const readings = resolveScoreReadingsPresent(job);

  console.log('INPUT READINGS', { readings });

  return readings;
}

function readingsFromJob(job) {
  return resolveScoreReadings(job);
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
    : (Number.isFinite(computedScore) ? computedScore : null);

  const taps = draft.taps?.length
    ? [...draft.taps]
    : (S.taps?.length ? [...S.taps] : ['Kitchen', 'Master bath', 'Shower', 'Laundry', 'Guest']);

  if (job) S.activeJob = job;
  // Saved / shareable score stays on the WHO production path.
  S.scoreVal = productionScore;
  // Cache only real entered/OCR values — never demo fill-ins.
  S.scoreBaseReadings = { ...readings };
  S.currentScoreResult = {
    score: productionScore,
    standardKey: 'who',
    readings: { ...readings },
    source: publicView && Number.isFinite(published) ? 'published' : 'computed',
    computedScore
  };
  if (!S.scoreStandardKey || !benchmarkRegistry()?.has?.(S.scoreStandardKey)) {
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

function readingsFromSingleTap(tap, fallback = {}) {
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
  // Only fill gaps from other real measurements — never demo placeholders.
  const realFallback = Object.fromEntries(
    Object.entries(fallback || {}).filter(([, v]) => Number.isFinite(Number(v)))
  );
  return { ...realFallback, ...Object.fromEntries(Object.entries(mapped).filter(([, v]) => v !== undefined)) };
}

/** True when a tap has any Standard (Layer 2) or legacy reading with a real number. */
function hasTapReadingSource(tap) {
  const hasFinite = (row) => row && typeof row === 'object'
    && Object.values(row).some(v => Number.isFinite(typeof v === 'number' ? v : parseFloat(v)));
  return Boolean(
    hasFinite(tap?.standardMeasurement)
    || hasFinite(tap?.meterReadings)
    || hasFinite(tap?.chlorineReadings)
  );
}

/** Resolve display readings for one room (or overall average). Does not mutate raw base readings. */
function getRoomReadings(tapKey, context = getScoreEvalContext()) {
  const base = context.readings && Object.keys(context.readings).length
    ? context.readings
    : (S.scoreBaseReadings || {});
  const taps = S.taps?.length ? S.taps : ['Tap 1'];
  const tapData = (S.activeJob?.draft?.tapData?.length ? S.activeJob.draft.tapData : S.tapData) || [];
  const baseReady = SCORE_READY_KEYS.every(key => Number.isFinite(Number(base?.[key])));

  if (tapKey === 'all') {
    const rows = taps.map((_, i) => {
      const tap = tapData[i];
      if (hasTapReadingSource(tap)) return readingsFromSingleTap(tap, base);
      // Without a tap snapshot, only synthesize offsets when base is fully measured.
      return baseReady ? readingsFromBase(base, i, taps.length) : { ...base };
    }).filter(row => SCORE_READY_KEYS.some(key => Number.isFinite(Number(row?.[key]))));
    const keys = ['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp'];
    const avg = {};
    keys.forEach(key => {
      const vals = rows.map(row => Number(row[key])).filter(Number.isFinite);
      if (vals.length) avg[key] = vals.reduce((sum, n) => sum + n, 0) / vals.length;
    });
    return avg;
  }

  const index = taps.indexOf(tapKey);
  const safeIndex = index >= 0 ? index : 0;
  const tap = tapData[safeIndex];
  if (hasTapReadingSource(tap)) {
    return readingsFromSingleTap(tap, base);
  }
  return baseReady ? readingsFromBase(base, safeIndex, taps.length) : { ...base };
}

/** Build metric rows for one room using selectedStandard limits — never shared across rooms. */
function buildMetricRowsForReadings(readings, context = getScoreEvalContext()) {
  const standardKey = context.selectedStandard || DEFAULT_SCORE_STANDARD_KEY;
  const display = context.display || getWaterQualityStandard(standardKey).display;
  const stdLabel = (text) => (text === 'Not specified' ? t('score.std.notSpecified') : text);
  const fmt = (n, digits, suffix = '') => (Number.isFinite(n) ? n.toFixed(digits) + suffix : '—');
  const fmtInt = (n, suffix = '') => (Number.isFinite(n) ? Math.round(n) + suffix : '—');
  const ph = Number(readings.ph);
  const tds = Number(readings.tds);
  const chlorine = Number(readings.chlorine);
  const turbidity = Number(readings.turbidity);
  const orp = Number(readings.orp);
  const doVal = Number(readings.do);
  const temp = Number(readings.temp);
  return [
    { p: 'pH', r: fmt(ph, 1), std: stdLabel(display.ph), st: evaluateParamStatus('ph', ph, standardKey) },
    { p: 'TDS', r: fmtInt(tds, ' mg/L'), std: stdLabel(display.tds), st: evaluateParamStatus('tds', tds, standardKey) },
    { p: 'Chlorine', r: fmt(chlorine, 1, ' mg/L'), std: stdLabel(display.chlorine), st: evaluateParamStatus('chlorine', chlorine, standardKey) },
    { p: 'Turbidity', r: fmt(turbidity, 1, ' NTU'), std: stdLabel(display.turbidity), st: evaluateParamStatus('turbidity', turbidity, standardKey) },
    { p: 'ORP', r: fmtInt(orp, ' mV'), std: stdLabel(display.orp), st: evaluateParamStatus('orp', orp, standardKey) },
    { p: 'DO', r: fmt(doVal, 1, ' mg/L'), std: stdLabel(display.do), st: evaluateParamStatus('do', doVal, standardKey) },
    { p: 'Temp', r: fmt(temp, 1, '°C'), std: stdLabel(display.temp), st: evaluateParamStatus('temp', temp, standardKey) }
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
  const statusLabels = {
    good: t('score.status.good'),
    attn: t('score.status.attn'),
    pending: t('score.status.pending')
  };

  const countEl = document.getElementById('score-indicator-count');
  if (countEl) {
    countEl.innerHTML = `${rows.length || 7} <span data-i18n="score.indicators">${t('score.indicators')}</span>`;
  }

  // Show ready metrics immediately; only pending rows shimmer while OCR / input catches up.
  listEl.classList.remove('is-loading');
  listEl.innerHTML = rows.map(r => {
    const statusKey = paramStatusUiKey(r.st);
    if (statusKey === 'pending') {
      return `<div class="score-metric-row is-pending">
  <span class="score-metric-name">${r.p}</span>
  <span class="score-metric-range">${r.std}</span>
  <span class="score-metric-value score-metric-skel">&nbsp;</span>
  <span class="score-metric-status score-metric-skel"><i class="score-dot" aria-hidden="true"></i>${statusLabels.pending}</span>
</div>`;
    }
    const statusLabel = statusLabels[statusKey];
    return `<div class="score-metric-row is-${statusKey}">
  <span class="score-metric-name">${r.p}</span>
  <span class="score-metric-range">${r.std}</span>
  <span class="score-metric-value">${r.r}</span>
  <span class="score-metric-status"><i class="score-dot" aria-hidden="true"></i>${statusLabel}</span>
</div>`;
  }).join('');
}

/** "Fix first" / "Room to improve" — attention-status rows for the currently viewed location. */
function renderScoreImprove(context = getScoreEvalContext()) {
  const section = document.getElementById('score-improve-section');
  const listEl = document.getElementById('score-improve-list');
  const countEl = document.getElementById('score-improve-count');
  const headingEl = document.getElementById('score-improve-heading');
  const allGood = document.getElementById('score-all-good');
  const allGoodText = document.getElementById('score-all-good-text');
  if (!section || !listEl) return;

  const allRows = scoreTapRows(S.scoreTapFilter || 'all', context);
  const rows = allRows.filter(r => paramStatusUiKey(r.st) === 'attn');
  const score = Number(activeComparisonResult()?.score);
  const readiness = getScoreDataReadiness(S.activeJob);
  const eligibility = (!isPublishedScoreView(S.activeJob) && typeof resolveReportEligibility === 'function')
    ? resolveReportEligibility(S.activeJob)
    : null;
  const showScore = isPublishedScoreView(S.activeJob)
    ? true
    : (eligibility
      ? Boolean(eligibility.canCalculateScore)
      : canDisplayScoreNumber(readiness, S.activeJob));
  const wq = Number.isFinite(score) ? score : 0;
  const verdict = customerVerdict(wq);

  if (!rows.length) {
    section.hidden = true;
    listEl.replaceChildren();
    if (allGood) {
      // Only claim "all good" when the overall score is ready and excellent.
      const showPass = showScore && verdict.tier === 'high';
      allGood.hidden = !showPass;
      if (allGoodText && showPass) {
        allGoodText.textContent = t('score.allGood').replace('{n}', String(allRows.length || 8));
      }
    }
    return;
  }

  if (allGood) allGood.hidden = true;
  section.hidden = false;
  if (headingEl) {
    headingEl.textContent = verdict.tier === 'low' ? t('score.fixFirst') : t('score.improveTitle');
  }
  if (countEl) countEl.textContent = `· ${rows.length}`;
  const warnIcon = `<span class="score-improve-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.5" r="0.8" fill="currentColor" stroke="none"/></svg></span>`;
  listEl.innerHTML = rows.map(r => `<div class="score-improve-row">
  ${warnIcon}
  <span class="score-improve-body">
    <span class="score-improve-name">${r.p}</span>
    <span class="score-improve-range">${r.std}</span>
  </span>
  <span class="score-improve-value">${r.r}</span>
</div>`).join('');
}

/** Photo carousel for the currently viewed location(s), sourced from assessment tap photos. */
function renderScorePhotos(readiness = getScoreDataReadiness(S.activeJob)) {
  const wrap = document.getElementById('score-photo-carousel');
  const track = document.getElementById('score-photo-track');
  const dotsEl = document.getElementById('score-photo-dots');
  const placeholder = document.getElementById('score-photo-placeholder');
  const placeholderText = document.getElementById('score-photo-placeholder-text');
  if (!wrap || !track || !dotsEl) return;

  const taps = S.taps?.length ? S.taps : [];
  const tapData = (S.activeJob?.draft?.tapData?.length ? S.activeJob.draft.tapData : S.tapData) || [];
  const indices = S.scoreTapFilter && S.scoreTapFilter !== 'all'
    ? [taps.indexOf(S.scoreTapFilter)].filter(i => i >= 0)
    : taps.map((_, i) => i);

  const photoSrc = photo => {
    if (!photo) return '';
    if (typeof DrivePhoto !== 'undefined' && DrivePhoto.previewSrc) return DrivePhoto.previewSrc(photo) || '';
    return typeof photo === 'string' ? photo : '';
  };

  const images = indices.map(i => {
    const photos = tapData[i]?.photos || {};
    const src = photoSrc(photos.tapphoto) || photoSrc(photos.visual) || photoSrc(photos.meter);
    return src ? { label: taps[i] || '', src } : null;
  }).filter(Boolean);

  if (!images.length) {
    wrap.hidden = true;
    track.replaceChildren();
    dotsEl.replaceChildren();
    if (placeholder) {
      placeholder.hidden = false;
      if (placeholderText) {
        placeholderText.textContent = readiness?.ocrBusy
          ? t('score.readiness.photosProcessing')
          : t('score.readiness.photosPending');
      }
    }
    return;
  }

  if (placeholder) placeholder.hidden = true;
  wrap.hidden = false;
  track.innerHTML = images.map(img => `<div class="score-photo-slide"><img src="${img.src}" alt="${img.label}" loading="lazy"></div>`).join('');
  dotsEl.innerHTML = images.map((_, i) => `<span class="score-photo-dot${i === 0 ? ' is-active' : ''}"></span>`).join('');
  dotsEl.style.display = images.length > 1 ? '' : 'none';

  if (images.length > 1) {
    const dots = Array.from(dotsEl.children);
    track.onscroll = () => {
      const idx = Math.round(track.scrollLeft / track.clientWidth);
      dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
    };
  } else {
    track.onscroll = null;
  }
}

function renderLocationSelect() {
  const wrap = document.getElementById('score-room-select-wrap');
  const selectEl = document.getElementById('score-room-select');
  const taps = S.taps?.length ? S.taps : [];
  if (!wrap || !selectEl) return;

  if (taps.length <= 1) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');

  const allLabel = `${t('score.allLocations')} (${taps.length})`;
  const options = [{ key: 'all', label: allLabel }, ...taps.map(tap => ({ key: tap, label: tap }))];
  selectEl.innerHTML = options.map(opt =>
    `<option value="${opt.key}"${S.scoreTapFilter === opt.key ? ' selected' : ''}>${opt.label}</option>`
  ).join('');
  selectEl.onchange = () => setScoreTapFilter(selectEl.value);
}

function setScoreTapFilter(key) {
  const context = getScoreEvalContext();
  S.scoreTapFilter = key;
  renderScoreReadings(context);
  renderScoreImprove(context);
  renderScorePhotos();
}

let sharingScore = false;

/**
 * Fetches the score-card PNG for a report and returns it as a shareable File.
 * title/text are accepted for a consistent call signature with the share
 * cascade below but are not used here — this only does token -> URL ->
 * fetch -> File. Format mirrors the breakpoint the /r/<token> report page
 * itself uses (case-flow-routes.js).
 */
const SHARE_CARD_FETCH_TIMEOUT_MS = 10000;

// eslint-disable-next-line no-unused-vars
async function shareScoreCardImage({ reportToken, preferredFormat, title, text } = {}) {
  if (!reportToken) return null;
  const format = preferredFormat || (window.matchMedia('(min-width: 720px)').matches ? 'landscape' : 'story');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SHARE_CARD_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/public/score-card/${encodeURIComponent(reportToken)}?format=${format}`, {
      signal: controller.signal
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    return new File([blob], 'water-score.png', { type: blob.type || 'image/png' });
  } catch (error) {
    console.warn('shareScoreCardImage failed', error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Toggles the Share button's loading state (shared by shareScore() and sharePublicReport()). */
function setShareButtonLoading(loading) {
  const btn = document.querySelector('#s-score .hdr-action');
  if (!btn) return;
  if (loading) {
    if (btn.dataset.shareLabel === undefined) btn.dataset.shareLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing Share Card...';
  } else {
    btn.disabled = false;
    if (btn.dataset.shareLabel !== undefined) {
      btn.textContent = btn.dataset.shareLabel;
      delete btn.dataset.shareLabel;
    }
  }
}

/**
 * Shared fallback cascade used by both shareScore() and sharePublicReport():
 * share the PNG as a file, else share the link, else copy it to clipboard.
 * Keeping this in one place is what stops the two callers from drifting.
 */
async function shareScoreResult({ reportToken, reportUrl, title, text }) {
  const file = await shareScoreCardImage({ reportToken, title, text });
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return 'image';
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      console.warn('Image share failed, falling back to URL share', error);
    }
  }

  if (navigator.share) {
    await navigator.share({ title, text, url: reportUrl });
    return 'url';
  }

  await navigator.clipboard.writeText(reportUrl);
  return 'clipboard';
}

async function shareScore() {
  if (sharingScore) return;

  if (S.publicScoreView) {
    if (typeof sharePublicReport === 'function') return sharePublicReport();
  }

  const job = S.activeJob;
  const caseRef = job?.notionId || job?.id;
  if (!caseRef) {
    showToast('Please calculate the Water Score first');
    return;
  }
  // Single source of truth: an already-published report may always be
  // re-shared; anything not yet published needs calculable numeric score.
  // Share publishes the Water Score card — gated by canCalculateScore, not
  // full inspection completion (canPublishReport).
  const alreadyPublished = Number.isFinite(Number(job?.result?.waterScore));
  if (!alreadyPublished) {
    const eligibility = typeof resolveReportEligibility === 'function' ? resolveReportEligibility(job) : null;
    if (eligibility && !eligibility.canCalculateScore) {
      showToast(eligibility.reason || 'Report is not eligible for a score yet');
      return;
    }
  }
  if (!Number.isFinite(Number(S.scoreVal))) {
    showToast('Please calculate the Water Score first');
    return;
  }

  sharingScore = true;
  setShareButtonLoading(true);
  saveActiveJobState();
  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseRef)}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ score: Number(S.scoreVal) })
    });
    const result = await response.json();
    if (!response.ok || !result.reportUrl) throw new Error(result.error || 'Could not publish score');

    job.result = { ...(job.result || {}), waterScore: result.score, reportUrl: result.reportUrl, publicReportToken: result.reportToken };

    const outcome = await shareScoreResult({
      reportToken: result.reportToken,
      reportUrl: result.reportUrl,
      title: 'Water Motion - Water Score',
      text: `ผล Water Score ของคุณ: ${result.score}/100`
    });
    showToast(outcome === 'clipboard' ? 'Score link copied - share with client' : 'Score shared');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('Share Score failed', error);
    showToast('Could not share score');
  } finally {
    sharingScore = false;
    setShareButtonLoading(false);
  }
}

function completeScore() {
  S.stepsDone.score = true;
  saveActiveJobState();
  renderJobSteps();
  goScreen('s-dash');
}
