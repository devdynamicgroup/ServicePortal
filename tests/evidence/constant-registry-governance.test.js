/**
 * Constant/clause evidence registry governance locks.
 * Does not import or invoke any scoring engine.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '../../docs/quality-v3/evidence-registry/constants.json');
const REQUIRED = [
  'id', 'engine', 'parameter', 'code_value', 'code_path', 'semantic',
  'evidence_class', 'source_name', 'source_url', 'clause', 'unit',
  'source_value', 'semantic_gap', 'action', 'citation_status',
  'redesign_candidate', 'notes', 'lock_state', 'model_change_authorized',
  'editable_without_pd'
];
const LOCKS = new Set([
  'LOCKED_KEEP', 'LOCKED_LABEL', 'MODEL_REPAIR_GATED', 'RESEARCH_BLOCKED', 'PD_REQUIRED'
]);
const ACTION_TO_LOCK = {
  KEEP: 'LOCKED_KEEP',
  'KEEP BUT LABEL': 'LOCKED_LABEL',
  'REMOVE/REVIEW': 'MODEL_REPAIR_GATED',
  RESEARCH: 'RESEARCH_BLOCKED',
  'PRODUCT DECISION': 'PD_REQUIRED'
};

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));

assert.strictEqual(registry.authority, 'SOURCE_OF_TRUTH', 'registry authority is SOURCE_OF_TRUTH');
assert.strictEqual(registry.governance.model_change_authorized_global, false, 'global model change unauthorized');
assert.ok(Array.isArray(registry.constants) && registry.constants.length > 0, 'constants non-empty');

const redesign = [];
for (const row of registry.constants) {
  for (const key of REQUIRED) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, key), `${row.id || '?'} missing field ${key}`);
  }
  assert.ok(LOCKS.has(row.lock_state), `${row.id} invalid lock_state ${row.lock_state}`);
  assert.strictEqual(row.model_change_authorized, false, `${row.id} model_change_authorized must be false`);
  assert.strictEqual(row.editable_without_pd, false, `${row.id} editable_without_pd must be false`);
  assert.strictEqual(
    row.lock_state,
    ACTION_TO_LOCK[row.action],
    `${row.id} lock_state must match action ${row.action}`
  );
  if (row.citation_status === 'NO CITATION') {
    assert.strictEqual(row.source_name, '', `${row.id} NO CITATION ⇒ empty source_name`);
    assert.strictEqual(row.source_url, '', `${row.id} NO CITATION ⇒ empty source_url`);
    assert.strictEqual(row.clause, '', `${row.id} NO CITATION ⇒ empty clause`);
    assert.strictEqual(row.source_value, '', `${row.id} NO CITATION ⇒ empty source_value`);
  }
  if (row.redesign_candidate) redesign.push(row.id);
}

const expectedRedesign = [].sort();
assert.deepStrictEqual(redesign.slice().sort(), expectedRedesign, 'no redesign-candidate rows after PD-012 B (JP-DO-MIN removed from Compliance Index)');

const decisionDoc = fs.readFileSync(
  path.join(__dirname, '../../docs/quality-v3/UNRESOLVED_DECISIONS.md'),
  'utf8'
);
assert.ok(/## PD-006:[\s\S]*?\*\*Status:\*\* DECIDED/.test(decisionDoc), 'PD-006 DECIDED');
assert.ok(decisionDoc.includes('COMPLIANCE INDEX'), 'PD-006 A recorded');
assert.ok(/## PD-007:[\s\S]*?\*\*Status:\*\* DECIDED/.test(decisionDoc), 'PD-007 DECIDED');
assert.ok(decisionDoc.includes('QUALITY + COMPLIANCE HYBRID'), 'PD-007 D recorded');
assert.ok(/## PD-009:[\s\S]*?\*\*Status:\*\* DECIDED/.test(decisionDoc), 'PD-009 DECIDED');
assert.ok(decisionDoc.includes('EXTEND PRESENTATION OVERRIDE TO WARNING'), 'PD-009 B recorded');
assert.ok(/## PD-010:[\s\S]*?\*\*Status:\*\* DECIDED/.test(decisionDoc), 'PD-010 DECIDED');
assert.ok(decisionDoc.includes('RESEARCH BLOCK'), 'PD-010 B recorded');
assert.ok(decisionDoc.includes('Nattakamon Ph.'), 'PO Approved by recorded');
assert.ok(/## PD-011:[\s\S]*?\*\*Status:\*\* DECIDED/.test(decisionDoc), 'PD-011 DECIDED');
assert.ok(decisionDoc.includes('KEEP + LABEL') || decisionDoc.includes('KEEP+LABEL'), 'PD-011 A recorded');
assert.ok(/## PD-012:[\s\S]*?\*\*Status:\*\* DECIDED/.test(decisionDoc), 'PD-012 DECIDED');
assert.ok(decisionDoc.includes('REMOVE DO from Japan Compliance Index'), 'PD-012 B recorded');
assert.ok(/## PD-013:[\s\S]*?\*\*Status:\*\* DECIDED/.test(decisionDoc), 'PD-013 DECIDED');

const researchTickets = fs.readFileSync(
  path.join(__dirname, '../../docs/quality-v3/research/PD-010-IDEAL-RESEARCH-TICKETS.md'),
  'utf8'
);
for (const id of ['QV3-PH-CENTER', 'QV3-TDS-NI', 'QV3-ORP-NI', 'QV3-DO-NI', 'QV3-CHLORINE-BAND-CURVE']) {
  assert.ok(researchTickets.includes(id), `PD-010 research ticket covers ${id}`);
}
assert.ok(researchTickets.includes('NO CITATION'), 'PD-010 tickets require NO CITATION until evidence');
assert.ok(researchTickets.includes('New Product Decision') || researchTickets.includes('new Product Decision'), 'PD-010 requires new PD before numeric');

const byId = new Map(registry.constants.map((c) => [c.id, c]));
for (const id of ['QV3-PH-CENTER', 'QV3-TDS-NI', 'QV3-ORP-NI', 'QV3-DO-NI', 'QV3-CHLORINE-BAND-CURVE']) {
  const row = byId.get(id);
  assert.ok(row, `${id} exists`);
  assert.strictEqual(row.lock_state, 'LOCKED_LABEL', `${id} LOCKED_LABEL under PD-011 A`);
  assert.strictEqual(row.action, 'KEEP BUT LABEL', `${id} KEEP BUT LABEL`);
  assert.strictEqual(row.model_change_authorized, false, `${id} not authorized for model change`);
  assert.ok(String(row.notes).includes('PD-011 A'), `${id} notes cite PD-011 A`);
}
assert.strictEqual(byId.get('QV3-PH-CENTER').code_value, 'center=7.2', 'QV3-PH-CENTER numeric unchanged');
assert.strictEqual(byId.get('QV3-TDS-NI').code_value, 'NI ≤80', 'QV3-TDS-NI numeric unchanged');
assert.strictEqual(byId.get('QV3-ORP-NI').code_value, 'center=400, NI |Δ|≤25', 'QV3-ORP-NI numeric unchanged');
assert.ok(byId.get('QV3-DO-NI').code_value.includes('≥8'), 'QV3-DO-NI numeric unchanged');
assert.ok(byId.get('QV3-CHLORINE-BAND-CURVE').code_value.includes('46@1.0'), 'Cl high-side anchors unchanged');
assert.strictEqual(byId.get('JP-DO-MIN').redesign_candidate, false, 'JP-DO-MIN no longer redesign_candidate');
assert.strictEqual(byId.get('JP-DO-MIN').lock_state, 'LOCKED_LABEL', 'JP-DO-MIN LOCKED_LABEL after PD-012 B');
assert.ok(String(byId.get('JP-DO-MIN').notes).includes('PD-012'), 'JP-DO-MIN notes cite PD-012');

console.log(`constant-registry governance OK (${registry.constants.length} rows, redesign=${redesign.join(',') || 'none'})`);
