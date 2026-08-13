# Model Governance — Evidence → Decision → Repair

**Status:** ACTIVE (2026-08-13)  
**Case flow:** UNTOUCHED  
**Numeric model:** FROZEN until Product Decision authorizes specific constant `id`s

```text
Layer order (mandatory):

  EVIDENCE REGISTRY (SoT)
       → PRODUCT DECISION
            → MODEL REPAIR (gated)
                 → SCORE / UI (if in scope)

Forbidden reverse:
  DESIRED BASELINE / FEELING → TUNE NUMBERS → JUSTIFY
```

## Source of truth

| Artifact | Authority |
| --- | --- |
| [`evidence-registry/constants.json`](evidence-registry/constants.json) | **SoT for constant status** (evidence_class, action, lock_state, citation_status) |
| [`evidence-registry/README.md`](evidence-registry/README.md) | Schema + freeze rules |
| [`UNRESOLVED_DECISIONS.md`](UNRESOLVED_DECISIONS.md) | Product Decision log (OPEN / DECIDED) |
| [`COUNTRY_BENCHMARK_SEMANTIC_CONTRACT.md`](COUNTRY_BENCHMARK_SEMANTIC_CONTRACT.md) | Country Benchmark display/meaning contract |
| [`evidence-registry.json`](evidence-registry.json) | **Samples only** — not constant provenance |

If docs disagree with `constants.json` on a constant’s `evidence_class` / `action` / `citation_status`, **`constants.json` wins** until an explicit registry edit is committed with rationale.

## Lock states (on every constant)

| `lock_state` | Meaning | Editable without PD? |
| --- | --- | --- |
| `LOCKED_KEEP` | Source-backed KEEP | **No** numeric change |
| `LOCKED_LABEL` | KEEP BUT LABEL — copy/label only | **No** numeric change |
| `MODEL_REPAIR_GATED` | Redesign candidate (CONFLICTING / unsupported national claim) | **No** until Model Repair PD cites `id` |
| `RESEARCH_BLOCKED` | RESEARCH — citation missing or incomplete | **No** until research closes or PD accepts `NO CITATION` |
| `PD_REQUIRED` | Weights / ideals / tier scores / design magnitudes | **No** until Product Decision |

Global flag in registry: `governance.model_change_authorized_global = false`.

## What is “แก้ได้” vs “ห้ามแก้”

### แก้ได้เลย (non-numeric)

- Documentation / labels that match registry (`KEEP BUT LABEL`, OPERATIONAL framing)
- Semantic / policy tests that **freeze** math
- Bug-fixes that do **not** change thresholds, weights, curves, or gates (classification / null coercion class)

### ห้ามแก้จนกว่าจะมี Product Decision

- Any `code_value` in `constants.json`
- Weights, Q-V3 ideals/curves, WHO tier scores, EU gate magnitude
- All `redesign_candidate: true` rows (TH Cl, EPA Cl, EU Cl, JP DO)

### ห้ามเด็ดขาดในรอบนี้

- Tuning for baseline aesthetics (`76/100/100/95/65/99`)
- Artificial TH≠JP differentiation
- Case / Notion / Booking / Calendar / API route changes
- Inventing citations for `NO CITATION` rows

## Decision queue (2026-08-13)

| ID | Topic | Status | Unlocks |
| --- | --- | --- | --- |
| PD-001…005 | Presentation / gate / TH DO / ORP / ranking | **DECIDED A** | Docs/UX only (done) |
| **PD-006** | Country Score = Compliance Index | **DECIDED A** | Channel identity locked |
| **PD-007** | Quality V3 mean/6 + FAIL publish override | **DECIDED D** | Presentation hybrid authorized |
| **PD-008** | Cl provenance (TH/EPA/EU) + JP DO deferred | **DECIDED partial** | Label/provenance only; no Cl magnitude |
| **PD-009** | Quality catastrophe / publish safety meaning | **DECIDED B** | WARNING presentation override (no numeric gate) |
| **PD-010** | Q-V3 Ideal pack (pH/TDS/ORP/DO/Cl>0.5) | **DECIDED B** | Research complete; Ideal numbers frozen; SAFE TO REPAIR = none |
| **PD-011** | Q-V3 Ideal disposition (R-010-1…5) | **DECIDED A ×5** | KEEP+LABEL PROJECT-DEFINED; no Ideal numeric change |

```text
Model Repair must cite constant id(s) from the registry.
Unlisted constants remain frozen.
PD-011 A does not authorize Ideal magnitude edits.
```

## Redesign candidates (still frozen)

From registry (`redesign_candidate: true`):

1. `TH-CHLORINE-BAND`
2. `EPA-CHLORINE-BAND`
3. `EU-CHLORINE-BAND`
4. `JP-DO-MIN`

Plus later (PD_REQUIRED / RESEARCH, not silent fixes): weights, Q-V3 ideals, WHO tiers.

## Acceptance for any future model commit

1. Cited `constant.id` list in commit message / PD record  
2. Matching DECIDED PD (usually PD-008 or a child PD)  
3. Registry row updated in the **same** change set (status after repair)  
4. Baseline regression replay recorded (construction only — not a tune target)  
5. Case flow diff empty  

## Related

- Product Decision log: `UNRESOLVED_DECISIONS.md`
- Workshop board: Cursor canvas `product-decision-governance.canvas.tsx` (IDE canvases folder)
