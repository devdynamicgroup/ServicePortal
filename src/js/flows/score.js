function getScoreStyle(wq) {
  if (wq >= 90) return { band: t('score.band.exceptional'), pill: '#5b8def', pillText: '#fff', arc: '#5b8def', glow: 'rgba(91,141,239,.35)' };
  if (wq >= 80) return { band: t('score.band.international'), pill: '#2e9b6f', pillText: '#0c0a09', arc: '#2e9b6f', glow: 'rgba(46,155,111,.4)' };
  if (wq >= 60) return { band: t('score.band.good'), pill: '#d9a441', pillText: '#0c0a09', arc: '#d9a441', glow: 'rgba(217,164,65,.35)' };
  if (wq >= 50) return { band: t('score.band.fair'), pill: '#c48a3a', pillText: '#0c0a09', arc: '#c48a3a', glow: 'rgba(196,138,58,.35)' };
  return { band: t('score.band.attention'), pill: '#f07b7b', pillText: '#0c0a09', arc: '#f07b7b', glow: 'rgba(240,123,123,.35)' };
}

/** Customer-facing verdict shown on the summary card (not the DWQI band legend).
 *  Bands follow Excel Report summary: ≥80 Excellent, ≥60 Acceptable, else Action.
 *  Used for Quality / published Water Score — NOT Country Benchmark comparison (PD-001).
 *  Callers on the Quality/publish path must use qualityPublishPresentation
 *  (PD-007 D + PD-009 B) so Compliance FAIL/WARNING cannot surface as
 *  Excellent/Good alone. */
function customerVerdict(wq) {
  if (wq >= 80) return { label: t('score.verdict.excellent'), color: '#284dcd', tier: 'high' };
  if (wq >= 60) return { label: t('score.verdict.good'), color: '#56d096', tier: 'mid' };
  return { label: t('score.verdict.attention'), color: '#f07b7b', tier: 'low' };
}

/**
 * PD-007 D + PD-009 B — Quality / publish presentation hybrid.
 * Numeric Quality score (mean/6) is unchanged. Compliance math unchanged.
 * When Compliance is FAIL or WARNING, do not present Excellent/Good alone —
 * quality index ≠ safety clearance. WARNING uses distinct copy from FAIL.
 */
function qualityPublishPresentation(wq, complianceStatus) {
  const status = String(complianceStatus || '').toUpperCase();
  if (status === 'FAIL') {
    return {
      label: t('score.verdict.complianceFail'),
      color: '#f07b7b',
      tier: 'low',
      complianceOverride: true,
      complianceOverrideKind: 'FAIL'
    };
  }
  if (status === 'WARNING') {
    return {
      label: t('score.verdict.complianceWarning'),
      color: '#d9a441',
      tier: 'low',
      complianceOverride: true,
      complianceOverrideKind: 'WARNING'
    };
  }
  return { ...customerVerdict(wq), complianceOverride: false, complianceOverrideKind: null };
}

/** Engines with numeric severity protection (product decision, 2026-08-14) —
 *  presentation override below is scoped to exactly this set. EU/Thailand
 *  are not in this set, so they always fall through to the unchanged
 *  numeric-only branch below, regardless of their own classifications. */
const COUNTRY_SEVERITY_PRESENTATION_ENGINES = Object.freeze(['japan', 'who', 'usEpa']);

/**
 * PD-001 — Country Benchmark presentation verdict (pass-band language).
 * Presentation only: does not change engine math or numeric score.
 * Flat-100 ⇒ within pass band, not “Excellent” quality gradient.
 *
 * classifications/engineKey are optional. When engineKey is one of
 * COUNTRY_SEVERITY_PRESENTATION_ENGINES (Japan/WHO/US EPA — the same scope
 * as the numeric cap in benchmarkMetadata.js) and classifications shows a
 * FAIL/CRITICAL/WARNING parameter, the label reflects that instead of the
 * numeric pass-band language, reusing existing copy already used elsewhere
 * in the score UI (PD-007 D + PD-009 B for complianceFail/complianceWarning;
 * the pre-existing 60-79 numeric band for withinLimits) — no new wording
 * invented. WARNING (2026-08-14, presentation-only follow-up to the WARNING
 * numeric cap) reuses score.benchmark.verdict.withinLimits — the same string
 * already shown for an ungated 60-79 score — so a WARNING-capped 85 reads as
 * "within limits" rather than the "passBand" language reserved for a
 * genuinely clean composite. EU/Thailand/unspecified engines are unaffected.
 */
