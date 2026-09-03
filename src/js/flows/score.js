function getScoreStyle(wq) {
  if (wq >= 90) return { band: t('score.band.exceptional'), pill: '#5b8def', pillText: '#fff', arc: '#5b8def', glow: 'rgba(91,141,239,.35)' };
  if (wq >= 80) return { band: t('score.band.international'), pill: '#2e9b6f', pillText: '#0c0a09', arc: '#2e9b6f', glow: 'rgba(46,155,111,.4)' };
  if (wq >= 60) return { band: t('score.band.good'), pill: '#d9a441', pillText: '#0c0a09', arc: '#d9a441', glow: 'rgba(217,164,65,.35)' };
  if (wq >= 50) return { band: t('score.band.fair'), pill: '#c48a3a', pillText: '#0c0a09', arc: '#c48a3a', glow: 'rgba(196,138,58,.35)' };
  return { band: t('score.band.attention'), pill: '#f07b7b', pillText: '#0c0a09', arc: '#f07b7b', glow: 'rgba(240,123,123,.35)' };
}

/** Customer-facing verdict shown on the summary card (not the DWQI band legend).
 *  Three tiers only: Excellent (blue) · Good (green) · Needs attention (red).
 *  2026-08-18 (PO-approved): bands are 0-50 Needs attention, 51-80 Good,
 *  81+ Excellent (previously 60/80 — moved so the color tiers line up with
 *  the score bar's own 0-50/50-80/80-100 segment breakpoints).
 *  Used for Quality / published Water Score — NOT Country Benchmark comparison (PD-001).
 *  Callers on the Quality/publish path must use qualityPublishPresentation
 *  (PD-007 D + PD-009 B) so Compliance FAIL/WARNING cannot surface as
 *  Excellent/Good alone. */
/** Three customer-facing bar colors only — Excellent / Good / Needs attention. */
const SCORE_BAR_COLORS = Object.freeze({
  high: '#284dcd', // Excellent — blue
  mid: '#6bd499',  // Good — green
  low: '#f07b7b',  // Needs attention — red
  pending: '#6bd499'
});

function customerVerdict(wq) {
  if (wq >= 81) return { label: t('score.verdict.excellent'), color: SCORE_BAR_COLORS.high, tier: 'high' };
  if (wq >= 51) return { label: t('score.verdict.good'), color: SCORE_BAR_COLORS.mid, tier: 'mid' };
  return { label: t('score.verdict.attention'), color: SCORE_BAR_COLORS.low, tier: 'low' };
}

// 2026-08-19 (PO-approved product policy — not tied to any official Thai
// standard): Thailand's own legal compliance bands are wide enough that
// ordinary, merely-safe water reads as numerically near-ideal under the
// shared grading curve, so the shared 81+ Excellent threshold read as too
// easy to reach for Thailand specifically. Thailand's own bar for
// "Excellent" is raised to 90+; Good (51+) and Needs attention stay
// unchanged. Every other country/engine keeps the shared 81/51 bands.
const THAILAND_EXCELLENT_MIN = 90;

function customerVerdictForEngine(wq, engineKey) {
  const n = Number(wq);
  if (!Number.isFinite(n)) return customerVerdict(n);
  if (engineKey === 'thailand') {
    if (n >= THAILAND_EXCELLENT_MIN) return { label: t('score.verdict.excellent'), color: SCORE_BAR_COLORS.high, tier: 'high' };
    if (n >= 51) return { label: t('score.verdict.good'), color: SCORE_BAR_COLORS.mid, tier: 'mid' };
    return { label: t('score.verdict.attention'), color: SCORE_BAR_COLORS.low, tier: 'low' };
  }
  return customerVerdict(n);
}

/**
 * PD-007 D + PD-009 B — Quality / publish presentation hybrid.
 * Numeric Quality score (mean/6) is unchanged. Compliance math unchanged.
 *
 * 2026-08-18 (PO-approved): label/color/tier now always come from
 * customerVerdict(wq) — the same 3-tier numeric mapping shown everywhere
 * else — no exceptions. This used to force the label AND color to
 * "Needs attention" / red whenever Compliance was FAIL/WARNING, regardless
 * of the numeric score, so a high-scoring reading could show a red
 * "Needs attention" box — confusing once color was made numeric-only
 * elsewhere. complianceOverride/complianceOverrideKind are kept (still
 * computed from status) so the separate compliance note below the score
 * (score.msg.complianceFailOverride/complianceWarningOverride, rendered
 * only on this Quality/publish path) still surfaces the "quality index is
 * not a safety clearance" message — that note is where the compliance
 * signal now lives, not the main tier label.
 */
