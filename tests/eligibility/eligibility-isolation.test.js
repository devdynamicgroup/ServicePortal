/**
 * Eligibility Layer Isolation Suite
 * Run: node tests/eligibility/eligibility-isolation.test.js
 *
 * Proves the new Evidence/Coverage/Eligibility layer:
 *  - loads and runs in isolation (no DOM/task/UI access required)
 *  - never invents or defaults a missing measurement value
 *  - correctly separates Score / Coverage / Eligibility as independent concepts
 *  - does not require touching the frozen production/benchmark engines
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '../..');
const files = [
  'src/js/score/eligibility/evidenceEngine.js',
  'src/js/score/eligibility/coverageEngine.js',
  'src/js/score/eligibility/contract.js',
  'src/js/score/eligibility/eligibilityEngine.js',
  'src/js/score/eligibility/presentation.js'
];

const sandbox = { console };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const rel of files) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${msg}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${msg}`);
  }
}

// 1) Evidence Engine never invents values.
const evidenceMissing = sandbox.EvidenceEngine.describeMeasurementEvidence(undefined);
assert(evidenceMissing.state === 'Missing' && evidenceMissing.value === null,
  'Evidence Engine reports Missing (not a default number) for an absent reading');

const evidenceInvalid = sandbox.EvidenceEngine.describeMeasurementEvidence('not-a-number');
assert(evidenceInvalid.state === 'Invalid' && evidenceInvalid.value === null,
  'Evidence Engine reports Invalid (not a coerced number) for a non-numeric reading');

const evidenceMeasured = sandbox.EvidenceEngine.describeMeasurementEvidence(7.2, { origin: 'OCR', confidence: 96 });
assert(evidenceMeasured.state === 'Measured' && evidenceMeasured.value === 7.2
  && evidenceMeasured.source === 'OCR' && evidenceMeasured.confidence === 96,
  'Evidence Engine preserves source/confidence metadata for a real reading');

// 2) Coverage Engine: coverage != eligibility, never decides score.
const coverageFull = sandbox.CoverageEngine.calculateCoverage({
  evidence: sandbox.EvidenceEngine.buildEvidenceMap(
    { ph: 7.2, tds: 450, orp: 300, do: 6, chlorine: 0.5, turbidity: 2 }
  ),
  requiredMeasurements: ['ph', 'tds', 'orp', 'do', 'chlorine', 'turbidity'],
  tasks: { tapphoto: true, meter: true, visual: true, chlorine: true },
  requiredTasks: ['tapphoto', 'meter', 'visual', 'chlorine']
});
assert(coverageFull.measurementCoverage === 100 && coverageFull.inspectionCoverage === 100,
  'Coverage Engine reports 100/100 when everything required is present');
assert(!('score' in coverageFull), 'Coverage Engine output never includes a score field');

const coveragePartial = sandbox.CoverageEngine.calculateCoverage({
  evidence: sandbox.EvidenceEngine.buildEvidenceMap({ ph: 7.2, tds: 450 }),
  requiredMeasurements: ['ph', 'tds', 'orp', 'do', 'chlorine', 'turbidity'],
  tasks: { tapphoto: true },
  requiredTasks: ['tapphoto', 'meter', 'visual', 'chlorine']
});
assert(coveragePartial.missingMeasurements.length === 4 && coveragePartial.missingInspection.length === 3,
  'Coverage Engine correctly enumerates missing measurements AND missing inspection tasks independently');

// 3) Eligibility Engine: numeric score calculable while publish blocked by inspection.
const eligibilityBlocked = sandbox.EligibilityEngine.evaluate({
  reportType: 'production',
  readings: { ph: 7.2, tds: 450, orp: 300, do: 6, chlorine: 0.5, turbidity: 2 }, // full measurements
  tasks: { tapphoto: true, meter: true, visual: false, chlorine: true } // inspection incomplete
});
assert(eligibilityBlocked.measurementCoverage === 100, 'Full measurements -> measurementCoverage 100');
assert(eligibilityBlocked.inspectionCoverage === 75, 'One of four required tasks incomplete -> inspectionCoverage 75');
assert(eligibilityBlocked.canCalculateScore === true, 'canCalculateScore is true with full numeric inputs');
assert(eligibilityBlocked.canPublishReport === false, 'canPublishReport is false when inspection is incomplete');
assert(eligibilityBlocked.eligible === false, 'eligible alias follows canPublishReport (false)');
assert(eligibilityBlocked.reason === 'Inspection incomplete', 'Reason correctly attributes the publish block to inspection, not measurements');
assert(sandbox.EligibilityContract.isValid(eligibilityBlocked), 'Result conforms to the documented Eligibility Contract shape');

const eligibilityOk = sandbox.EligibilityEngine.evaluate({
  reportType: 'production',
  readings: { ph: 7.2, tds: 450, orp: 300, do: 6, chlorine: 0.5, turbidity: 2 },
  tasks: { tapphoto: true, meter: true, visual: true, chlorine: true }
});
assert(eligibilityOk.canCalculateScore === true && eligibilityOk.canPublishReport === true
  && eligibilityOk.eligible === true && eligibilityOk.reason === null,
  'Both gates true and reason null when measurements + inspection are fully covered');

// 4) Registry is open for extension — a new report type never requires touching this engine's code.
sandbox.EligibilityPolicyRegistry.register({
  key: 'industrial',
  label: 'Industrial Report',
  requiredMeasurements: ['ph', 'tds'],
  requiredTasks: []
});
assert(sandbox.EligibilityPolicyRegistry.has('industrial'), 'New report-type policies can be registered without modifying the engine');

// 5) Presentation is a pure formatter of the contract, nothing else.
const presented = sandbox.EligibilityPresentation.format(eligibilityBlocked);
assert(presented.badgeText === 'Score ready' && presented.reasonText === 'Inspection incomplete',
  'Presentation shows Score ready when calculable but not publishable, without recomputing anything');
assert(presented.scoreReady === true && presented.publishReady === false,
  'Presentation exposes scoreReady / publishReady from the contract flags');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
