/**
 * Eligibility Presentation adapter — formats the Eligibility Contract into
 * display-ready strings/flags only. Never performs business logic, never
 * guesses completeness, never recalculates coverage, never reads
 * measurements itself. Pure function of the contract it's given.
 *
 * This is a formatter, not a UI wiring — nothing here touches the DOM.
 * Wiring an actual screen to consume it is Phase B.
 *
 * State -> human text ownership lives here exclusively (Phase C). Nothing
 * upstream (EligibilityEngine) authors human-readable reason text itself;
 * it only produces eligibilityState + missing lists and asks this module
 * to render them. Uses t() for localization when available, so Thai/
 * Japanese/etc. copy is a translation-table addition, not a logic change —
 * translation keys are not populated yet, tracked as remaining tech debt.
 */

const ELIGIBILITY_REASON_TEXT = Object.freeze({
  ELIGIBLE: null,
  READINGS_INCOMPLETE: 'Missing measurements',
  INSPECTION_INCOMPLETE: 'Inspection incomplete',
  READINGS_AND_INSPECTION_INCOMPLETE: 'Inspection incomplete · Missing measurements',
  INVALID_MEASUREMENTS: 'Invalid measurements',
  LEGACY_REPORT: null
});

const ELIGIBILITY_REASON_I18N_KEY = Object.freeze({
  ELIGIBLE: null,
  READINGS_INCOMPLETE: 'score.eligibility.reason.readingsIncomplete',
  INSPECTION_INCOMPLETE: 'score.eligibility.reason.inspectionIncomplete',
  READINGS_AND_INSPECTION_INCOMPLETE: 'score.eligibility.reason.readingsAndInspectionIncomplete',
  INVALID_MEASUREMENTS: 'score.eligibility.reason.invalidMeasurements',
  LEGACY_REPORT: null
});

/**
 * eligibilityState -> human reason text. Pure function of the state (plus
 * the invalid+inspection combo, which reuses the same combined phrasing
 * rule as READINGS_AND_INSPECTION_INCOMPLETE since both mean "two
 * dimensions are blocking, not one").
 */
function reasonFromState(state) {
  if (!state || !(state in ELIGIBILITY_REASON_TEXT)) return null;
  const i18nKey = ELIGIBILITY_REASON_I18N_KEY[state];
  if (i18nKey && typeof t === 'function') {
    const translated = t(i18nKey);
    // t() with no matching key in this app's i18n returns the key itself —
    // fall back to the English default rather than showing a raw key.
    if (translated && translated !== i18nKey) return translated;
  }
  return ELIGIBILITY_REASON_TEXT[state];
}

function formatEligibilityContract(contract) {
  if (!contract) {
    return Object.freeze({
      badgeText: 'Unknown',
      badgeTone: 'neutral',
      reasonText: '',
      coverageSummaryText: '',
      scoreReady: false,
      publishReady: false
    });
  }

  const canCalculate = Boolean(contract.canCalculateScore);
  const canPublish = Boolean(contract.canPublishReport ?? contract.eligible);
  // Score-ready takes presentation priority: numeric score is available even
  // when official publish is blocked by incomplete inspection.
  let badgeText;
  let badgeTone;
  if (canPublish) {
    badgeText = 'Eligible';
    badgeTone = 'good';
  } else if (canCalculate) {
    badgeText = 'Score ready';
    badgeTone = 'mid';
  } else {
    badgeText = 'Not Eligible';
    badgeTone = 'attn';
  }

  const reasonText = canPublish
    ? ''
    : (reasonFromState(contract.eligibilityState) || contract.reason || (canCalculate ? 'Inspection incomplete' : 'Not eligible'));
  const coverageSummaryText = `Measurement ${contract.measurementCoverage}% · `
    + `Inspection ${contract.inspectionCoverage}% · `
    + `Overall ${contract.overallCoverage}%`;

  return Object.freeze({
    badgeText,
    badgeTone,
    reasonText,
    coverageSummaryText,
    scoreReady: canCalculate,
    publishReady: canPublish
  });
}

if (typeof window !== 'undefined') {
  window.EligibilityPresentation = Object.freeze({
    format: formatEligibilityContract,
    reasonFromState
  });
}