function comparisonPresentationVerdict(wq, classifications, engineKey) {
  if (classifications && COUNTRY_SEVERITY_PRESENTATION_ENGINES.includes(engineKey)
    && typeof worstBenchmarkClassification === 'function') {
    const worst = worstBenchmarkClassification(classifications);
    if (worst === 'CRITICAL') {
      return { label: t('score.verdict.complianceFail'), color: '#f07b7b', tier: 'low' };
    }
    if (worst === 'FAIL') {
      return { label: t('score.verdict.complianceWarning'), color: '#f07b7b', tier: 'low' };
    }
    if (worst === 'WARNING') {
      return { label: t('score.benchmark.verdict.withinLimits'), color: '#56d096', tier: 'mid' };
    }
  }
  if (!Number.isFinite(Number(wq))) return { label: '—', color: '#284dcd', tier: 'pending' };
  const n = Number(wq);
  if (n >= 80) return { label: t('score.benchmark.verdict.passBand'), color: '#284dcd', tier: 'high' };
  if (n >= 60) return { label: t('score.benchmark.verdict.withinLimits'), color: '#56d096', tier: 'mid' };
  return { label: t('score.benchmark.verdict.outsideLimits'), color: '#f07b7b', tier: 'low' };
}

/** True when the hero/summary number is the selected Country Benchmark comparison score. */
function isShowingCountryBenchmarkComparison() {
  if (S.publicScoreView) return false;
  const comparisonScore = activeComparisonResult()?.score;
  return Number.isFinite(Number(comparisonScore));
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

/** Benchmark comparison — independent country engines via WaterScoreBenchmarkRegistry.
 *  PD-005: dropdown order is navigation convenience only — NOT a magnitude ranking. */
const DEFAULT_SCORE_STANDARD_KEY = 'thailand';
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
  // Registry already applies Country Hero ceiling (PASS ≠ 100; 100 = Q-V3 only).
  // Re-assert here so Hero / comparison never surfaces 100 even if an engine bypasses wrap.
  const rawScore = Number.isFinite(scored.score) ? scored.score : null;
  const score = (typeof applyCountryBenchmarkHeroCeiling === 'function')
    ? applyCountryBenchmarkHeroCeiling(rawScore)
    : (rawScore != null && rawScore > 99 ? 99 : rawScore);
  const findings = (scored.findings || []).map(f => ({
    label: f.label || (f.labelKey && typeof t === 'function' ? t(f.labelKey) : (f.labelKey || '')),
    val: f.val,
    note: f.note || ''
  }));
  // Prefer engine-authored verdict for metadata; UI presentation uses
  // comparisonPresentationVerdict (PD-001) — do not surface Excellent/Good as Country Benchmark meaning.
  const engineVerdict = scored.verdict || null;
  const presentation = score == null ? null
    : comparisonPresentationVerdict(score, scored.classifications, scored.engineKey || key);
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
    verdict: presentation?.label || engineVerdict || fallbackVerdict?.label || null,
    engineVerdict,
    verdictTier: presentation?.tier || fallbackVerdict?.tier || null,
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

/**
 * Selected-country benchmark score. Delegates to the existing registry —
 * does not duplicate country formulas. Never calls Quality V3.
 */
function getCountryBenchmarkScore(readings, standardKey = DEFAULT_SCORE_STANDARD_KEY) {
  return buildComparisonScoreResult(readings, standardKey);
}

/**
 * Score the user actually sees in #gauge-val.
 *
 * Live Score screen: selected country engine (thailand|japan|eu|who|usEpa).
 * Public /r/{token} report: persisted published Quality Water Score.
 *
 * Quality V3 remains on currentScoreResult / S.scoreVal for publish+share.
 * It is not the live Hero number and is not used as a fallback when a
 * country is selected.
 */
function resolveDisplayedScore({
  publicView = false,
  publishedScore = null,
  readings = {},
  standardKey = DEFAULT_SCORE_STANDARD_KEY
} = {}) {
  if (publicView && Number.isFinite(Number(publishedScore))) {
    const score = Math.max(0, Math.min(100, Math.round(Number(publishedScore))));
    return {
      score,
      source: 'published',
      standardKey: 'quality-v3',
      engineKey: 'quality-v3',
      showScore: true,
      comparison: null,
      classifications: null
    };
  }
  const comparison = getCountryBenchmarkScore(readings, standardKey);
  const score = Number.isFinite(Number(comparison.score)) ? comparison.score : null;
  return {
    score,
    source: 'country-benchmark',
    standardKey: comparison.standardKey,
    engineKey: comparison.engineKey,
    showScore: score != null,
    comparison,
    classifications: comparison.classifications || null
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
  // Eligibility still describes missing production inputs (publish/share).
  // Live Hero visibility follows the selected country engine, not the
  // production 6-key list (which requires DO even when Japan excludes DO).
  const eligibility = isPublishedScoreView(S.activeJob)
    ? (typeof EligibilityContract !== 'undefined' ? EligibilityContract.buildLegacy() : null)
    : (typeof resolveReportEligibility === 'function' ? resolveReportEligibility(S.activeJob) : null);
  const displayed = resolveDisplayedScore({
    publicView: Boolean(S.publicScoreView),
    publishedScore: S.currentScoreResult?.score,
    readings: result.readings || S.scoreBaseReadings || {},
    standardKey: result.standardKey || S.scoreStandardKey
  });
  S.displayedScore = displayed;
  const showScore = displayed.showScore;
  const wq = displayed.score;
  const computedWho = S.currentScoreResult?.computedScore;
  const comparisonScore = displayed.source === 'country-benchmark' ? displayed.score : result.score;
  console.log('RENDER SCORE DISPLAY', {
    score: wq,
    source: displayed.source,
    engineKey: displayed.engineKey,
    qualityScore: computedWho,
    comparisonScore,
    compliance: S.currentScoreResult?.complianceStatus || null,
    standard: displayed.standardKey,
    readings: result.readings,
    readiness,
    showScore
  });
  const findings = result.findings || [];
  // PD-001: Country Benchmark comparison uses pass-band presentation, not Excellent/Good.
  // PD-007 D + PD-009 B: Quality / published path — FAIL/WARNING override Excellent/Good wording.
  const showingComparison = displayed.source === 'country-benchmark' && displayed.showScore;
  const complianceStatus = S.currentScoreResult?.complianceStatus || null;
  const verdict = Number.isFinite(wq)
    ? (showingComparison
      ? comparisonPresentationVerdict(wq, displayed.classifications, displayed.engineKey)
      : qualityPublishPresentation(wq, complianceStatus))
    : { tier: 'pending', label: '—', color: '#284dcd' };
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
  // Live report UI hides channel labels; Quality V3 publish path is unchanged.
  if (heroSourceEl) {
    heroSourceEl.textContent = '';
    heroSourceEl.hidden = true;
  }
  const complianceEl = document.getElementById('score-compliance-line');
  if (complianceEl) {
    complianceEl.textContent = '';
    complianceEl.hidden = true;
    delete complianceEl.dataset.status;
  }

  setScoreHeroLoading(!showScore);

  // Presentation text comes only from the Eligibility Contract via the
  // Presentation formatter — UI never recomputes coverage/reason itself.
  const eligibilityPresented = (eligibility && typeof EligibilityPresentation !== 'undefined')
    ? EligibilityPresentation.format(eligibility)
    : null;

  if (bandEl) {
    if (showScore) {
      bandEl.textContent = verdict.label;
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
      // PD-007 D + PD-009 B: FAIL/WARNING get explicit hybrid notes on Quality/publish path.
      // Comparison path keeps the benchmark disclaimer (PD-005 / PD-001).
      if (!showingComparison && verdict.complianceOverride) {
        noteEl.textContent = verdict.complianceOverrideKind === 'WARNING'
          ? t('score.msg.complianceWarningOverride')
          : t('score.msg.complianceFailOverride');
      } else {
        noteEl.textContent = t('score.benchmark.disclaimer');
      }
      noteEl.hidden = false;
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
  const detail = typeof computeQualityScoreDetail === 'function'
    ? computeQualityScoreDetail(readings)
    : null;

  S.scoreStandardKey = key;
  S.scoreBaseReadings = readings;
  // Publish/share channel stays Quality V3. Live Hero uses country engine.
  S.scoreVal = computedScore;
  S.currentScoreResult = {
    ...(S.currentScoreResult || {}),
    score: computedScore,
    computedScore,
    readings: { ...readings },
    source: 'computed',
    standardKey: 'quality-v3',
    engineVersion: detail?.engineVersion || (typeof QUALITY_SCORE_ENGINE_VERSION !== 'undefined' ? QUALITY_SCORE_ENGINE_VERSION : 'quality-v3'),
    paramScores: detail?.params || null,
    complianceStatus: detail?.compliance?.status || null,
    compliance: detail?.compliance || null,
    validation: S.lastReadingsValidation || null
  };
  S.comparisonScoreResult = getCountryBenchmarkScore(readings, key);
  S.displayedScore = resolveDisplayedScore({
    publicView: Boolean(S.publicScoreView),
    publishedScore: S.currentScoreResult.score,
    readings,
    standardKey: key
  });
  S.scoreParamOpen = null;
  if (typeof persistActiveCaseScoreStandard === 'function') {
    persistActiveCaseScoreStandard(key);
  }
  console.log('STANDARD SWITCH', {
    key,
    readings,
    qualityScore: computedScore,
    comparisonScore: S.comparisonScoreResult.score,
    displayedScore: S.displayedScore.score,
    displayedEngine: S.displayedScore.engineKey,
    compliance: S.currentScoreResult.complianceStatus
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
 * True when `job` is the operator's currently active Case.
 * Session globals (S.tapData, meter DOM) may only contribute readings for this Case.
 */
function isActiveScoreJob(job) {
  if (!job || typeof S === 'undefined' || !S.activeJob) return false;
  if (job === S.activeJob) return true;
  const active = S.activeJob;
  if (job.id != null && active.id != null && String(job.id) === String(active.id)) return true;
  if (job.notionId && active.notionId && String(job.notionId) === String(active.notionId)) return true;
  const compact = (value) => String(value || '').replace(/-/g, '');
  if (job.notionId && active.id != null && compact(active.id) === compact(job.notionId)) return true;
  if (active.notionId && job.id != null && compact(job.id) === compact(active.notionId)) return true;
  return false;
}

/**
 * Case-owned tap rows for scoring. Prefer job.draft.tapData.
 * S.tapData is allowed only while scoring the active Case (live assessment session).
 * Never fall back to another Case's session taps.
 */
function resolveJobTapDataForScore(job) {
  const draft = job?.draft || {};
  if (Array.isArray(draft.tapData) && draft.tapData.length) return draft.tapData;
  if (isActiveScoreJob(job) && Array.isArray(S.tapData) && S.tapData.length) return S.tapData;
  return Array.isArray(draft.tapData) ? draft.tapData : [];
}

/**
 * Real measurements only — never HTML placeholders, never demo fill values.
 * Sources: Case-owned tap snapshots and that Case's draft fields.
 * Active-session S.tapData may supply taps only when scoring the active Case
 * and draft.tapData is absent (see resolveJobTapDataForScore).
 * Meter DOM (#m-*) is intentionally excluded — leftover DOM from Case A must
 * never complete Case B's score.
 */
function resolveScoreReadingsPresent(job) {
  const draft = job?.draft || {};
  const fromTaps = readingsFromTapData(resolveJobTapDataForScore(job));
  const fromFields = readingsFromFieldMap(draft.fields || {});
  // Do not use scoreBaseReadings here — older drafts may have cached demo fill values.
  return mergeReadingLayers(fromTaps, fromFields);
}

function getScoreDataReadiness(job = S.activeJob) {
  const present = resolveScoreReadingsPresent(job);
  const missing = SCORE_READY_KEYS.filter(key => present[key] === undefined);
  const ocrBusy = Boolean(window.MeterReadingCapture?._processing)
    || Boolean(typeof processAssessmentPhoto === 'function' && processAssessmentPhoto._busy);
  const hasPhotos = (() => {
    const taps = resolveJobTapDataForScore(job) || [];
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
 *
 * Also runs the canonical MeasurementValidator gate: values that are
 * non-numeric-coercible (already mostly excluded by numOrUndefined above)
 * or physically implausible (e.g. DO far beyond sensor range) are stripped
 * here so every downstream engine (Quality V3, benchmark registry) sees the
 * same "missing" field instead of a silently-corrupted number. The frozen
 * scoring engines are not modified — this only changes what reaches them.
 */
function resolveScoreReadings(job) {
  const present = resolveScoreReadingsPresent(job);
  const validation = (typeof MeasurementValidator !== 'undefined')
    ? MeasurementValidator.validateMeasurements(present)
    : null;

  let readings = present;
  if (validation) {
    readings = { ...present };
    MeasurementValidator.SCORED_KEYS.forEach(key => {
      const state = validation.fields[key]?.state;
      if (state === MeasurementValidator.STATE.IMPLAUSIBLE || state === MeasurementValidator.STATE.INVALID_TYPE) {
        delete readings[key];
      }
    });
  }
  S.lastReadingsValidation = validation;

  console.log('INPUT READINGS', { readings, validation });

  return readings;
}

function readingsFromJob(job) {
  return resolveScoreReadings(job);
}

/**
 * Single Water Score renderer used by both the field app and /r/{token}.
 * publicView only changes chrome (handled by caller); display path is identical.
 *
 * currentScoreResult  → Quality V3 (share + backend publish only)
 * comparisonScoreResult / displayedScore → selected country engine (live Hero)
 */
function renderWaterScore(job, options = {}) {
  const publicView = Boolean(options.publicView);
  const draft = job?.draft || {};
  if (!publicView && benchmarkRegistry()?.has?.(draft.scoreStandardKey)) {
    S.scoreStandardKey = draft.scoreStandardKey;
  }
  // Always resolve from tapData / fields / DOM — do not trust stale score-only cache.
  const readings = resolveScoreReadings(job);

  const published = Number(job?.result?.waterScore ?? draft.scoreVal);
  const detail = typeof computeQualityScoreDetail === 'function'
    ? computeQualityScoreDetail(readings)
    : null;
  const computedScore = detail && Number.isFinite(detail.score)
    ? detail.score
    : computeScoreFromReadings(readings);
  // Public report may show the published score; field app always uses the fresh calculation.
  const productionScore = publicView && Number.isFinite(published)
    ? Math.max(0, Math.min(100, Math.round(published)))
    : (Number.isFinite(computedScore) ? computedScore : null);

  const taps = draft.taps?.length
    ? [...draft.taps]
    : (S.taps?.length ? [...S.taps] : ['Kitchen', 'Master bath', 'Shower', 'Laundry', 'Guest']);

  // Score Architecture V2 (2026-08-17, PO-approved): a render function must
  // not be able to change which Case is globally active as a side effect
  // (Principle D / state-ownership finding from the architecture audit).
  // Callers that open a Case set S.activeJob explicitly before rendering;
  // this function only ever renders whatever `job` it was given.
  // Saved / shareable score stays on the Quality V2 path.
  S.scoreVal = productionScore;
  // Cache only real entered/OCR values — never demo fill-ins.
  S.scoreBaseReadings = { ...readings };
  // A published/shared report must not lose its safety channel: prefer the
  // persisted compliance status (set at publish time) over a recompute from
  // whatever readings happen to still be reconstructable on the public page.
  const persistedCompliance = publicView ? (job?.result?.complianceStatus || null) : null;
  S.currentScoreResult = {
    score: productionScore,
    standardKey: 'quality-v3',
    readings: { ...readings },
    source: publicView && Number.isFinite(published) ? 'published' : 'computed',
    computedScore,
    engineVersion: detail?.engineVersion || (typeof QUALITY_SCORE_ENGINE_VERSION !== 'undefined' ? QUALITY_SCORE_ENGINE_VERSION : 'quality-v3'),
    paramScores: detail?.params || null,
    complianceStatus: persistedCompliance || detail?.compliance?.status || null,
    compliance: detail?.compliance || null,
    validation: S.lastReadingsValidation || null
  };
  if (!S.scoreStandardKey || !benchmarkRegistry()?.has?.(S.scoreStandardKey)) {
    S.scoreStandardKey = DEFAULT_SCORE_STANDARD_KEY;
  }
  S.comparisonScoreResult = getCountryBenchmarkScore(readings, S.scoreStandardKey);
  S.displayedScore = resolveDisplayedScore({
    publicView,
    publishedScore: productionScore,
    readings,
    standardKey: S.scoreStandardKey
  });
  console.log('DISPLAY SCORE PATH', {
    productionScore,
    computedScore,
    comparisonScore: S.comparisonScoreResult?.score,
    displayedScore: S.displayedScore?.score,
    displayedSource: S.displayedScore?.source,
    displayedEngine: S.displayedScore?.engineKey,
    compliance: S.currentScoreResult.complianceStatus,
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
  // Explicit — renderWaterScore() no longer sets S.activeJob as a side effect.
  if (job) S.activeJob = job;
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
  const tapData = resolveJobTapDataForScore(S.activeJob) || [];
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
  const toFin = typeof toFiniteReading === 'function'
    ? toFiniteReading
    : (v) => {
      if (v === null || v === undefined || v === '' || v === false) return NaN;
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    };
  const ph = toFin(readings.ph);
  const tds = toFin(readings.tds);
  const chlorine = toFin(readings.chlorine);
  const turbidity = toFin(readings.turbidity);
  const orp = toFin(readings.orp);
  const doVal = toFin(readings.do);
  const temp = toFin(readings.temp);
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
    const key = paramKey(r.p);
    if (statusKey === 'pending') {
      return `<div class="score-metric-item">
  <div class="score-metric-row is-pending">
    <span class="score-metric-name">${r.p}</span>
    <span class="score-metric-range">${r.std}</span>
    <span class="score-metric-value score-metric-skel">&nbsp;</span>
    <span class="score-metric-status score-metric-skel"><i class="score-dot" aria-hidden="true"></i>${statusLabels.pending}</span>
  </div>
</div>`;
    }
    const statusLabel = statusLabels[statusKey];
    const expanded = S.scoreMetricOpen === key;
    return `<div class="score-metric-item${expanded ? ' is-open' : ''}">
  <button type="button" class="score-metric-row is-${statusKey}" aria-expanded="${expanded}" onclick="toggleScoreMetricDetail('${key}')">
    <span class="score-metric-name">${r.p}</span>
    <span class="score-metric-range">${r.std}</span>
    <span class="score-metric-value">${r.r}</span>
    <span class="score-metric-status"><i class="score-dot" aria-hidden="true"></i>${statusLabel}</span>
    <span class="score-metric-caret" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
  </button>
  <div class="score-metric-detail"${expanded ? '' : ' hidden'}>
    <p class="score-metric-meaning">${paramMeaningText(r.p, statusKey === 'good' ? 'good' : 'attn')}</p>
    <dl class="score-metric-facts">
      <div><dt>${t('score.result')}</dt><dd>${r.r}</dd></div>
      <div><dt>${t('score.standard')}</dt><dd>${r.std}</dd></div>
      <div><dt>${t('score.status')}</dt><dd class="is-${statusKey}">${statusLabel}</dd></div>
    </dl>
  </div>
</div>`;
  }).join('');
}

/** Expands one metric row's detail panel. Display-only — never recalculates a score. */
function toggleScoreMetricDetail(key) {
  S.scoreMetricOpen = S.scoreMetricOpen === key ? null : key;
  renderScoreReadings();
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
  const displayed = resolveDisplayedScore({
    publicView: Boolean(S.publicScoreView),
    publishedScore: S.currentScoreResult?.score,
    readings: context.readings || S.scoreBaseReadings || {},
    standardKey: context.selectedStandard || S.scoreStandardKey
  });
  const showScore = displayed.showScore;
  const wq = Number.isFinite(displayed.score) ? displayed.score : 0;
  // PD-001: comparison uses pass-band tiers.
  // PD-007 D + PD-009 B: Quality path uses FAIL/WARNING presentation override.
  const verdict = isShowingCountryBenchmarkComparison()
    ? comparisonPresentationVerdict(wq, displayed.classifications, displayed.engineKey)
    : qualityPublishPresentation(wq, S.currentScoreResult?.complianceStatus || null);

  if (!rows.length) {
    section.hidden = true;
    listEl.replaceChildren();
    if (allGood) {
      const showPass = showScore && verdict.tier === 'high';
      allGood.hidden = !showPass;
      if (allGoodText && showPass) {
        allGoodText.textContent = isShowingCountryBenchmarkComparison()
          ? t('score.benchmark.allWithinLimits').replace('{n}', String(allRows.length || 8))
          : t('score.allGood').replace('{n}', String(allRows.length || 8));
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
  const tapData = resolveJobTapDataForScore(S.activeJob) || [];
  const indices = S.scoreTapFilter && S.scoreTapFilter !== 'all'
    ? [taps.indexOf(S.scoreTapFilter)].filter(i => i >= 0)
    : taps.map((_, i) => i);

  const photoSrc = photo => {
    if (!photo) return '';
    if (typeof DrivePhoto !== 'undefined' && DrivePhoto.previewSrc) return DrivePhoto.previewSrc(photo) || '';
    return typeof photo === 'string' ? photo : '';
  };

  // Prefer one representative photo per room so "All locations (N)" can swipe room-by-room.
  const images = [];
  const seen = new Set();
  indices.forEach(i => {
    const photos = tapData[i]?.photos || {};
    const label = taps[i] || `Room ${i + 1}`;
    const candidates = [photos.tapphoto, photos.visual, photos.meter];
    for (const photo of candidates) {
      const src = photoSrc(photo);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      images.push({ label, src });
      break;
    }
  });

  if (!images.length) {
    wrap.hidden = true;
    track.replaceChildren();
    dotsEl.replaceChildren();
    dotsEl.hidden = true;
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
  track.innerHTML = images.map(img => `<div class="score-photo-slide"><img src="${img.src}" alt="${img.label}" draggable="false" loading="lazy"></div>`).join('');
  const showDots = images.length > 1;
  dotsEl.hidden = !showDots;
  dotsEl.innerHTML = images.map((_, i) =>
    `<button type="button" class="score-photo-dot${i === 0 ? ' is-active' : ''}" aria-label="Photo ${i + 1} of ${images.length}" data-photo-index="${i}"></button>`
  ).join('');

  const syncDots = () => {
    const width = track.clientWidth || 1;
    const idx = Math.max(0, Math.min(images.length - 1, Math.round(track.scrollLeft / width)));
    Array.from(dotsEl.children).forEach((d, i) => d.classList.toggle('is-active', i === idx));
  };

  const goTo = (index) => {
    const width = track.clientWidth || 0;
    if (!width) return;
    track.scrollTo({ left: index * width, behavior: 'smooth' });
  };

  track.onscroll = showDots ? syncDots : null;
  dotsEl.onclick = showDots
    ? (event) => {
      const btn = event.target.closest('[data-photo-index]');
      if (!btn) return;
      goTo(Number(btn.dataset.photoIndex) || 0);
    }
    : null;

  // Keep swipe feel stable after re-render.
  requestAnimationFrame(() => {
    track.scrollLeft = 0;
    syncDots();
  });
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
  const intent = 'publish';
  const idempotencyKey = typeof getOrCreatePublishIdempotencyKey === 'function'
    ? getOrCreatePublishIdempotencyKey(caseRef, intent)
    : `idemp-${Date.now()}`;
  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseRef)}/score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        score: Number(S.scoreVal),
        complianceStatus: S.currentScoreResult?.complianceStatus || null,
        intent,
        idempotencyKey,
        modelVersion: (!alreadyPublished && typeof QUALITY_SCORE_ENGINE_VERSION !== 'undefined')
          ? QUALITY_SCORE_ENGINE_VERSION
          : undefined
      })
    });
    const result = await response.json();
    if (!response.ok || !result.reportUrl) throw new Error(result.error || 'Could not publish score');
    if (typeof clearPublishIdempotencyKey === 'function') clearPublishIdempotencyKey(caseRef, intent);

    job.result = {
      ...(job.result || {}),
      waterScore: result.score,
      complianceStatus: S.currentScoreResult?.complianceStatus || job.result?.complianceStatus || null,
      reportUrl: result.reportUrl,
      publicReportToken: result.reportToken
    };

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
