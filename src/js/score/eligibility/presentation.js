/**
 * Eligibility Presentation adapter — formats the Eligibility Contract into
 * display-ready strings/flags only. Never performs business logic, never
 * guesses completeness, never recalculates coverage, never reads
 * measurements itself. Pure function of the contract it's given.
 *
 * This is a formatter, not a UI wiring — nothing here touches the DOM.
 * Wiring an actual screen to consume it is Phase B.
 */
function formatEligibilityContract(contract) {
  if (!contract) {
    return Object.freeze({
      badgeText: 'Unknown',
      badgeTone: 'neutral',
      reasonText: '',
      coverageSummaryText: ''
    });
  }

  const badgeText = contract.eligible ? 'Eligible' : 'Not Eligible';
  const badgeTone = contract.eligible ? 'good' : 'attn';
  const reasonText = contract.eligible ? '' : (contract.reason || 'Not eligible');
  const coverageSummaryText = `Measurement ${contract.measurementCoverage}% · `
    + `Inspection ${contract.inspectionCoverage}% · `
    + `Overall ${contract.overallCoverage}%`;

  return Object.freeze({
    badgeText,
    badgeTone,
    reasonText,
    coverageSummaryText
  });
}

if (typeof window !== 'undefined') {
  window.EligibilityPresentation = Object.freeze({
    format: formatEligibilityContract
  });
}
