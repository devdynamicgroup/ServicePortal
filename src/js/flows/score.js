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

// 2026-10-08: FAIL now displays as "Fair" (#ffb266), not the red "Attention"
// tier (see PARAM_CLASSIFICATION_UI_STATUS), so it no longer trips the
// attention banner here -- only CRITICAL/INCOMPLETE do. Presentation-only;
// does not change which rooms are complete or how they are scored.
/** True when any room is CRITICAL or INCOMPLETE. */
function roomStatusesNeedAttention(rooms) {
  return (rooms || []).some((room) => {
    const status = room && room.status;
    return status === 'CRITICAL' || status === 'INCOMPLETE' || room.incomplete === true;
  });
}

function missingParameterLabel(key) {
  if (key === 'chlorine') return t('score.missing.chlorine');
  if (key === 'do') return t('score.missing.do');
  if (key === 'ph') return 'pH';
  if (key === 'tds') return 'TDS';
  if (key === 'turbidity') return t('score.missing.turbidity');
  if (key === 'orp') return 'ORP';
  return String(key || '');
}

function escapeScoreText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Country status for every tap. Headline aggregation is unchanged. */
function collectRoomCountryStatuses(job, standardKey) {
  const taps = resolveJobTapDataForScore(job) || [];
  const names = (Array.isArray(S.taps) && S.taps.length === taps.length)
    ? S.taps
    : taps.map((_, index) => `Room ${index + 1}`);
  const reg = benchmarkRegistry();
  const key = reg?.has?.(standardKey) ? standardKey : DEFAULT_SCORE_STANDARD_KEY;
  if (!reg?.calculate) return [];
  return taps.map((tap, index) => {
    const readings = readingsFromTapData([tap]);
    const result = reg.calculate(key, readings);
    const incomplete = Boolean(result.measurementIncomplete)
      || result.complete === false
      || !Number.isFinite(Number(result.score));
    const status = incomplete
      ? 'INCOMPLETE'
      : (typeof worstBenchmarkClassification === 'function'
        ? worstBenchmarkClassification(result.classifications)
        : 'PASS');
    return {
      label: names[index] || `Room ${index + 1}`,
      status,
      incomplete,
      missingParameters: Array.isArray(result.missingParameters) ? result.missingParameters : [],
      score: Number.isFinite(Number(result.score)) ? Number(result.score) : null
    };
  });
}

function renderRoomStatusList() {
  const root = document.getElementById('score-room-status');
  if (!root) return;
  const rooms = Array.isArray(S.roomCountryStatuses) ? S.roomCountryStatuses : [];
  if (!rooms.length || rooms.length < 2) {
    root.hidden = true;
    root.textContent = '';
    return;
  }
  const selected = S.scoreTapFilter;
  const items = rooms.map((room) => {
    const selectedClass = selected && selected !== 'all' && selected === room.label ? ' is-selected' : '';
    return `<li class="score-room-status-item${selectedClass}"><span>${escapeScoreText(room.label)}</span><span>${escapeScoreText(customerStatusLabel(room.status))}</span></li>`;
  }).join('');
  const banner = roomStatusesNeedAttention(rooms)
    ? `<p class="score-room-status-banner">${escapeScoreText(t('score.household.banner'))}</p>`
    : '';
  root.hidden = false;
  root.innerHTML = `<p class="score-room-status-title">${escapeScoreText(t('score.roomStatus.title'))}</p>${banner}<ul class="score-room-status-list">${items}</ul>`;
}

function renderBenchmarkLine(comparison) {
  const line = document.getElementById('score-benchmark-line');
  if (!line) return;
  if (!comparison || !Number.isFinite(Number(comparison.score))) {
    line.hidden = true;
    line.textContent = '';
    return;
  }
  const name = comparison.standard?.shortKey ? t(comparison.standard.shortKey) : (comparison.engine || '');
  const status = comparison.measurementIncomplete
    ? 'INCOMPLETE'
    : (typeof worstBenchmarkClassification === 'function' && comparison.classifications
      ? worstBenchmarkClassification(comparison.classifications)
      : '');
  const missing = (comparison.missingParameters || []).map(missingParameterLabel).filter(Boolean);
  const missingText = missing.length
    ? ` ${t('score.benchmark.missing').replace('{params}', missing.join(', '))}`
    : '';
  line.hidden = false;
  line.textContent = `${t('score.benchmark.row').replace('{name}', name).replace('{score}', String(comparison.score))} · ${t('score.benchmark.status').replace('{status}', customerStatusLabel(status))}${missingText}`;
}

/** Primary gauge is Quality. Country benchmark is the secondary row, not the hero number. */
function isShowingCountryBenchmarkComparison() {
  return false;
}