function qualityPublishPresentation(wq, complianceStatus) {
  const status = String(complianceStatus || '').toUpperCase();
  const complianceOverride = status === 'FAIL' || status === 'WARNING';
  const complianceOverrideKind = status === 'FAIL' ? 'FAIL' : (status === 'WARNING' ? 'WARNING' : null);
  return { ...customerVerdict(wq), complianceOverride, complianceOverrideKind };
}

/**
 * PD-001 — Country Benchmark presentation verdict (pass-band language).
 * Presentation only: does not change engine math or numeric score.
 * Flat-100 ⇒ within pass band, not “Excellent” quality gradient.
 *
 * 2026-08-18 (PO-approved): label/color/tier now always come from the same
 * 3-tier numeric mapping — no exceptions. This used to let a FAIL/CRITICAL/
 * WARNING classification override the LABEL to compliance wording (e.g.
 * "Needs attention — compliance warning") even after color was already
 * made numeric-only, so the label and color could still visibly disagree
 * (a green/blue box still reading "Needs attention"). classifications/
 * engineKey are accepted for signature compatibility but no longer change
 * the result — kept so existing call sites don't need updating.
 */
function comparisonPresentationVerdict(wq, classifications, engineKey) {
  const n = Number(wq);
  if (!Number.isFinite(n)) return { label: '—', color: SCORE_BAR_COLORS.high, tier: 'pending' };
  return customerVerdictForEngine(n, engineKey);
}

/** True when the hero/summary number is the selected Country Benchmark comparison score. */
function isShowingCountryBenchmarkComparison() {
  if (S.publicScoreView) return false;
  const comparisonScore = activeComparisonResult()?.score;
  return Number.isFinite(Number(comparisonScore));
}

function scoreSummaryNote(wq, findings) {
  const attnCount = (findings || []).length;
  // 2026-08-18 (PO-approved): matches customerVerdict's tier boundaries (81+/51-80/0-50).
  if (wq >= 81) return t('score.msg.excellent');
  if (wq >= 51) return t('score.msg.goodDetail');
  if (attnCount > 0) {
    return t('score.msg.attentionDetail').replace('{n}', String(attnCount));
  }
  return t('score.msg.low');
}