function scoreSummaryNote(wq, findings, roomStatuses) {
  // 2026-08-18 (PO-approved): matches customerVerdict's tier boundaries (81+/51-80/0-50).
  if (wq >= 81) {
    if (roomStatusesNeedAttention(roomStatuses)) return t('score.msg.reviewRooms');
    if (passesEveryCountryBenchmark(wq)) return t('score.share.note.optimal');
    return t('score.msg.excellent');
  }
  if (wq >= BENCHMARK_OVERALL_PASS_MIN.thailand) return t('score.passesThai');
  if (wq >= 51) return t('score.share.note.fair');
  return t('score.share.note.attention');
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
    measurementIncomplete: Boolean(scored.measurementIncomplete),
    missingParameters: Array.isArray(scored.missingParameters) ? scored.missingParameters.slice() : [],
    severityProtection: scored.severityProtection || null,
    countryGate: scored.countryGate || null,
    rawAggregate: Number.isFinite(scored.rawAggregate) ? scored.rawAggregate : null,
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

/** Frozen publication integer. Null when this Case has no published score. */
function publishedWaterScore(job = S.activeJob) {
  const raw = job?.result?.waterScore;
  if (raw == null || raw === '' || !Number.isFinite(Number(raw))) return null;
  return Math.max(0, Math.min(100, Math.round(Number(raw))));
}

/** Frozen publication compliance. Null stays null — never filled from live readings. */
function publishedComplianceStatus(job = S.activeJob) {
  const raw = job?.result?.complianceStatus;
  if (raw == null || String(raw).trim() === '') return null;
  return String(raw);
}

/**
 * Score the user actually sees in #gauge-val.
 *
 * Staff: Quality V3. Customer publication: frozen published score.
 * Country benchmark stays on `comparison` and is never the primary fallback.
 */
function resolveDisplayedScore({
  publicView = false,
  publishedScore = null,
  qualityScore = null,
  readings = {},
  standardKey = DEFAULT_SCORE_STANDARD_KEY
} = {}) {
  const comparison = getCountryBenchmarkScore(readings, standardKey);
  const publishedNumber = Number(publishedScore);
  const qualityNumber = Number(qualityScore);
  const published = publicView && publishedScore != null && publishedScore !== '' && Number.isFinite(publishedNumber);
  const primary = published
    ? Math.max(0, Math.min(100, Math.round(publishedNumber)))
    : (qualityScore != null && qualityScore !== '' && Number.isFinite(qualityNumber)
      ? Math.max(0, Math.min(100, Math.round(qualityNumber)))
      : null);
  return {
    score: primary,
    source: published ? 'published' : 'quality-v3',
    standardKey: 'quality-v3',
    engineKey: 'quality-v3',
    showScore: primary != null,
    comparison,
    classifications: null
  };
}

/**
 * The number at the top is always the overall Quality / published score.
 * Choosing an inspection point changes that point's rows, not this number.
 */
function staffHeroForPopulation(displayed) {
  return displayed;
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
  // Measurement rows keep the whole-house pool as their empty-zone fallback.
  // The country score for a selected zone lives on comparisonScoreResult, not here.
  const houseReadings = S.scoreBaseReadings && Object.keys(S.scoreBaseReadings).length
    ? S.scoreBaseReadings
    : null;
  const readings = houseReadings || result?.readings || S.currentScoreResult?.readings || {};
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
  if (status === 'fair') return 'fair';
  return status === 'good' ? 'good' : 'attn';
}

/**
 * Customer-facing parameter status (presentation only): the engine's internal
 * PASS / WARNING / FAIL / CRITICAL classification is read here, never changed,
 * and never shown as a label. Only three states reach the UI.
 */
// 2026-10-08 (product request): widen "Fair" to cover FAIL as well as
// WARNING -- FAIL cases (e.g. chlorine out of range but not dangerous) were
// reading as the same alarming red as CRITICAL. Only CRITICAL stays
// "Attention" red. This is a presentation-only remap -- the engine's
// PASS/WARNING/FAIL/CRITICAL classification, thresholds, and scoring are
// unchanged.
const PARAM_CLASSIFICATION_UI_STATUS = Object.freeze({
  PASS: 'good',
  WARNING: 'fair',
  FAIL: 'fair',
  CRITICAL: 'attn'
});

/** Customer-facing label for an internal classification. Values outside the four (e.g. INCOMPLETE) pass through unchanged. */
function customerStatusLabel(classification) {
  const key = PARAM_CLASSIFICATION_UI_STATUS[String(classification || '').toUpperCase()];
  return key ? t(`score.status.${key}`) : String(classification ?? '');
}

/** Rows the engine did not classify (not measured / not evaluated / incomplete) keep their existing status. */
function paramStatusFromClassification(status, classification) {
  if (status !== 'good' && status !== 'attn') return status;
  return PARAM_CLASSIFICATION_UI_STATUS[classification] || status;
}

function paramKey(paramName) {
  return String(paramName || '').toLowerCase();
}

/** One-line status hint shown on the collapsed metric row. */
// 2026-10-09 (customer-facing explanation refinement, Option A — display
// text only, no classification/threshold/score change): chlorine's non-good
// explanation used to say "Elevated chlorine may affect taste and smell"
// even when the actual reading was at or near zero (no residual detected at
// all) -- the opposite problem from "elevated". `rawValue`, when given, lets
// this pick the direction-correct wording for chlorine specifically; every
// other parameter's wording is unchanged. CHLORINE_NONE_DETECTED_MAX is a
// display-only wording cutoff, independent of and does not alter any
// country engine's min/max compliance threshold.
const CHLORINE_NONE_DETECTED_MAX = 0.1;
function paramCollapsedHint(paramName, status, rawValue) {
  if (status === 'good') return t('score.explain.withinRange');
  const key = paramKey(paramName);
  if (key === 'ph') return t('score.impact.ph');
  if (key === 'tds') return t('score.impact.tds');
  if (key === 'chlorine') {
    return Number.isFinite(rawValue) && rawValue < CHLORINE_NONE_DETECTED_MAX
      ? t('score.impact.chlorine.none')
      : t('score.impact.chlorine');
  }
  if (key === 'turbidity') return t('score.impact.turbidity');
  if (key === 'orp') return t('score.impact.orp');
  if (key === 'do') return t('score.impact.do');
  if (key === 'temp') return t('score.impact.temp');
  return t('score.impact.default');
}

/** Expanded “Meaning” line — calm wording for good rows, impact for attention. */
function paramMeaningText(paramName, status, rawValue) {
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
  return paramCollapsedHint(paramName, status, rawValue);
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

/** Visual only. Same 0–100 scale: 80 is the international mark on this card. */
function paintScoreDotField(score, {
  loading = false,
  tier = 'mid',
  rowsId = 'score-dot-rows',
  fieldId = 'score-dot-field',
  tickId = 'score-tick-live',
  rowCount = 1,
  dotsPerRow = 0,
  markIndex = -1,
  pinBadge = false
} = {}) {
  const field = document.getElementById(fieldId);
  const rows = document.getElementById(rowsId);
  const live = document.getElementById(tickId);
  if (!field || !rows) return;
  const COUNT = 40;
  const bands = rowCount > 1 ? 2 : 1;
  const perRow = dotsPerRow > 0 ? dotsPerRow : COUNT / bands;
  const palette = tier === 'high'
    ? ['#284DCD', '#3D6AE1', '#467EEB']
    : tier === 'low'
      ? ['#f07b7b', '#f7b0b0', '#fde2e2']
      : tier === 'fair'
        ? ['#E0A04A', '#F2C56B', '#F8E3B0']
        : ['#69A1F1', '#99C2F7', '#C3D9FA'];
  const safe = Math.max(0, Math.min(100, Number(score) || 0));
  const idx = markIndex >= 0
    ? Math.max(0, Math.min(perRow - 1, markIndex))
    : Math.round((safe / 100) * (perRow - 1));
  const html = [];
  for (let band = 0; band < bands; band++) {
    const dots = [];
    for (let i = 0; i < perRow; i++) {
      const offset = loading ? 99 : i - idx;
      const spread = tier === 'fair'
        ? ['#F8B4B4', '#F5CC81', '#F2BF61', '#F2BF61', '#F2BF61', '#C3D9FA', '#99C2F7']
        : tier === 'low'
          ? ['#F8B4B4', '#F8B4B4', '#F58C8C', '#F58C8C', '#F58C8C', '#F2BF61', '#F2BF61']
          : null;
      const nextCluster = tier === 'high' && markIndex >= 0 && offset >= -3 && offset <= 3;
      const color = spread && offset >= -3 && offset <= 3
        ? spread[offset + 3]
        : nextCluster
          ? (Math.abs(offset) <= 1 ? '#284DCD' : Math.abs(offset) === 2 ? '#3D6AE1' : '#467EEB')
          : (Math.abs(offset) === 0 ? palette[0] : Math.abs(offset) <= 2 ? palette[1] : Math.abs(offset) === 3 ? palette[2] : '#E7E5E1');
      dots.push(`<svg class="score-pip${i === idx && !loading ? ' is-mark' : ''}" viewBox="0 0 8 8" width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="3.5" fill="${color}"/></svg>`);
    }
    html.push(`<span class="score-pip-row">${dots.join('')}</span>`);
  }
  rows.innerHTML = html.join('');
  const pin = markIndex >= 0 || pinBadge;
  field.style.setProperty(
    '--score-pct',
    pin
      ? `calc(${idx} * (100% - 8px) / ${perRow - 1} + 4px)`
      : `${safe}%`
  );
  field.classList.toggle('is-loading', loading);
  if (live) {
    const rounded = Math.round(safe);
    const crowded = loading || Math.abs(safe - 80) < 6 || safe < 6 || safe >= 90;
    live.textContent = crowded ? '' : String(rounded);
    live.hidden = crowded;
    if (pin) {
      live.style.left = `calc(${idx} * (100% - 8px) / ${perRow - 1} + 4px)`;
      live.style.transform = 'translateX(-50%)';
    } else {
      live.style.left = `${safe}%`;
      live.style.transform = safe < 18 ? 'translateX(0)' : 'translateX(calc(-100% - 10px))';
    }
  }
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
    paintScoreDotField(0, { loading: true, tier: 'pending', rowCount: 2, dotsPerRow: 33 });
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
  paintScoreDotField(score, {
    loading: false,
    tier: verdict?.tier || 'mid',
    rowCount: 2,
    dotsPerRow: 33,
    pinBadge: true
  });
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

function formatScoreContextDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

function scorePlaceLabel(addr, city) {
  const parts = String(addr || '')
    .split(',')
    .map(part => part.replace(/\b\d{5}\b/g, '').trim())
    .filter(part => part && /[A-Za-z\u0E00-\u0E7F]/.test(part));
  if (parts.length >= 2) return parts[1];
  return parts[0] || String(city || '').trim();
}

function scorePropertyShort(value) {
  const raw = String(value || '').trim();
  if (/condo/i.test(raw)) return 'Condo';
  if (/town/i.test(raw)) return 'Townhome';
  if (/house/i.test(raw)) return 'House';
  return raw;
}

function renderScoreContextLine(job = S.activeJob) {
  const line = document.getElementById('score-context-line');
  if (!line) return;
  if (!S.publicScoreView) {
    const text = String(job?.name || '').trim();
    line.textContent = text;
    line.hidden = !text;
    return;
  }
  const fields = job?.draft?.fields || {};
  const firstPlace = String(fields['ci-addr'] || '')
    .split(',')
    .map(part => part.replace(/\b\d{5}\b/g, '').trim())
    .find(part => part && /[A-Za-z\u0E00-\u0E7F]/.test(part));
  const place = firstPlace || scorePlaceLabel(fields['ci-addr'], fields['ci-city']) || String(job?.name || '').trim();
  const property = scorePropertyShort(fields['ci-proptype']);
  const date = formatScoreContextDate(job?.date || job?.draft?.date);
  const text = [place, property, date].filter(Boolean).join(' · ');
  line.textContent = text;
  line.hidden = !text;
}

const SCORE_BOARD_ORDER = Object.freeze(['thailand', 'who', 'eu', 'usEpa', 'japan']);

/** Overall score floor for "Pass" on the standards board. The country number stays off the page. */
const BENCHMARK_OVERALL_PASS_MIN = Object.freeze({
  thailand: 65,
  who: 70,
  eu: 75,
  usEpa: 80,
  japan: 85
});

function benchmarkBoardStatus(key, overallScore) {
  const min = BENCHMARK_OVERALL_PASS_MIN[key];
  const score = Number(overallScore);
  if (!Number.isFinite(score) || !Number.isFinite(min)) return 'pending';
  return score >= min ? 'good' : 'fair';
}

/** Customer share board only. Pass, then a near miss, then clearly out. Does not change the score. */
function passesEveryCountryBenchmark(score) {
  return SCORE_BOARD_ORDER.every(key => customerBoardStatus(key, score) === 'good');
}

function customerBoardStatus(key, overallScore) {
  const min = BENCHMARK_OVERALL_PASS_MIN[key];
  const score = Number(overallScore);
  if (!Number.isFinite(score) || !Number.isFinite(min)) return 'pending';
  if (score >= min) return 'good';
  if (min - score <= 25) return 'fair';
  return 'attn';
}

/**
 * Labels on the shared Full Assessment page. The number stays the published score.
 * 81+ Optimal, 65–80 Good, 51–64 Fair, below 51 Needs attention.
 */
function customerShareCopy(score) {
  const n = Number(score);
  if (n >= 81) {
    return { key: 'optimal', tier: 'high', label: t('score.share.optimal'), note: t('score.share.note.optimal'), color: '#284dcd' };
  }
  if (n >= BENCHMARK_OVERALL_PASS_MIN.thailand) {
    return { key: 'good', tier: 'mid', label: t('score.verdict.good'), note: t('score.share.note.good'), color: '#69A1F1' };
  }
  if (n >= 51) {
    return { key: 'fair', tier: 'fair', label: t('score.share.fair'), note: t('score.share.note.fair'), color: '#E0A04A' };
  }
  return { key: 'attention', tier: 'low', label: t('score.verdict.attention'), note: t('score.share.note.attention'), color: '#f07b7b' };
}

function scoreStandardMark(kind) {
  if (kind === 'good') {
    return '<span class="score-std-mark is-good" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="8" fill="#284DCD"/><path d="M4.6 8.2 6.8 10.3 11.4 5.7" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  }
  if (kind === 'fair' || (kind === 'attn' && S.publicScoreView)) {
    return '<span class="score-std-mark is-fair" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6.15" fill="none" stroke="#69A1F1" stroke-width="1.7"/><path fill="#69A1F1" d="M8 4 11.5 7.5H9V11.5H7V7.5H4.5Z"/></svg></span>';
  }
  if (kind === 'pending') {
    return '<span class="score-std-mark is-pending" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6.7" fill="none" stroke="#E7E5E1" stroke-width="1.5"/></svg></span>';
  }
  return '<span class="score-std-mark is-attn" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="6.7" fill="none" stroke="#f07b7b" stroke-width="1.5"/><path d="M8 5.2v3.6M8 11.2h.01" fill="none" stroke="#f07b7b" stroke-width="1.4" stroke-linecap="round"/></svg></span>';
}

function readingsForScoreBoard(fallback) {
  const pooled = S.currentScoreResult?.readings || S.scoreBaseReadings;
  const hasNumber = (bag) => bag && Object.keys(bag).some(name => Number.isFinite(Number(bag[name])));
  if (hasNumber(pooled)) return pooled;
  const all = typeof getRoomReadings === 'function' ? getRoomReadings('all') : null;
  if (hasNumber(all)) return all;
  if (hasNumber(fallback)) return fallback;
  return all || fallback || pooled || {};
}

/** A real inspection point. The overall score stays on the card above. */
function scorePointFilter() {
  const taps = S.taps?.length ? S.taps : [];
  if (S.scoreTapFilter && S.scoreTapFilter !== 'all' && (!taps.length || taps.includes(S.scoreTapFilter))) {
    return S.scoreTapFilter;
  }
  return taps[0] || 'all';
}

/** Same status words as the old benchmark line: Good / Fair / Attention. Read-only. */
function renderStandardsBoard(readings) {
  const root = document.getElementById('score-standards');
  const list = document.getElementById('score-standards-list');
  if (!root || !list) return;
  const reg = benchmarkRegistry();
  if (!reg?.calculate || !readings) {
    root.hidden = true;
    list.textContent = '';
    return;
  }
  const selected = benchmarkRegistry()?.has?.(S.scoreStandardKey) ? S.scoreStandardKey : DEFAULT_SCORE_STANDARD_KEY;
  const overall = Number(S.displayedScore?.score ?? S.scoreVal);
  const rows = SCORE_BOARD_ORDER.filter(key => reg.has?.(key)).map(key => {
    const uiKey = S.publicScoreView ? customerBoardStatus(key, overall) : benchmarkBoardStatus(key, overall);
    const label = uiKey === 'good'
      ? t('score.std.pass')
      : uiKey === 'attn'
        ? t('score.std.out')
        : (uiKey === 'pending' ? t('score.status.pending') : t('score.std.slight'));
    const right = label;
    const name = t(`score.board.${key}`);
    const selectedClass = key === selected ? ' is-selected' : '';
    return `<div class="score-std-row${selectedClass}">
      <span class="score-std-name">${scoreStandardMark(uiKey)}<span>${escapeScoreText(name)}</span></span>
      <span class="score-std-label is-${uiKey}">${escapeScoreText(right)}</span>
    </div>`;
  });
  if (!rows.length) {
    root.hidden = true;
    list.textContent = '';
    return;
  }
  list.innerHTML = rows.join('<i class="score-std-line"></i>');
  root.hidden = false;
}

function renderScoreDisplay() {
  const result = activeComparisonResult();
  if (!result) return;

  const context = getScoreEvalContext(result);
  const readiness = getScoreDataReadiness(S.activeJob);
  // Eligibility still describes missing production inputs (publish/share).
  // Staff All keeps Quality V3. A named zone shows that zone's country score.
  // A customer publication keeps its frozen score.
  const eligibility = isPublishedScoreView(S.activeJob)
    ? (typeof EligibilityContract !== 'undefined' ? EligibilityContract.buildLegacy() : null)
    : (typeof resolveReportEligibility === 'function' ? resolveReportEligibility(S.activeJob) : null);
  const qualityDisplayed = resolveDisplayedScore({
    publicView: Boolean(S.publicScoreView),
    publishedScore: S.publicScoreView ? publishedWaterScore(S.activeJob) : null,
    qualityScore: S.currentScoreResult?.computedScore ?? S.currentScoreResult?.score,
    readings: result.readings || S.scoreBaseReadings || {},
    standardKey: result.standardKey || S.scoreStandardKey
  });
  const displayed = staffHeroForPopulation(qualityDisplayed);
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
    // Share stays gated on the Quality / published score, not the zone hero.
    showScore: qualityDisplayed.showScore
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
  if (S.publicScoreView && showScore && !showingComparison && Number.isFinite(Number(wq))) {
    const share = customerShareCopy(wq);
    verdict.tier = share.tier;
    verdict.label = share.label;
    verdict.color = share.color;
    S.customerShareTier = share.key;
  } else {
    S.customerShareTier = '';
  }
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
  if (heroSourceEl) {
    if (!showScore) {
      heroSourceEl.textContent = '';
      heroSourceEl.hidden = true;
    } else if (S.publicScoreView) {
      heroSourceEl.textContent = t('score.hero.published');
      heroSourceEl.hidden = false;
    } else {
      heroSourceEl.textContent = t('score.hero.quality');
      heroSourceEl.hidden = false;
    }
  }
  const complianceEl = document.getElementById('score-compliance-line');
  if (complianceEl) {
    const frozenPublicationCompliance = S.publicScoreView ? publishedComplianceStatus(S.activeJob) : null;
    if (S.publicScoreView) {
      if (showScore && frozenPublicationCompliance) {
        complianceEl.hidden = false;
        complianceEl.dataset.status = frozenPublicationCompliance;
        complianceEl.textContent = t('score.compliance.label').replace('{status}', frozenPublicationCompliance);
      } else {
        complianceEl.textContent = '';
        complianceEl.hidden = true;
        delete complianceEl.dataset.status;
      }
    } else if (showScore && complianceStatus) {
      complianceEl.hidden = false;
      complianceEl.dataset.status = complianceStatus;
      complianceEl.textContent = t('score.compliance.label').replace('{status}', customerStatusLabel(complianceStatus));
    } else {
      complianceEl.textContent = '';
      complianceEl.hidden = true;
      delete complianceEl.dataset.status;
    }
  }
  S.roomCountryStatuses = collectRoomCountryStatuses(
    S.activeJob,
    displayed.comparison?.standardKey || S.scoreStandardKey
  );
  renderBenchmarkLine(displayed.comparison);
  renderRoomStatusList();
  placeScoreAssessmentSections();

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

  renderScoreContextLine(S.activeJob);
  if (showScore) renderStandardsBoard(readingsForScoreBoard(result.readings || S.scoreBaseReadings || {}));
  else renderStandardsBoard(null);

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
    if (showScore && S.customerShareTier) {
      noteEl.textContent = customerShareCopy(wq).note;
      noteEl.hidden = false;
    } else if (showScore) {
      // PD-007 D + PD-009 B: FAIL/WARNING get explicit hybrid notes on Quality/publish path.
      // Comparison path keeps the benchmark disclaimer (PD-005 / PD-001).
      if (!showingComparison && verdict.complianceOverride) {
        noteEl.textContent = verdict.complianceOverrideKind === 'WARNING' && wq >= BENCHMARK_OVERALL_PASS_MIN.thailand
          ? t('score.passesThai')
          : (verdict.complianceOverrideKind === 'WARNING'
            ? t('score.msg.complianceWarningOverride')
            : t('score.msg.complianceFailOverride'));
      } else {
        noteEl.textContent = scoreSummaryNote(wq, findings, S.roomCountryStatuses);
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

/**
 * On the customer page, keep the frozen publication block together and place
 * the live benchmark, rooms, and parameter rows under one current-assessment label.
 * Staff order is unchanged. No second score is rendered.
 */
function placeScoreAssessmentSections() {
  const benchmark = document.getElementById('score-benchmark-line');
  const rooms = document.getElementById('score-room-status');
  const separator = document.getElementById('score-current-assessment');
  const publishedLine = document.getElementById('score-published-line');
  const panel = document.querySelector('#s-score .score-content-panel');
  const progress = document.getElementById('score-status-bar');
  if (separator) {
    if (S.publicScoreView) {
      separator.hidden = true;
      separator.textContent = '';
    } else {
      separator.hidden = true;
      separator.textContent = '';
    }
  }
  if (S.publicScoreView && panel && separator && benchmark && rooms && typeof panel.insertBefore === 'function') {
    panel.insertBefore(separator, panel.firstChild || null);
    panel.insertBefore(benchmark, separator.nextSibling || null);
    panel.insertBefore(rooms, benchmark.nextSibling || null);
  } else if (!S.publicScoreView && progress && progress.parentNode && benchmark && rooms && typeof progress.parentNode.insertBefore === 'function') {
    progress.parentNode.insertBefore(benchmark, progress);
    progress.parentNode.insertBefore(rooms, progress);
  }
  if (publishedLine) {
    const published = publishedWaterScore(S.activeJob);
    const current = Number(S.scoreVal);
    const show = !S.publicScoreView
      && published != null
      && Number.isFinite(current)
      && Math.round(current) !== published;
    publishedLine.hidden = !show;
    publishedLine.textContent = show ? `${t('score.hero.published')}: ${published}` : '';
  }
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
  // Staff hero uses the live Quality V3 score.
  // A customer publication keeps the frozen score and compliance.
  const frozenScore = S.publicScoreView ? publishedWaterScore(S.activeJob) : null;
  const gaugeScore = frozenScore != null ? frozenScore : computedScore;
  S.scoreVal = gaugeScore;
  S.currentScoreResult = {
    ...(S.currentScoreResult || {}),
    score: gaugeScore,
    computedScore,
    readings: { ...readings },
    source: frozenScore != null ? 'published' : 'computed',
    standardKey: 'quality-v3',
    engineVersion: detail?.engineVersion || (typeof QUALITY_SCORE_ENGINE_VERSION !== 'undefined' ? QUALITY_SCORE_ENGINE_VERSION : 'quality-v3'),
    paramScores: detail?.params || null,
    complianceStatus: S.publicScoreView ? publishedComplianceStatus(S.activeJob) : (detail?.compliance?.status || null),
    compliance: S.publicScoreView ? null : (detail?.compliance || null),
    validation: S.lastReadingsValidation || null
  };
  // Quality stays on the whole-house readings above. Country Benchmark follows
  // the selected zone when one is open, and the same whole-house pool when not.
  const countryReadings = readingsForCountryBenchmark(S.activeJob);
  S.comparisonScoreResult = getCountryBenchmarkScore(countryReadings, key);
  S.displayedScore = staffHeroForPopulation(resolveDisplayedScore({
    publicView: Boolean(S.publicScoreView),
    publishedScore: frozenScore,
    qualityScore: computedScore,
    readings: countryReadings,
    standardKey: key
  }));
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
// 2026-10-09 (whole-house averaging fix, reviewed/tested in isolation before
// integration): the previous implementation averaged `standardMeasurement`
// and `meterReadings` as two separate row pools per key, falling back to the
// legacy pool only when NO row in the whole set had the key in
// `standardMeasurement`. That meant a tap whose `standardMeasurement`
// happened to lack a key (e.g. because a manual edit elsewhere invalidated
// it) was silently excluded from that key's whole-house average whenever ANY
// other tap still had it in `standardMeasurement` -- even though the
// excluded tap's own `meterReadings` had a perfectly good value and the
// per-room read path (readingsFromSingleTap) would have used it. This
// resolves each tap's own best-available value FIRST (same standardMeasurement-
// then-meterReadings precedence already used per room), THEN averages across
// taps -- so every tap's own data counts.
function readingsFromTapData(tapData) {
  const taps = Array.isArray(tapData) ? tapData : [];
  if (!taps.length) return {};
  const anyData = taps.some(tap => (
    (tap?.standardMeasurement && typeof tap.standardMeasurement === 'object' && Object.keys(tap.standardMeasurement).length)
    || tap?.meterReadings
    || tap?.chlorineReadings
  ));
  if (!anyData) return {};

  /** One field, one tap: standardMeasurement wins, meterReadings is the fallback. */
  function resolveTapField(tap, key) {
    const std = tap?.standardMeasurement;
    const stdHas = std && typeof std === 'object' && Object.prototype.hasOwnProperty.call(std, key);
    const stdVal = stdHas ? std[key] : undefined;
    const meter = tap?.meterReadings || {};
    const meterHas = Object.prototype.hasOwnProperty.call(meter, key);
    const meterVal = meterHas ? meter[key] : undefined;
    // An explicit clear (null) on either layer means "missing for this tap" --
    // never resurrect from the other layer (same UJ-05 rule as before).
    if ((stdHas && stdVal === null) || (meterHas && meterVal === null)) {
      return { owned: true, cleared: true, value: undefined };
    }
    const resolved = numOrUndefined(stdVal ?? meterVal);
    return { owned: stdHas || meterHas, cleared: false, value: resolved };
  }

  function resolveTapChlorine(tap) {
    const std = tap?.standardMeasurement;
    const stdHas = std && typeof std === 'object' && Object.prototype.hasOwnProperty.call(std, 'chlorine');
    if (stdHas && std.chlorine === null) return { owned: true, cleared: true, value: undefined };
    const chlorine = tap?.chlorineReadings || {};
    const freeHas = Object.prototype.hasOwnProperty.call(chlorine, 'freeChlorine');
    const totalHas = Object.prototype.hasOwnProperty.call(chlorine, 'chlorine');
    if (freeHas && chlorine.freeChlorine === null) return { owned: true, cleared: true, value: undefined };
    if (totalHas && chlorine.chlorine === null) return { owned: true, cleared: true, value: undefined };
    const resolved = numOrUndefined(stdHas ? std.chlorine : (chlorine.freeChlorine ?? chlorine.chlorine));
    return { owned: stdHas || freeHas || totalHas, cleared: false, value: resolved };
  }

  const averageOwned = (perTap) => {
    const vals = perTap.filter(r => r.value !== undefined).map(r => r.value);
    return vals.length ? vals.reduce((sum, n) => sum + n, 0) / vals.length : undefined;
  };
  /** Explicitly cleared only when every tap that touched this key was cleared
   * and none supplied a usable value -- same intent as the prior "owned.every
   * row === null" check, now evaluated per-tap instead of per-row-pool. */
  const clearedKey = (perTap) => {
    const owned = perTap.filter(r => r.owned);
    return owned.length > 0 && owned.every(r => r.cleared);
  };

  const KEYS = ['ph', 'tds', 'turbidity', 'orp', 'do', 'temp'];
  const explicitClears = new Set();
  const resolved = {};
  KEYS.forEach(key => {
    const perTap = taps.map(tap => resolveTapField(tap, key));
    if (clearedKey(perTap)) explicitClears.add(key);
    resolved[key] = averageOwned(perTap);
  });
  const clPerTap = taps.map(resolveTapChlorine);
  if (clearedKey(clPerTap)) explicitClears.add('chlorine');
  resolved.chlorine = averageOwned(clPerTap);

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
 * D2 (locked 2026-10-06): the whole-house "All" reading is built only from
 * complete rooms. Completeness = every parameter the selected country engine
 * weights (temperature never), evaluated on each room's own resolved readings
 * through the existing fallback chain (standardMeasurement → meterReadings →
 * chlorineReadings). If no room is complete, no All reading is produced.
 */
function resolveCompletenessCountryKey(job) {
  const reg = benchmarkRegistry();
  const key = [S.scoreStandardKey, job?.draft?.scoreStandardKey].find(k => k && reg?.has?.(k));
  return key || DEFAULT_SCORE_STANDARD_KEY;
}

/** Scored parameters of a country engine, read from the engine's own weights. */
function requiredScoredParamsForCountry(countryKey) {
  const reg = benchmarkRegistry();
  if (!reg?.has?.(countryKey)) return null;
  // Each engine registers its weights object (see engine register() calls);
  // a parameter with a positive weight is scored. Temperature is never scored.
  const weights = reg.get(countryKey)?.weights || {};
  const keys = Object.keys(weights).filter(key => Number(weights[key]) > 0 && key !== 'temp');
  return keys.length ? keys : null;
}

/** Opt-in forensic trace: set window.WM_SCORE_TRACE = true in the console. */
function traceScoreCompleteness(event, fields) {
  if (typeof window === 'undefined' || window.WM_SCORE_TRACE !== true) return;
  console.info(`[score:${event}]`, fields);
}

function roomReadingSource(tap, key) {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  if (finite(numOrUndefined(tap?.standardMeasurement?.[key]))) return 'standardMeasurement';
  if (finite(numOrUndefined(tap?.meterReadings?.[key]))) return 'meterReadings';
  if (key === 'chlorine' && finite(numOrUndefined(tap?.chlorineReadings?.freeChlorine ?? tap?.chlorineReadings?.chlorine))) return 'chlorineReadings';
  return null;
}

function completeRoomTapsForAll(job, countryKey) {
  const taps = resolveJobTapDataForScore(job) || [];
  const required = requiredScoredParamsForCountry(countryKey);
  if (!required) {
    traceScoreCompleteness('score_all_aggregation', {
      country: countryKey, totalRooms: taps.length, includedRooms: 0, allScoreAvailable: false, reason: 'no_engine_contract'
    });
    return [];
  }
  const STATE = typeof MeasurementValidator !== 'undefined' ? MeasurementValidator.STATE : {};
  const included = [];
  const excluded = [];
  taps.forEach((tap, roomIndex) => {
    const resolved = readingsFromTapData([tap]);
    const validation = typeof MeasurementValidator !== 'undefined'
      ? MeasurementValidator.validateMeasurements(resolved)
      : null;
    const cleared = resolved.__explicitClears instanceof Set ? resolved.__explicitClears : new Set();
    const missing = required.filter(key => {
      if (cleared.has(key)) return true;
      const value = resolved[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) return true;
      const state = validation?.fields?.[key]?.state;
      return state === STATE.IMPLAUSIBLE || state === STATE.INVALID_TYPE;
    });
    const complete = missing.length === 0;
    if (complete) included.push(roomIndex); else excluded.push({ roomIndex, missing });
    traceScoreCompleteness('score_room_completeness', {
      country: countryKey,
      roomIndex,
      requiredParameters: required,
      resolvedParameters: required.filter(key => !missing.includes(key)),
      missingParameters: missing,
      sources: Object.fromEntries(required.map(key => [key, roomReadingSource(tap, key)])),
      complete
    });
  });
  traceScoreCompleteness('score_all_aggregation', {
    country: countryKey,
    totalRooms: taps.length,
    includedRooms: included.length,
    excludedRooms: excluded.length,
    includedRoomIndexes: included,
    excludedRoomsWithReasons: excluded,
    allScoreAvailable: included.length > 0,
    aggregationMode: 'complete_rooms_only'
  });
  return included.map(roomIndex => taps[roomIndex]);
}

/**
 * Real measurements only — never HTML placeholders, never demo fill values.
 * Sources: Case-owned tap snapshots only. Draft fields are not rooms and do not
 * feed "All" (D2). Active-session S.tapData may supply taps only when scoring the
 * active Case and draft.tapData is absent (see resolveJobTapDataForScore).
 * Meter DOM (#m-*) is intentionally excluded — leftover DOM from Case A must
 * never complete Case B's score.
 */
function resolveScoreReadingsPresent(job) {
  const countryKey = resolveCompletenessCountryKey(job);
  const completeTaps = completeRoomTapsForAll(job, countryKey);
  // The Case-level draft.fields layer is not a room, so it does not feed "All".
  // Do not use scoreBaseReadings here — older drafts may have cached demo fill values.
  return mergeReadingLayers(readingsFromTapData(completeTaps));
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
 *
 * Customer public view: the gauge and compliance use the frozen publication score and compliance when available.
 * Staff display remains live.
 * Country benchmark, room status, and parameter rows stay on the current Case readings.
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
    : (S.taps?.length ? [...S.taps] : [...DEFAULT_TAPS]);

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
  const frozenCompliance = publicView ? publishedComplianceStatus(job) : null;
  S.currentScoreResult = {
    score: productionScore,
    standardKey: 'quality-v3',
    readings: { ...readings },
    source: publicView && Number.isFinite(published) ? 'published' : 'computed',
    computedScore,
    engineVersion: detail?.engineVersion || (typeof QUALITY_SCORE_ENGINE_VERSION !== 'undefined' ? QUALITY_SCORE_ENGINE_VERSION : 'quality-v3'),
    paramScores: detail?.params || null,
    complianceStatus: publicView ? frozenCompliance : (detail?.compliance?.status || null),
    compliance: publicView ? null : (detail?.compliance || null),
    validation: S.lastReadingsValidation || null
  };
  if (!S.scoreStandardKey || !benchmarkRegistry()?.has?.(S.scoreStandardKey)) {
    S.scoreStandardKey = DEFAULT_SCORE_STANDARD_KEY;
  }
  S.comparisonScoreResult = getCountryBenchmarkScore(readings, S.scoreStandardKey);
  S.displayedScore = resolveDisplayedScore({
    publicView,
    publishedScore: publicView ? productionScore : null,
    qualityScore: Number.isFinite(computedScore) ? computedScore : null,
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
  // The list below names each inspection point. The top number stays the overall score.
  S.scoreTapFilter = taps[0] || 'all';
  S.publicScoreView = publicView;

  renderScoreDisplay();
  return productionScore;
}

function calcAndShowScore() {
  renderWaterScore(S.activeJob, { publicView: Boolean(S.publicScoreView) });
}

/** Localhost only. Shows the shared Full Assessment page with sample readings. */
function mountLocalSharePreview(band) {
  const host = window.location.hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') return;
  const base = { ph: 7.2, tds: 103, chlorine: 0.1, turbidity: 0.7, orp: 187, do: 5.9, temp: 20.4 };
  const samples = {
    good: { score: 71, readings: base },
    fair: { score: 61, readings: base },
    attention: { score: 48, readings: base },
    optimal: { score: 92, readings: { ...base, chlorine: 0.5, turbidity: 0.2 } }
  };
  const sample = samples[String(band || '').toLowerCase()] || samples.good;
  const bathReadings = {
    ...sample.readings,
    chlorine: sample.readings.chlorine === 0.1 ? 0.4 : 0.6
  };
  const tap = (readings, photo) => ({
    standardMeasurement: readings,
    meterReadings: readings,
    chlorineReadings: { freeChlorine: readings.chlorine },
    photos: photo ? { tapphoto: photo } : {}
  });
  document.body.classList.add('public-report-mode');
  S.publicScoreView = true;
  S.lang = 'en';
  S.scoreTargetsOn = false;
  S.scoreStandardKey = 'thailand';
  S.scoreTapFilter = 'Kitchen';
  S.taps = ['Kitchen', 'Bath'];
  S.activeJob = {
    id: 'local-share-preview',
    name: 'Sathorn',
    date: '2026-10-07',
    pkg: 'full',
    result: { waterScore: sample.score },
    draft: {
      taps: ['Kitchen', 'Bath'],
      fields: { 'ci-addr': 'Sathorn, Bangkok', 'ci-proptype': 'Condo' },
      tapData: [tap(sample.readings, '/src/assets/score-first-page-kitchen.jpg?v=2'), tap(bathReadings)]
    }
  };
  if (typeof setLanguage === 'function') setLanguage('en', { silent: true });
  goScreen('s-score');
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

/**
 * Chlorine display only. Meter values are stored to 0.01 mg/L.
 * One decimal turns 0.03 and 0.04 into "0.0". Other metrics keep fmt().
 * Silence with S.chlorineDisplayLog = false. Removing the log call does not change the text.
 */
const _chlorineDisplayLogged = new Set();

function describeChlorineDisplay(original, normalized) {
  const missing = original === null || original === undefined || original === '' || original === false;
  const finite = Number.isFinite(normalized);
  if (!finite) {
    return {
      reading: original,
      readingType: original === null ? 'null' : typeof original,
      normalized: null,
      precision: null,
      display: '—',
      status: missing ? 'missing' : 'invalid'
    };
  }
  const hundredths = Math.round(Math.abs(normalized) * 100);
  const precision = (normalized !== 0 && (Math.abs(normalized) < 0.05 || hundredths % 10 !== 0)) ? 2 : 1;
  let status = 'measured';
  if (normalized === 0) status = 'zero';
  else if (Math.abs(normalized) < 0.05) status = 'non_zero_low_value';
  return {
    reading: original,
    readingType: typeof original,
    normalized,
    precision,
    display: `${normalized.toFixed(precision)} mg/L`,
    status
  };
}

function logChlorineDisplay(outcome) {
  if (typeof S !== 'undefined' && S.chlorineDisplayLog === false) return;
  const caseId = (typeof S !== 'undefined' && (S.activeJob?.id || S.activeJob?.notionId)) || 'none';
  const key = `${caseId}|${outcome.status}|${String(outcome.reading)}|${outcome.display}`;
  if (_chlorineDisplayLogged.has(key)) return;
  if (_chlorineDisplayLogged.size > 40) _chlorineDisplayLogged.clear();
  _chlorineDisplayLogged.add(key);
  const line = `[MetricDisplay] metric=chlorine case=${caseId} reading=${String(outcome.reading)} type=${outcome.readingType} normalized=${outcome.normalized} precision=${outcome.precision} display="${outcome.display}" status=${outcome.status}`;
  if (outcome.status === 'invalid') console.warn(line);
  else console.info(line);
}

function formatChlorineMgL(original, normalized) {
  const outcome = describeChlorineDisplay(original, normalized);
  logChlorineDisplay(outcome);
  return outcome.display;
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
  // Read-only: the selected engine's own per-parameter classification for
  // these readings, used solely to present Good / Fair / Attention.
  const reg = benchmarkRegistry();
  const classifications = reg?.calculate
    ? (reg.calculate(reg.has?.(standardKey) ? standardKey : DEFAULT_SCORE_STANDARD_KEY, readings || {}).classifications || null)
    : null;
  const buildRow = (key, label, computedVal, fmtFn, std, status) => {
    if (!Number.isFinite(computedVal) && validationFields?.[key]?.state === 'IMPLAUSIBLE') {
      const rawVal = toFin(rawReadings[key]);
      if (Number.isFinite(rawVal)) {
        return { key, p: label, r: fmtFn(rawVal), std, st: 'implausible', raw: rawVal };
      }
    }
    // A real value is present, but this standard's engine deliberately never
    // scores this param (e.g. Thailand excludes DO/Temp, Japan excludes DO —
    // statusOf() always answers 'pending' for them regardless of the value).
    // That is not "still loading" — show the measured value with a neutral
    // "not scored here" note instead of shimmering forever (2026-08-17 fix).
    if (status === 'pending' && Number.isFinite(computedVal)) {
      return { key, p: label, r: fmtFn(computedVal), std, st: 'excluded', raw: computedVal };
    }
    return { key, p: label, r: fmtFn(computedVal), std, st: paramStatusFromClassification(status, classifications?.[key]), raw: computedVal };
  };

  const rows = [
    buildRow('ph', 'pH', ph, (n) => fmt(n, 1), stdLabel(display.ph), evaluateParamStatus('ph', ph, standardKey)),
    buildRow('tds', 'TDS', tds, (n) => fmtInt(n, ' mg/L'), stdLabel(display.tds), evaluateParamStatus('tds', tds, standardKey)),
    buildRow('chlorine', 'Chlorine', chlorine, (n) => formatChlorineMgL(readings.chlorine, n), stdLabel(display.chlorine), evaluateParamStatus('chlorine', chlorine, standardKey)),
    buildRow('turbidity', 'Turbidity', turbidity, (n) => fmt(n, 1, ' NTU'), stdLabel(display.turbidity), evaluateParamStatus('turbidity', turbidity, standardKey)),
    buildRow('orp', 'ORP', orp, (n) => fmtInt(n, ' mV'), stdLabel(display.orp), evaluateParamStatus('orp', orp, standardKey)),
    buildRow('do', 'DO', doVal, (n) => fmt(n, 1, ' mg/L'), stdLabel(display.do), evaluateParamStatus('do', doVal, standardKey)),
    buildRow('temp', S.publicScoreView ? 'Temperature' : 'Temp', temp, (n) => fmt(n, 1, '°C'), stdLabel(display.temp), evaluateParamStatus('temp', temp, standardKey))
  ];
  return rows;
}

function scoreTapRows(key, context = getScoreEvalContext()) {
  return buildMetricRowsForReadings(getRoomReadings(key, context), context);
}

function escapeScoreHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

/** Presentation only. Compares a shown value with the selected standard's band. */
function metricTargetSide(key, value, limits) {
  const band = limits?.[key];
  if (!band || !Number.isFinite(value)) return 'out';
  if (Number.isFinite(band.min) && value < band.min) return 'below';
  if (Number.isFinite(band.max) && value > band.max) return 'above';
  if (Number.isFinite(band.passMax) && value > band.passMax) return 'above';
  return 'out';
}

function customerTargetLabel(key, context) {
  const standardKey = context?.selectedStandard || S.scoreStandardKey || DEFAULT_SCORE_STANDARD_KEY;
  const display = context?.display || getWaterQualityStandard(standardKey).display || {};
  const raw = String(display[key] || '').trim();
  if (!raw || /not specified|not evaluated|pd-\d+/i.test(raw)) return '';
  return raw.replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/\s+-\s+/g, '–');
}

function scoreTargetNote(row, context) {
  const statusKey = paramStatusUiKey(row.st);
  if (statusKey === 'implausible') return t('score.targets.implausible');
  const limits = getWaterQualityStandard(context.selectedStandard || DEFAULT_SCORE_STANDARD_KEY).limits;
  const side = metricTargetSide(row.key, row.raw, limits);
  if (side === 'below' && S.publicScoreView && S.customerShareTier === 'attention') return t('score.targets.recheck');
  if (side === 'below') return t('score.targets.below');
  if (side === 'above') return t('score.targets.above');
  return t('score.targets.out');
}

function customerMetricCallout(row) {
  if (!S.publicScoreView) return false;
  const statusKey = paramStatusUiKey(row.st);
  return row.key === 'chlorine' && ['fair', 'attn', 'implausible'].includes(statusKey);
}

function customerCalloutVisible(row) {
  if (!customerMetricCallout(row)) return false;
  if (S.scoreTargetsOn) return true;
  return S.customerShareTier === 'fair' || S.customerShareTier === 'attention';
}

function scoreTargetDetail(row, context) {
  const publicCallout = customerCalloutVisible(row);
  if (!S.scoreTargetsOn && !publicCallout) return { html: '', warn: false };
  const statusKey = paramStatusUiKey(row.st);
  const offTarget = S.publicScoreView ? publicCallout : ['fair', 'attn', 'implausible'].includes(statusKey);
  const labeled = customerTargetLabel(row.key, context);
  const fallback = String(row.std || '').trim();
  const range = labeled || (/not specified|not evaluated|pd-\d+/i.test(fallback) ? '' : fallback);
  const unnamed = !range || range === 'Not specified' || range === t('score.std.notSpecified');
  if (unnamed && !offTarget) return { html: '', warn: false };
  const rangeLine = unnamed ? '' : `<p class="score-metric-target-range">${escapeScoreHtml(t('score.targets.range'))} ${escapeScoreHtml(range)}</p>`;
  const note = offTarget ? `<p class="score-metric-target-note">${escapeScoreHtml(scoreTargetNote(row, context))}</p>` : '';
  if (!rangeLine && !note) return { html: '', warn: false };
  return { html: `<div class="score-metric-target">${rangeLine}${note}</div>`, warn: offTarget };
}

const SCORE_TARGET_WARN = '<svg class="score-metric-warn" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="#F58C8C" stroke-width="1.05" stroke-linejoin="round" d="M8 1.3Q9.55 4.15 12.74 3.26Q11.85 6.45 14.7 8Q11.85 9.55 12.74 12.74Q9.55 11.85 8 14.7Q6.45 11.85 3.26 12.74Q4.15 9.55 1.3 8Q4.15 6.45 3.26 3.26Q6.45 4.15 8 1.3Z"/><path d="M8 5.15v3.15" stroke="#F58C8C" stroke-width="1.05" stroke-linecap="round"/><circle cx="8" cy="10.35" r=".58" fill="#F58C8C"/></svg>';

function syncScoreTargetsControl() {
  const btn = document.getElementById('score-targets-toggle');
  if (!btn || typeof btn.classList?.toggle !== 'function' || typeof btn.setAttribute !== 'function') return;
  const on = Boolean(S.scoreTargetsOn);
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function setScoreTargets(on) {
  S.scoreTargetsOn = Boolean(on);
  syncScoreTargetsControl();
  renderScoreReadings();
}

function statusPipCount(statusKey) {
  if (statusKey === 'good') return 4;
  if (statusKey === 'fair') return 2;
  if (statusKey === 'attn' || statusKey === 'implausible') return 1;
  return 3;
}

function renderScoreReadings(context = getScoreEvalContext()) {
  const taps = S.taps?.length ? S.taps : ['Tap 1'];
  if (taps.length <= 1) S.scoreTapFilter = taps[0];
  if (!S.scoreTapFilter) S.scoreTapFilter = taps[0];

  const listEl = document.getElementById('score-readings-rows');
  const scopeEl = document.getElementById('score-params-scope');
  if (!listEl) return;
  syncScoreTargetsControl();
  if (typeof listEl.classList?.toggle === 'function') {
    listEl.classList.toggle('is-targets', Boolean(S.scoreTargetsOn));
  }

  if (scopeEl) scopeEl.hidden = true;

  const rows = scoreTapRows(scorePointFilter(), context);
  const statusLabels = {
    good: t('score.status.good'),
    fair: t('score.status.fair'),
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
    const callout = customerCalloutVisible(r);
    const filled = statusPipCount(statusKey);
    const pips = Array.from({ length: 4 }, (_, index) =>
      `<svg class="score-metric-dot${index < filled ? ' is-on' : ''}" viewBox="0 0 8 8" width="8" height="8" aria-hidden="true"><circle cx="4" cy="4" r="3.5"/></svg>`
    ).join('');
    const detail = scoreTargetDetail(r, context);
    const warn = detail.warn ? SCORE_TARGET_WARN : '';
    const soft = S.publicScoreView && !callout && filled < 4;
    return `<div class="score-metric-item${detail.html ? ' is-target' : ''}">
  <div class="score-metric-row is-${statusKey}${callout ? ' is-callout' : ''}${soft ? ' is-soft' : ''}">
    <span class="score-metric-name">${warn}${escapeScoreHtml(r.p)}</span>
    <span class="score-metric-range">${escapeScoreHtml(r.std)}</span>
    <span class="score-metric-value">${escapeScoreHtml(r.r)}</span>
    <span class="score-metric-pips" aria-hidden="true">${pips}</span>
    <span class="score-metric-status"><i class="score-dot" aria-hidden="true"></i>${escapeScoreHtml(statusLabel)}</span>
  </div>
  ${detail.html}
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

  const allRows = scoreTapRows(scorePointFilter(), context);
  // Fair rows were listed here as Attention before the Fair state existed — keep them listed.
  const rows = allRows.filter(r => ['attn', 'fair'].includes(paramStatusUiKey(r.st)));
  const displayed = resolveDisplayedScore({
    publicView: Boolean(S.publicScoreView),
    publishedScore: S.publicScoreView ? publishedWaterScore(S.activeJob) : null,
    qualityScore: S.currentScoreResult?.computedScore ?? S.currentScoreResult?.score,
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
    syncScoreWhatsNext(showScore);
    return;
  }

  if (allGood) allGood.hidden = true;
  section.hidden = false;
  if (headingEl) {
    headingEl.textContent = verdict.tier === 'low' ? t('score.fixFirst') : t('score.improveTitle');
  }
  if (countEl) countEl.textContent = `· ${rows.length}`;
  const improveLabels = {
    good: t('score.status.good'),
    fair: t('score.status.fair'),
    attn: t('score.status.attn')
  };
  listEl.innerHTML = rows.map(r => {
    const statusKey = paramStatusUiKey(r.st);
    return `<div class="score-improve-row is-${statusKey}">
  <i class="score-flag" aria-hidden="true"></i>
  <span class="score-improve-name">${r.p}</span>
  <span class="score-improve-range">${r.std}</span>
  <span class="score-improve-value">${r.r}</span>
  <span class="score-improve-status">${improveLabels[statusKey] || ''}</span>
</div>`;
  }).join('');
  syncScoreWhatsNext(showScore);
}

const SCORE_SHIFT_ROWS = Object.freeze([
  { key: 'ph', label: 'pH' },
  { key: 'turbidity', label: 'Turbidity' },
  { key: 'chlorine', label: 'Chlorine' },
  { key: 'tds', label: 'TDS' }
]);

/** Project near-ideal points already used by the quality formula. Presentation only. */
const SCORE_QUALITY_IDEAL = Object.freeze({
  ph: 7.2,
  tds: 80,
  turbidity: 0.1,
  orp: 400,
  chlorine: 0.35,
  do: 8
});

function firstFiniteLimit(...vals) {
  for (const value of vals) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function scoreShiftDirection(key, value, standardKey) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'pending';
  const limits = benchmarkRegistry()?.get?.(standardKey)?.limits?.[key] || {};
  const min = firstFiniteLimit(limits.preferredMin, limits.excellentMin, limits.idealMin)
    ?? firstFiniteLimit(limits.min);
  const max = firstFiniteLimit(limits.preferredMax, limits.excellentMax, limits.idealMax, limits.gradeExcellentMax)
    ?? firstFiniteLimit(limits.passMax, limits.max);
  if (min == null && max == null) return 'pending';
  if (min != null && n < min) return 'below';
  if (max != null && n > max) return 'above';
  return 'optimal';
}

function scoreShiftMark(kind) {
  if (kind === 'below') {
    return '<span class="score-shift-mark" aria-hidden="true"><svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="8.1" fill="none" stroke="#69A1F1" stroke-width="1.6"/><path d="M10 6.4v7M7.5 11 10 13.5 12.5 11" fill="none" stroke="#69A1F1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  }
  if (kind === 'above') {
    return '<span class="score-shift-mark" aria-hidden="true"><svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="8.1" fill="none" stroke="#69A1F1" stroke-width="1.6"/><path d="M10 13.6V6.6M7.5 9 10 6.5 12.5 9" fill="none" stroke="#69A1F1" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  }
  return '<span class="score-shift-mark" aria-hidden="true"><svg viewBox="0 0 20 20" width="20" height="20"><circle cx="10" cy="10" r="10" fill="#284DCD"/><path d="M5.7 10.2 8.4 12.8 14.3 7.1" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
}

function scoreShiftLabel(kind) {
  if (kind === 'optimal') return t('score.shift.optimal');
  if (kind === 'below') return t('score.shift.below');
  if (kind === 'above') return t('score.shift.above');
  return '';
}

function scoreShiftRowHtml(label, kind) {
  return `<div class="score-shift-row">
    ${scoreShiftMark(kind)}
    <span class="score-shift-name">${escapeScoreText(label)}</span>
    <span class="score-shift-state is-${kind}">${escapeScoreText(scoreShiftLabel(kind))}</span>
  </div>`;
}

function thailandStandardPasses(readings) {
  const reg = benchmarkRegistry();
  if (!reg?.calculate || !readings) return false;
  const out = reg.calculate('thailand', readings);
  if (!out || out.measurementIncomplete || out.complete === false || !Number.isFinite(Number(out.score))) return false;
  const worst = typeof worstBenchmarkClassification === 'function'
    ? worstBenchmarkClassification(out.classifications)
    : null;
  return worst === 'PASS';
}

/**
 * After card. Direction uses the selected standard's existing ideal band.
 * The after number is the current quality formula with those readings on its own ideal points.
 * It is not written back to the case score.
 */
function scoreShiftRangeLabel(key, standardKey) {
  const limits = benchmarkRegistry()?.get?.(standardKey)?.limits?.[key] || {};
  const min = firstFiniteLimit(limits.preferredMin, limits.excellentMin, limits.idealMin)
    ?? firstFiniteLimit(limits.min);
  const max = firstFiniteLimit(limits.preferredMax, limits.excellentMax, limits.idealMax, limits.gradeExcellentMax)
    ?? firstFiniteLimit(limits.passMax, limits.max);
  const unit = { tds: ' mg/L', turbidity: ' NTU', chlorine: ' mg/L', orp: ' mV', do: ' mg/L', temp: '°C' }[key] || '';
  const fmt = (n) => {
    const rounded = Math.round(Number(n) * 10) / 10;
    const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
    return `${text}${unit}`;
  };
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}`.replace(`${unit}–`, '–');
  if (max != null) return `≤ ${fmt(max)}`;
  if (min != null) return `≥ ${fmt(min)}`;
  return '';
}

function renderShiftImprove(readings, rows, standardKey) {
  const section = document.getElementById('score-improve-section');
  const listEl = document.getElementById('score-improve-list');
  const countEl = document.getElementById('score-improve-count');
  const headingEl = document.getElementById('score-improve-heading');
  if (!section || !listEl) return;
  const open = rows.filter(row => row.kind === 'above' || row.kind === 'below');
  if (!open.length) {
    section.hidden = true;
    listEl.replaceChildren?.();
    return;
  }
  const metric = typeof scoreTapRows === 'function' ? scoreTapRows(scorePointFilter()) : [];
  section.hidden = false;
  if (headingEl) headingEl.textContent = t('score.improveTitle');
  if (countEl) countEl.textContent = `· ${open.length}`;
  listEl.innerHTML = open.map(row => {
    const found = metric.find(item => item.key === row.key);
    const range = scoreShiftRangeLabel(row.key, standardKey);
    const value = found?.r || (Number.isFinite(Number(readings?.[row.key])) ? String(readings[row.key]) : '');
    return `<div class="score-improve-row is-fair">
  <i class="score-flag" aria-hidden="true"></i>
  <span class="score-improve-name">${escapeScoreText(row.label)}</span>
  <span class="score-improve-range">${escapeScoreText(range)}</span>
  <span class="score-improve-value">${escapeScoreText(value)}</span>
  <span class="score-improve-status"></span>
</div>`;
  }).join('');
}

function setScoreNextFooter(open) {
  const primary = document.querySelector('#s-score .foot .btn-primary');
  if (!primary) return;
  if (open) {
    primary.setAttribute('data-i18n', 'common.complete');
    primary.textContent = t('common.complete');
    primary.onclick = () => { if (typeof completeScore === 'function') completeScore(); };
    return;
  }
  primary.setAttribute('data-i18n', 'score.footer.next');
  primary.textContent = t('score.footer.next');
  primary.onclick = openScoreWhatsNext;
}

function scoreResultAlreadyOptimal(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return false;
  if (S.publicScoreView) return customerShareCopy(n).key === 'optimal';
  return typeof customerVerdict === 'function' && customerVerdict(n).tier === 'high';
}

function showScoreAlreadyOptimal(score) {
  const card = document.getElementById('score-already');
  const kicker = document.getElementById('score-already-kicker');
  const title = document.getElementById('score-already-title');
  const body = document.getElementById('score-already-body');
  const n = Math.round(Number(score));
  if (kicker) kicker.textContent = `${t('score.verdict.excellent')} · ${n}/100`;
  if (title) title.textContent = t('score.already.title');
  if (body) body.textContent = t('score.already.body');
  if (card) card.hidden = false;
  const upgrade = document.getElementById('score-upgrade-card');
  const improve = document.getElementById('score-improve-section');
  const allGood = document.getElementById('score-all-good');
  if (upgrade) upgrade.hidden = true;
  if (improve) improve.hidden = true;
  if (allGood) allGood.hidden = true;
}

function openScoreWhatsNext() {
  const screen = document.getElementById('s-score');
  if (!screen) return;
  S.scoreNextOpen = true;
  screen.classList.add('is-next-view');
  const score = Number(S.displayedScore?.score ?? S.scoreVal);
  const already = scoreResultAlreadyOptimal(score);
  screen.classList.toggle('is-already-optimal', already);
  const heading = document.getElementById('score-whats-next');
  if (heading) heading.hidden = false;
  if (already) showScoreAlreadyOptimal(score);
  else {
    const card = document.getElementById('score-already');
    if (card) card.hidden = true;
    renderScoreShift(Number.isFinite(score), score);
  }
  setScoreNextFooter(true);
  const scroll = screen.querySelector('.score-scroll');
  if (scroll) scroll.scrollTop = 0;
}

function closeScoreWhatsNext() {
  S.scoreNextOpen = false;
  const screen = document.getElementById('s-score');
  screen?.classList.remove('is-next-view', 'is-already-optimal');
  const card = document.getElementById('score-already');
  if (card) card.hidden = true;
  setScoreNextFooter(false);
  const scroll = document.querySelector('#s-score .score-scroll');
  if (scroll) scroll.scrollTop = 0;
}

function scoreHeaderBack() {
  if (S.scoreNextOpen) {
    closeScoreWhatsNext();
    return;
  }
  if (typeof goBack === 'function') goBack('s-assess');
}

function setScoreShiftMode(mode) {
  S.scoreShiftMode = mode === 'next' ? 'next' : 'now';
  const nowBtn = document.getElementById('score-shift-now');
  const nextBtn = document.getElementById('score-shift-next');
  if (nowBtn) {
    nowBtn.classList.toggle('is-on', S.scoreShiftMode === 'now');
    nowBtn.setAttribute('aria-selected', S.scoreShiftMode === 'now' ? 'true' : 'false');
  }
  if (nextBtn) {
    nextBtn.classList.toggle('is-on', S.scoreShiftMode === 'next');
    nextBtn.setAttribute('aria-selected', S.scoreShiftMode === 'next' ? 'true' : 'false');
  }
  renderScoreShift(true, S.displayedScore?.score);
}

function renderScoreShift(showScore, currentScore) {
  const noteEl = document.getElementById('score-summary-note');
  const compliance = document.getElementById('score-compliance-line')?.dataset?.status;
  const overallNote = Number(currentScore);
  if (!S.publicScoreView && showScore && noteEl && compliance !== 'FAIL' && compliance !== 'WARNING'
    && overallNote >= BENCHMARK_OVERALL_PASS_MIN.thailand && overallNote < 81) {
    noteEl.textContent = t('score.passesThai');
  }
  const upgrade = document.getElementById('score-upgrade-card');
  if (!upgrade) return;
  const point = scorePointFilter();
  const pointReadings = point && point !== 'all' && typeof getRoomReadings === 'function'
    ? getRoomReadings(point)
    : null;
  const pointHasNumbers = pointReadings && Object.keys(pointReadings).some(key => Number.isFinite(Number(pointReadings[key])));
  const readings = pointHasNumbers ? pointReadings : readingsForScoreBoard({});
  const standardKey = benchmarkRegistry()?.has?.(S.scoreStandardKey) ? S.scoreStandardKey : DEFAULT_SCORE_STANDARD_KEY;
  const idealReadings = { ...(readings || {}) };
  Object.keys(SCORE_QUALITY_IDEAL).forEach(key => {
    if (Number.isFinite(Number(idealReadings[key]))) idealReadings[key] = SCORE_QUALITY_IDEAL[key];
  });
  const detail = (showScore && typeof computeQualityScoreDetail === 'function')
    ? computeQualityScoreDetail(idealReadings)
    : null;
  const after = Number(detail?.score);
  const current = Number(currentScore);
  const showAfter = showScore && Number.isFinite(after) && (!Number.isFinite(current) || after > current);
  upgrade.hidden = !showAfter;
  if (!showAfter) return;
  if (S.scoreShiftMode !== 'now' && S.scoreShiftMode !== 'next') S.scoreShiftMode = 'now';
  upgrade.dataset.mode = S.scoreShiftMode;
  const nowBtn = document.getElementById('score-shift-now');
  const nextBtn = document.getElementById('score-shift-next');
  if (nowBtn) {
    nowBtn.textContent = t('score.shift.now');
    nowBtn.classList.toggle('is-on', S.scoreShiftMode === 'now');
    nowBtn.setAttribute('aria-selected', S.scoreShiftMode === 'now' ? 'true' : 'false');
  }
  if (nextBtn) {
    nextBtn.textContent = t('score.shift.next');
    nextBtn.classList.toggle('is-on', S.scoreShiftMode === 'next');
    nextBtn.setAttribute('aria-selected', S.scoreShiftMode === 'next' ? 'true' : 'false');
  }
  const mode = S.scoreShiftMode;
  const upgradeFigure = 95;
  const shown = mode === 'next' ? upgradeFigure : current;
  const verdict = typeof customerVerdict === 'function' ? customerVerdict(shown) : { tier: 'high', label: '' };
  const num = document.getElementById('score-upgrade-val');
  const band = document.getElementById('score-upgrade-band');
  const note = document.getElementById('score-upgrade-note');
  const afterList = document.getElementById('score-upgrade-list');
  if (num) num.textContent = Number.isFinite(shown) ? String(Math.round(shown)) : '—';
  upgrade.dataset.tier = mode === 'next' ? 'high' : (verdict.tier || 'mid');
  if (band) {
    band.textContent = mode === 'next'
      ? t('score.shift.optimal')
      : (verdict.label || '');
  }
  if (note) {
    note.textContent = mode === 'next'
      ? t('score.shift.meetsIntl')
      : (noteEl?.textContent || scoreSummaryNote(current));
  }
  const sourceReadings = mode === 'next' ? idealReadings : (readings || {});
  const afterRows = SCORE_SHIFT_ROWS.map(row => ({
    ...row,
    kind: mode === 'next' ? 'optimal' : scoreShiftDirection(row.key, sourceReadings[row.key], standardKey)
  })).filter(row => row.kind !== 'pending');
  if (afterList) {
    afterList.innerHTML = (afterRows.length ? afterRows : SCORE_SHIFT_ROWS.map(row => ({ ...row, kind: 'optimal' })))
      .map(row => scoreShiftRowHtml(row.label, row.kind))
      .join('');
  }
  const dotOptions = {
    loading: false,
    tier: mode === 'next' ? 'high' : (verdict.tier || 'mid'),
    rowsId: 'score-upgrade-dot-rows',
    fieldId: 'score-upgrade-dots',
    tickId: 'score-upgrade-tick',
    rowCount: 2,
    dotsPerRow: 33
  };
  if (mode === 'next') dotOptions.markIndex = 29;
  else dotOptions.pinBadge = true;
  paintScoreDotField(Number.isFinite(shown) ? shown : 0, dotOptions);
  renderShiftImprove(readings || {}, afterRows, standardKey);
}

function syncScoreWhatsNext(showScore) {
  renderScoreShift(Boolean(showScore), S.displayedScore?.score);
  const title = document.getElementById('score-whats-next');
  const improve = document.getElementById('score-improve-section');
  const upgrade = document.getElementById('score-upgrade-card');
  const allGood = document.getElementById('score-all-good');
  if (!title) return;
  const visible = (improve && !improve.hidden) || (upgrade && !upgrade.hidden) || (allGood && !allGood.hidden);
  title.hidden = !visible;
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
  const point = scorePointFilter();
  const indices = point && point !== 'all'
    ? [taps.indexOf(point)].filter(i => i >= 0)
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
    applyCountryBenchmarkPopulation();
    const hero = S.displayedScore;
    const gaugeEl = document.getElementById('gauge-val');
    if (gaugeEl) {
      if (hero?.showScore) animateScoreNumber(gaugeEl, hero.score);
      else {
        _scoreAnimToken += 1;
        gaugeEl.textContent = '—';
      }
    }
    const context = getScoreEvalContext();
    renderScoreReadings(context);
    renderScoreImprove(context);
    renderBenchmarkLine(S.displayedScore?.comparison);
    renderRoomStatusList();
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

/** One option per inspection point. The overall score stays on the card above. */
function renderLocationSelect() {
  const taps = S.taps?.length ? S.taps : [];
  const pairs = [
    ['score-room-select-wrap-top', 'score-room-select-top']
  ];

  if (!taps.length) {
    pairs.forEach(([wrapId]) => document.getElementById(wrapId)?.classList.add('hidden'));
    return;
  }

  const selected = scorePointFilter();
  const optionsHtml = taps.map(tap =>
    `<option value="${escapeScoreText(tap)}"${selected === tap ? ' selected' : ''}>${escapeScoreText(tap)}</option>`
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

/**
 * Readings passed into the existing country engine.
 * 'all', or a case with one location, keeps resolveScoreReadings (whole house).
 * A selected zone passes only that zone's own measurements.
 * An empty zone passes {} so the engine stays incomplete. It never receives the house pool.
 */
function readingsForCountryBenchmark(job = S.activeJob) {
  const filter = S.scoreTapFilter;
  const taps = (Array.isArray(S.taps) && S.taps.length)
    ? S.taps
    : (Array.isArray(job?.draft?.taps) ? job.draft.taps : []);
  if (!filter || filter === 'all' || taps.length <= 1) return resolveScoreReadings(job);

  const tapData = resolveJobTapDataForScore(job) || [];
  const index = taps.indexOf(filter);
  const tap = index >= 0 ? tapData[index] : null;
  if (!tap || !hasTapReadingSource(tap)) return {};
  return getRoomReadings(filter);
}

/** Recompute the country comparison for the current filter. Does not touch Quality or publication. */
function applyCountryBenchmarkPopulation(job = S.activeJob) {
  const standardKey = benchmarkRegistry()?.has?.(S.scoreStandardKey)
    ? S.scoreStandardKey
    : DEFAULT_SCORE_STANDARD_KEY;
  const countryReadings = readingsForCountryBenchmark(job);
  S.comparisonScoreResult = getCountryBenchmarkScore(countryReadings, standardKey);
  const frozenScore = S.publicScoreView ? publishedWaterScore(job) : null;
  const qualityScore = S.currentScoreResult?.computedScore;
  S.displayedScore = staffHeroForPopulation(resolveDisplayedScore({
    publicView: Boolean(S.publicScoreView),
    publishedScore: frozenScore,
    qualityScore: qualityScore != null && qualityScore !== '' ? qualityScore : S.currentScoreResult?.score,
    readings: countryReadings,
    standardKey
  }));
  return S.comparisonScoreResult;
}

function setScoreTapFilter(key) {
  S.scoreTapFilter = key;
  S._scorePhotoAutoSynced = false;
  applyCountryBenchmarkPopulation();
  renderScoreDisplay();
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
 * Full Assessment vs Essential — job.pkg, the same signal the server uses to
 * route /r/{token} (case-flow-routes.js:isFreeInspectionJob).
 */
function isFullAssessmentJob(job) {
  return String(job?.pkg || 'essential').trim() === 'full';
}

/**
 * Shared fallback cascade used by both shareScore() and sharePublicReport():
 * share the PNG as a file, else share the link, else copy it to clipboard.
 * Keeping this in one place is what stops the two callers from drifting.
 * shareCard=false skips the PNG: a Full Assessment shares its Water Score
 * page link, never the Essential poster image.
 */
function absoluteReportUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, location.origin).href;
  } catch {
    return raw;
  }
}

/** Link already minted for this Full Assessment. Re-sharing must not publish again. */
function readyFullReportUrl(job) {
  if (!isFullAssessmentJob(job)) return '';
  const stored = absoluteReportUrl(job?.result?.reportUrl);
  if (stored) return stored;
  const token = String(job?.result?.publicReportToken || '').trim();
  if (!token) return '';
  return absoluteReportUrl(`/r/${encodeURIComponent(token)}`);
}

async function shareScoreResult({ reportToken, reportUrl, title, text, shareCard = true }) {
  const file = shareCard ? await shareScoreCardImage({ reportToken, title, text }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return 'image';
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      console.warn('Image share failed, falling back to URL share', error);
    }
  }

  // navigator.share must run in the tap that asked for it. A publish that
  // already finished loses that tap, so a refused sheet still leaves the link.
  if (navigator.share && reportUrl) {
    try {
      await navigator.share({ title, text, url: reportUrl });
      return 'url';
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (error?.name !== 'NotAllowedError') throw error;
    }
  }

  if (!reportUrl) throw new Error('Could not share score');
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
  if (!Number.isFinite(Number(S.scoreVal)) && !Number.isFinite(Number(job?.result?.waterScore))) {
    showToast('Please calculate the Water Score first');
    return;
  }

  const readyUrl = readyFullReportUrl(job);
  if (readyUrl) {
    sharingScore = true;
    setShareButtonLoading(true);
    try {
      const outcome = await shareScoreResult({
        reportToken: job.result?.publicReportToken,
        reportUrl: readyUrl,
        title: 'Water Motion - Water Score',
        text: `ผล Water Score ของคุณ: ${Number(job.result?.waterScore ?? S.scoreVal)}/100`,
        shareCard: false
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
      text: `ผล Water Score ของคุณ: ${result.score}/100`,
      shareCard: !isFullAssessmentJob(job)
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
  if (typeof saveActiveJobState === 'function') saveActiveJobState();
  if (typeof renderJobSteps === 'function') renderJobSteps();
  if (typeof goScreen === 'function') goScreen('s-dash');
}