let _scoreAnimToken = 0;
function animateScoreNumber(el, target) {
  if (!el) return;
  const token = ++_scoreAnimToken;
  const dur = 1100;
  const t0 = performance.now();
  function step(t) {
    if (token !== _scoreAnimToken) return; // superseded by a newer render
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
const SCORE_STANDARD_ORDER = Object.freeze(['thailand', 'eu', 'usEpa', 'who', 'japan']);

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

function scoreBarColorForScore(wq, verdict = null) {
  if (verdict?.color) return verdict.color;
  if (verdict?.tier && SCORE_BAR_COLORS[verdict.tier]) return SCORE_BAR_COLORS[verdict.tier];
  if (!Number.isFinite(Number(wq))) return SCORE_BAR_COLORS.pending;
  return customerVerdict(Number(wq)).color;
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
    readings,
    // Pre-validation values + per-field validator verdicts, so a row can
    // still show a captured-but-implausible number (e.g. DO = 70) instead
    // of a blank/pending cell (2026-08-17 fix).
    rawReadings: S.lastReadingsPresent || {},
    validationFields: S.lastReadingsValidation?.fields || null
  };
}

/** UI status: only values inside the selected standard's recommended band are Good. */
function paramStatusUiKey(status) {
  if (status === 'pending') return 'pending';
  if (status === 'implausible') return 'implausible';
  if (status === 'excluded') return 'excluded';
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

function renderScoreStatusBar(wq, { loading = false, incomplete = false, verdict = null } = {}) {
  const bar = document.getElementById('score-status-bar');
  const knob = document.getElementById('score-progress-knob');
  const segments = [
    { from: 0, to: 50, el: document.getElementById('score-seg-fill-0') },
    { from: 50, to: 80, el: document.getElementById('score-seg-fill-1') },
    { from: 80, to: 100, el: document.getElementById('score-seg-fill-2') }
  ];
  // Fill amount follows the numeric score; fill color follows the 3-tier verdict.
  const fillColor = scoreBarColorForScore(wq, verdict);
  if (bar) {
    bar.classList.toggle('is-loading', loading);
    bar.classList.toggle('is-incomplete', loading && incomplete);
    bar.style.setProperty('--score-bar-fill', fillColor);
    bar.dataset.tier = verdict?.tier || (Number.isFinite(Number(wq)) ? customerVerdict(Number(wq)).tier : 'pending');
    bar.setAttribute(
      'aria-label',
      loading
        ? t(incomplete ? 'score.readiness.incompleteTitle' : 'score.readiness.processingTitle')
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

/**
 * incomplete=true means "this engine structurally cannot compute a score
 * from what's currently available (e.g. a required measurement was
 * stripped as implausible, or the selected engine needs a parameter that
 * was never captured) — not "still capturing, wait a moment." The shimmer/
 * indeterminate-bar animations only make sense for the latter; showing them
 * indefinitely for the former reads as a stuck/broken page (2026-08-17 fix).
 */
function setScoreHeroLoading(loading, incomplete = false) {
  const card = document.querySelector('#score-hero .score-summary-card');
  const numEl = document.getElementById('gauge-val');
  const denEl = document.querySelector('#score-summary-score .score-summary-den');
  const loadingEl = document.getElementById('score-summary-loading');
  card?.classList.toggle('is-loading', loading);
  card?.classList.toggle('is-incomplete', loading && incomplete);
  if (loadingEl) loadingEl.hidden = !loading;
  if (numEl) numEl.hidden = loading;
  if (denEl) denEl.hidden = loading;
  if (loading && numEl) {
    // Cancel in-flight animateScoreNumber so a prior eligible score cannot
    // overwrite the incomplete placeholder (UJ-04 gauge stale).
    _scoreAnimToken += 1;
    numEl.textContent = '—';
  }
}

function activeComparisonResult() {
  return S.comparisonScoreResult || null;
}

function activeStandardKey() {
  return activeComparisonResult()?.standardKey || S.scoreStandardKey || DEFAULT_SCORE_STANDARD_KEY;
}

/** Fixed dropdown order: Thai, EU, US EPA, WHO, Japan (not sample score). */
function orderedStandardsForSelect() {
  const reg = benchmarkRegistry();
  return SCORE_STANDARD_ORDER.filter(key => reg?.has?.(key));
}

/** Spec shows the same Benchmark filter twice (hero + content) -- keep both in sync. */
function renderStandardSelect(context = getScoreEvalContext()) {
  const selected = context.selectedStandard;
  const order = orderedStandardsForSelect();
  const optionsHtml = order.map(key => {
    const standard = getWaterQualityStandard(key);
    return `<option value="${key}"${selected === key ? ' selected' : ''}>${t(standard.shortKey)}</option>`;
  }).join('');
  ['score-standard-select', 'score-standard-select-top'].forEach(id => {
    const selectEl = document.getElementById(id);
    if (!selectEl) return;
    selectEl.innerHTML = optionsHtml;
    selectEl.onchange = () => setScoreReferenceStandard(selectEl.value);
  });
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
  // UJ-04: Share visibility must derive from eligibility/publish state — not CSS-only.
  updateShareScoreAvailability({
    eligibility,
    alreadyPublished: Number.isFinite(Number(S.activeJob?.result?.waterScore)),
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

  // "Incomplete" (static, no shimmer) vs "loading" (spinner, actively
  // capturing) — genuinely distinct states (2026-08-17 fix). ocrBusy means a
  // photo is still being processed right now; anything else that leaves
  // showScore false (a required measurement missing/stripped for the
  // selected engine) can never resolve on its own, so it must not animate
  // as if it will.
  const incomplete = !showScore && !readiness?.ocrBusy;
  setScoreHeroLoading(!showScore, incomplete);

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
        noteEl.textContent = scoreSummaryNote(wq, findings);
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

  renderScoreStatusBar(showScore ? wq : 0, {
    loading: !showScore,
    incomplete,
    verdict: showScore ? verdict : null
  });
  if (!S.scoreTapFilter) {
    S.scoreTapFilter = (S.taps?.length || 0) > 1 ? 'all' : (S.taps?.[0] || 'all');
  }
  if (showScore) {
    animateScoreNumber(document.getElementById('gauge-val'), wq);
  } else {
    const gaugeEl = document.getElementById('gauge-val');
    if (gaugeEl && !gaugeEl.hidden) {
      _scoreAnimToken += 1;
      gaugeEl.textContent = '—';
    }
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
 *
 * Explicit clears (`null`) on meter/chlorine/standard are treated as missing
 * for that tap and must not resurrect via sibling layers (UJ-05).
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
    const vals = rows.map(row => {
      if (!row || !Object.prototype.hasOwnProperty.call(row, key)) return undefined;
      if (row[key] === null) return undefined;
      return numOrUndefined(row[key]);
    }).filter(v => v !== undefined);
    if (!vals.length) return undefined;
    return vals.reduce((sum, n) => sum + n, 0) / vals.length;
  };

  /** Keys explicitly cleared on every tap that had that key — block field fallback. */
  const explicitClears = new Set();
  const trackClears = (rows, key, alias) => {
    const target = alias || key;
    const owned = rows.filter(row => row && Object.prototype.hasOwnProperty.call(row, key));
    if (!owned.length) return;
    if (owned.every(row => row[key] === null)) explicitClears.add(target);
  };
  ['ph', 'tds', 'turbidity', 'orp', 'do', 'temp'].forEach(key => {
    trackClears(meterRows, key);
    trackClears(standardRows, key);
  });
  trackClears(chlorineRows, 'freeChlorine', 'chlorine');
  trackClears(chlorineRows, 'chlorine', 'chlorine');
  trackClears(standardRows, 'chlorine', 'chlorine');

  const resolved = {
    ph: avgKey(standardRows, 'ph') ?? avgKey(meterRows, 'ph'),
    tds: avgKey(standardRows, 'tds') ?? avgKey(meterRows, 'tds'),
    turbidity: avgKey(standardRows, 'turbidity') ?? avgKey(meterRows, 'turbidity'),
    orp: avgKey(standardRows, 'orp') ?? avgKey(meterRows, 'orp'),
    do: avgKey(standardRows, 'do') ?? avgKey(meterRows, 'do'),
    temp: avgKey(standardRows, 'temp') ?? avgKey(meterRows, 'temp'),
    chlorine: avgKey(standardRows, 'chlorine') ?? avgKey(chlorineRows, 'freeChlorine') ?? avgKey(chlorineRows, 'chlorine')
  };
  resolved.__explicitClears = explicitClears;
  return resolved;
}

function mergeReadingLayers(...layers) {
  const keys = ['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do', 'temp'];
  const out = {};
  const blocked = new Set();
  layers.forEach(layer => {
    if (layer?.__explicitClears instanceof Set) {
      layer.__explicitClears.forEach(key => blocked.add(key));
    }
  });
  keys.forEach(key => {
    if (blocked.has(key)) return;
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

// 'temp' deliberately excluded — computeQualityScoreDetail() never uses it
// (see computeQualityScoreV2.js's notScored list). Readiness must gate on
// exactly the parameters the score formula actually consumes, not on every
// field the form happens to display; requiring temp here blocked Complete
// on Cases where all 6 scored parameters were valid and a real score could
// already be computed — a genuine data-completeness/score-readiness mixup,
// not an intentional business rule (forensic investigation, 2026-08-25).
// Temp itself is unchanged elsewhere: still captured, still shown in the
// report — it's just no longer required to reach Complete.
const SCORE_READY_KEYS = Object.freeze(['ph', 'tds', 'chlorine', 'turbidity', 'orp', 'do']);

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
  // Raw, pre-validation values — kept only so a stripped-as-implausible
  // reading can still be SHOWN (with a "too high to calculate" note)
  // instead of silently vanishing from the parameter list (2026-08-17 fix).
  S.lastReadingsPresent = present;

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
  const pick = (stdVal, meterVal) => {
    // Explicit clear on either layer → missing (do not fall back).
    if (stdVal === null || meterVal === null) return undefined;
    return numOrUndefined(stdVal ?? meterVal);
  };
  const mapped = {
    ph: pick(standard?.ph, meter.ph),
    tds: pick(standard?.tds, meter.tds),
    turbidity: pick(standard?.turbidity, meter.turbidity),
    orp: pick(standard?.orp, meter.orp),
    do: pick(standard?.do, meter.do),
    temp: pick(standard?.temp, meter.temp),
    chlorine: (() => {
      if (standard && Object.prototype.hasOwnProperty.call(standard, 'chlorine') && standard.chlorine === null) {
        return undefined;
      }
      if (Object.prototype.hasOwnProperty.call(chlorine, 'freeChlorine') && chlorine.freeChlorine === null) {
        return undefined;
      }
      if (Object.prototype.hasOwnProperty.call(chlorine, 'chlorine') && chlorine.chlorine === null) {
        return undefined;
      }
      return numOrUndefined(standard?.chlorine ?? (chlorine.freeChlorine ?? chlorine.chlorine));
    })()
  };
  // Keys the operator explicitly cleared must not be refilled from Hero/base.
  const cleared = new Set();
  const markClear = (key, ...vals) => {
    if (vals.some(v => v === null)) cleared.add(key);
  };
  markClear('ph', standard?.ph, meter.ph);
  markClear('tds', standard?.tds, meter.tds);
  markClear('turbidity', standard?.turbidity, meter.turbidity);
  markClear('orp', standard?.orp, meter.orp);
  markClear('do', standard?.do, meter.do);
  markClear('temp', standard?.temp, meter.temp);
  markClear('chlorine', standard?.chlorine, chlorine.freeChlorine, chlorine.chlorine);
  const realFallback = Object.fromEntries(
    Object.entries(fallback || {})
      .filter(([key, v]) => !cleared.has(key) && Number.isFinite(Number(v)))
  );
  return { ...realFallback, ...Object.fromEntries(Object.entries(mapped).filter(([, v]) => v !== undefined)) };
}

/** True when a tap has any Standard (Layer 2) or legacy reading with a real number. */
function hasTapReadingSource(tap) {
  const hasFinite = (row) => row && typeof row === 'object'
    && Object.values(row).some(v => v !== null && Number.isFinite(typeof v === 'number' ? v : parseFloat(v)));
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

  if (tapKey === 'all') {
    // Average only taps with real measurements — never synthesize offsets for
    // empty rooms (UJ-07: All Locations must not invent values Hero never saw).
    const rows = taps.map((_, i) => {
      const tap = tapData[i];
      if (!hasTapReadingSource(tap)) return null;
      return readingsFromSingleTap(tap, {});
    }).filter(row => row && SCORE_READY_KEYS.some(key => Number.isFinite(Number(row?.[key]))));
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
    return readingsFromSingleTap(tap, {});
  }
  // Single room with no snapshot: show the case-resolved readings (Hero input),
  // never synthetic per-room deltas.
  return { ...base };
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

  // A value the validator stripped as physically implausible (e.g. DO = 70,
  // beyond the sensor guard) must still be shown — with a "too high to
  // calculate" note — instead of reading as blank/pending forever
  // (2026-08-17 fix). Row-level fallback only; scoring math is unaffected.
  const rawReadings = context.rawReadings || {};
  const validationFields = context.validationFields || null;
  const buildRow = (key, label, computedVal, fmtFn, std, status) => {
    if (!Number.isFinite(computedVal) && validationFields?.[key]?.state === 'IMPLAUSIBLE') {
      const rawVal = toFin(rawReadings[key]);
      if (Number.isFinite(rawVal)) {
        return { p: label, r: fmtFn(rawVal), std, st: 'implausible' };
      }
    }
    // A real value is present, but this standard's engine deliberately never
    // scores this param (e.g. Thailand excludes DO/Temp, Japan excludes DO —
    // statusOf() always answers 'pending' for them regardless of the value).
    // That is not "still loading" — show the measured value with a neutral
    // "not scored here" note instead of shimmering forever (2026-08-17 fix).
    if (status === 'pending' && Number.isFinite(computedVal)) {
      return { p: label, r: fmtFn(computedVal), std, st: 'excluded' };
    }
    return { p: label, r: fmtFn(computedVal), std, st: status };
  };

  return [
    buildRow('ph', 'pH', ph, (n) => fmt(n, 1), stdLabel(display.ph), evaluateParamStatus('ph', ph, standardKey)),
    buildRow('tds', 'TDS', tds, (n) => fmtInt(n, ' mg/L'), stdLabel(display.tds), evaluateParamStatus('tds', tds, standardKey)),
    buildRow('chlorine', 'Chlorine', chlorine, (n) => fmt(n, 1, ' mg/L'), stdLabel(display.chlorine), evaluateParamStatus('chlorine', chlorine, standardKey)),
    buildRow('turbidity', 'Turbidity', turbidity, (n) => fmt(n, 1, ' NTU'), stdLabel(display.turbidity), evaluateParamStatus('turbidity', turbidity, standardKey)),
    buildRow('orp', 'ORP', orp, (n) => fmtInt(n, ' mV'), stdLabel(display.orp), evaluateParamStatus('orp', orp, standardKey)),
    buildRow('do', 'DO', doVal, (n) => fmt(n, 1, ' mg/L'), stdLabel(display.do), evaluateParamStatus('do', doVal, standardKey)),
    buildRow('temp', 'Temp', temp, (n) => fmt(n, 1, '°C'), stdLabel(display.temp), evaluateParamStatus('temp', temp, standardKey))
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
    pending: t('score.status.pending'),
    implausible: t('score.status.implausible'),
    excluded: t('score.status.excluded')
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
    <p class="score-metric-meaning">${statusKey === 'implausible' ? t('score.meaning.implausible') : statusKey === 'excluded' ? t('score.meaning.excluded') : paramMeaningText(r.p, statusKey === 'good' ? 'good' : 'attn')}</p>
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
      images.push({ label, src, tap: taps[i] });
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
  track.innerHTML = images.map((img, i) => `<div class="score-photo-slide" data-slide-index="${i}"><img src="${img.src}" alt="${img.label}" draggable="false" loading="lazy"></div>`).join('');
  const showDots = images.length > 1;
  dotsEl.hidden = !showDots;
  dotsEl.innerHTML = images.map((_, i) =>
    `<button type="button" class="score-photo-dot${i === 0 ? ' is-active' : ''}" aria-label="Photo ${i + 1} of ${images.length}" data-photo-index="${i}"></button>`
  ).join('');

  // A stored photo reference that fails to actually load (expired/mismatched
  // Drive link, etc.) must not sit in the carousel as a solid broken-image
  // box -- drop that one slide (and its dot) instead. If every slide fails,
  // fall back to the "no photo yet" placeholder like nothing was captured.
  track.querySelectorAll('.score-photo-slide img').forEach(imgEl => {
    imgEl.onerror = () => {
      const slide = imgEl.closest('.score-photo-slide');
      const idx = Number(slide?.dataset.slideIndex);
      slide?.remove();
      dotsEl.querySelector(`[data-photo-index="${idx}"]`)?.remove();
      const remaining = track.querySelectorAll('.score-photo-slide').length;
      dotsEl.hidden = remaining <= 1;
      if (!remaining) {
        wrap.hidden = true;
        if (placeholder) {
          placeholder.hidden = false;
          if (placeholderText) placeholderText.textContent = t('score.readiness.photosPending');
        }
      }
    };
  });

  // A swiped-to photo belongs to one specific room's readings -- when browsing
  // "All locations", follow the visible photo so the metric list below always
  // matches what's on screen instead of staying on the aggregate, which would
  // otherwise read as a mismatch to a customer comparing photo vs numbers.
  let syncedTap = null;
  const syncReadingsToPhoto = (idx) => {
    // Once a swipe has taken over the filter, keep following swipes even
    // though scoreTapFilter is no longer 'all' -- only a manual dropdown
    // pick (setScoreTapFilter, which clears this flag) should stop it.
    if (S.scoreTapFilter !== 'all' && !S._scorePhotoAutoSynced) return;
    const tap = images[idx]?.tap;
    if (!tap || tap === syncedTap) return;
    syncedTap = tap;
    S.scoreTapFilter = tap;
    S._scorePhotoAutoSynced = true;
    const context = getScoreEvalContext();
    renderScoreReadings(context);
    renderScoreImprove(context);
    ['score-room-select', 'score-room-select-top'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = tap;
    });
  };

  const activeSlideIndex = () => {
    const width = track.clientWidth || 1;
    return Math.max(0, Math.min(images.length - 1, Math.round(track.scrollLeft / width)));
  };

  const highlightActiveDot = () => {
    const idx = activeSlideIndex();
    Array.from(dotsEl.children).forEach((d, i) => d.classList.toggle('is-active', i === idx));
  };

  // Only a genuine user swipe (the scroll listener below) should hand the
  // filter over to a room's photo -- an unconditional call on every render
  // (e.g. right after the user picks a different room from the dropdown)
  // could immediately fight that manual pick back to whatever room the
  // carousel happens to be sitting on.
  const syncDots = () => {
    highlightActiveDot();
    syncReadingsToPhoto(activeSlideIndex());
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

  // Keep swipe feel stable after re-render. Dot highlight only -- does not
  // touch scoreTapFilter, so a render triggered by picking a room from the
  // dropdown can never get immediately overridden here.
  requestAnimationFrame(() => {
    track.scrollLeft = 0;
    highlightActiveDot();
  });
}

/** Location filter now lives only in the hero row (removed from the duplicate below). */
function renderLocationSelect() {
  const taps = S.taps?.length ? S.taps : [];
  const pairs = [
    ['score-room-select-wrap-top', 'score-room-select-top']
  ];

  if (taps.length <= 1) {
    pairs.forEach(([wrapId]) => document.getElementById(wrapId)?.classList.add('hidden'));
    return;
  }

  const allLabel = `${t('score.allLocations')} (${taps.length})`;
  const options = [{ key: 'all', label: allLabel }, ...taps.map(tap => ({ key: tap, label: tap }))];
  const optionsHtml = options.map(opt =>
    `<option value="${opt.key}"${S.scoreTapFilter === opt.key ? ' selected' : ''}>${opt.label}</option>`
  ).join('');

  pairs.forEach(([wrapId, selectId]) => {
    const wrap = document.getElementById(wrapId);
    const selectEl = document.getElementById(selectId);
    if (!wrap || !selectEl) return;
    wrap.classList.remove('hidden');
    selectEl.innerHTML = optionsHtml;
    selectEl.onchange = () => setScoreTapFilter(selectEl.value);
  });
}

function setScoreTapFilter(key) {
  const context = getScoreEvalContext();
  S.scoreTapFilter = key;
  S._scorePhotoAutoSynced = false;
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
    btn.disabled = btn.dataset.shareBlocked === '1';
    if (btn.dataset.shareLabel !== undefined) {
      btn.textContent = btn.dataset.shareLabel;
      delete btn.dataset.shareLabel;
    }
  }
}

/**
 * NOT_ELIGIBLE ⇒ cannot share / publish a score card (UJ-04).
 * Already-published reports remain shareable so clients can re-open the link.
 */
function updateShareScoreAvailability({ eligibility, alreadyPublished, showScore } = {}) {
  const btn = document.querySelector('#s-score .hdr-action');
  if (!btn) return;
  const canShare = Boolean(alreadyPublished)
    || (
      Boolean(showScore)
      && (!eligibility || eligibility.canCalculateScore !== false)
    );
  btn.dataset.shareBlocked = canShare ? '0' : '1';
  btn.hidden = !canShare;
  btn.disabled = !canShare;
  btn.setAttribute('aria-disabled', canShare ? 'false' : 'true');
  if (!canShare) {
    btn.title = eligibility?.reason || (typeof t === 'function' ? t('score.readiness.waitingBadge') : 'Not eligible to share');
  } else {
    btn.removeAttribute('title');
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
