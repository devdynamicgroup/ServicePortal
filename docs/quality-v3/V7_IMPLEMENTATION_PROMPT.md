# V7 Implementation Prompt

**Status:** READY FOR PLANNING — not an authorization to edit scoring code yet  
**Contract source (ratified 2026-08-17):**  
[`CANONICAL_SCORE_MODEL_V1_PRODUCT_DESIGN_GATE.md`](./CANONICAL_SCORE_MODEL_V1_PRODUCT_DESIGN_GATE.md)  
[`CANONICAL_SCORE_MODEL_SPECIFICATION_V1.md`](./CANONICAL_SCORE_MODEL_SPECIFICATION_V1.md)

```text
DESIGN GATE: APPROVED
IMPLEMENTATION READINESS: READY FOR V7 IMPLEMENTATION PLANNING

DO NOT change scoring code until:
  1. This Implementation Plan phases are followed in order
  2. Calibration Gate clears α / exact F (and any other TBD numerics)
  3. Product explicitly opens “V7 Implementation Execution” if required by ops process
```

---

## 0. Absolute contracts (do not reopen)

| ID | Decision |
|----|----------|
| PD-V7-01 | `finalScore = qualityScore` |
| PD-V7-02 | `riskSeverity` separate mandatory; never writes `finalScore` |
| PD-V7-03 | Canonical **HYBRID-FAMILY** for all countries |
| PD-V7-RANGE | Live `finalScore ∈ [0,99]`; **100 reserved for Q-V3** |
| PD-V7-04 | SUPERSEDE PD-006 live-Hero identity + legacy matrix in gate doc |
| PD-V7-09 | Published artifacts **WRITE-ONCE** |

```text
PASS ≠ 100
PASS ≠ automatic penalty
Country = BenchmarkProfile only (not a private aggregation algorithm)
Missing required data → NOT_COMPUTABLE (not 0, not 100)
NOT_APPLICABLE / NOT_EVALUATED ≠ quality 100
Q-V3 remains an isolated publish channel
α / exact F = TBD until Calibration Gate
```

Forbidden goals: “make scores lower,” “make Case X look right,” invent constants.

---

## 1. Target architecture

```text
Reading
  → Validation (MeasurementValidator + required set)
  → Parameter Quality (ideal-centered; profile curves)
  → Canonical Hybrid Aggregation
       Q_mean = Σ(wᵢ qᵢ)/Σ wᵢ
       Q_min  = min(qᵢ) over scored/applicable params
       qualityScore = round( F(Q_mean, Q_min) )   // F in hybrid family; α TBD
  → Compliance Evaluation → complianceStatus
  → Risk Evaluation → riskSeverity (separate)
  → finalScore := qualityScore clamped to [0,99]
  → Display: Quality + Compliance + Risk + Computability
```

`modelVersion` example: `canonical-v1` / `country-benchmark-v7` (pick one string at execution start; do not invent multiple without need).  
`benchmarkVersion`: per-profile evidence bundle id.

---

## 2. Phased plan (execution order)

### Phase A — Safety before any live Hero switch

1. **PD-V7-09 write-once**  
   - Audit `POST /api/cases/:id/score`, share/close publish paths.  
   - Make published `Latest Water Score` immutable for a publication identity.  
   - Re-publish → new versioned publication event (no silent overwrite).  
   - Additive fields if needed: `modelVersion`, `calculatedAt` / `publishedAt`, optional fingerprint.  
   - **Do not rename** existing Notion properties.

2. Feature flag for canonical live path (default **off**).

### Phase B — Canonical module skeleton (behind flag)

1. Add shared canonical pipeline module (new files preferred; avoid forking five incompatible aggregators).  
2. Port engines to **BenchmarkProfile** data: ideals, curves, limits, weights, applicability, provenance.  
3. Remove / bypass as live writers of `finalScore`:  
   - post-aggregate severity caps on the quality digit  
   - EU chlorine gate as composite score rewrite (may become compliance/risk rule only after explicit mapping)  
   - per-country aggregation (TH weakest-link share as *country algorithm* — superseded; hybrid is canonical)  
4. Wire `finalScore = qualityScore` with domain `[0,99]`.  
5. Emit `complianceStatus` + `riskSeverity` as first-class outputs.  
6. `NOT_COMPUTABLE` when required params missing/invalid.

**Still forbidden in this phase:** shipping a guessed `α`. Use placeholder only behind flag with tests that treat `α` as injected config, or hold Hero on legacy engines until Calibration Gate passes.

### Phase C — Calibration Gate (required before numeric go-live)

Inputs allowed:

- Complete real Cases only for before/after impact  
- Synthetic fixtures for mathematical invariants only  
- Evidence registry: `CITED` | `PRODUCT_DECISION` | `UNKNOWN`

Deliverables:

1. Proposed `α` (or equivalent `F`) with evidence / Product decision id  
2. Before/after table on complete Cases (`NOT_COMPUTABLE` for incomplete)  
3. Invariant suite green (see §4)  
4. Explicit Product/ops approval of each numeric constant id  

```text
Until Phase C clears: no production Hero switch to V7 numbers.
```

### Phase D — UI / report contract (minimal)

Display separation (no semantic merge):

```text
Quality Score: <0–99>
Compliance: PASS|WARNING|FAIL|…
Risk: PASS|WARNING|FAIL|CRITICAL|…
Status: COMPUTABLE | NOT_COMPUTABLE
```

Forbidden UI behaviors:

- PASS → render 100  
- riskSeverity → mutate displayed quality  
- Hide CRITICAL when quality is high  

Q-V3 public `/r/{token}` continues to prefer **persisted published** score.

### Phase E — Staged rollout

1. Flag on for internal/staff only  
2. Compare legacy vs V7 on complete Cases  
3. Default on when calibration + write-once verified  
4. Rollback = flag off; published snapshots untouched  

---

## 3. File / module guidance (planning only)

Expect touch set when execution opens (illustrative, not a mandate to edit now):

| Area | Likely paths |
|------|----------------|
| Live score orchestration | `src/js/flows/score.js` |
| Registry / engines | `src/js/score/benchmark/**` |
| Severity / ceiling util | `src/js/score/util/benchmarkMetadata.js` |
| Publish write path | `services/workflow-service.js`, `api/case-flow-routes.js` |
| Notion map (additive only) | `services/notion/mapper.js`, `clients.js` |
| Tests | `tests/score/**`, `tests/benchmark/**` |

Do **not** merge Country into Q-V3 (`computeQualityScoreV2.js`) without a separate PD.

---

## 4. Permanent regression invariants

1. All ideal → maximum live quality (**99** under RANGE A)  
2. Degradation → score must not increase  
3. PASS ≠ automatic 100; PASS ≠ automatic penalty  
4. Hybrid responds to mediocre dimension (no mean-only dilution failure at ratified α)  
5. Hybrid does not collapse to single-dimension domination without evidence  
6. Risk change → `qualityScore` / `finalScore` unchanged  
7. Missing required → `NOT_COMPUTABLE`  
8. Deterministic  
9. Country changes profile only; same aggregator  
10. Published score not silently overwritten  
11. Q-V3 isolation preserved  

---

## 5. Simulation checklist (pre-execution / calibration)

| # | Scenario | Purpose |
|---|----------|---------|
| 1 | All ideal | Max = 99 |
| 2 | Small degrade | Observable Δ |
| 3 | PASS but far from ideal | Quality falls; compliance PASS |
| 4 | One severe quality grade | Hybrid sensitivity |
| 5 | Multiple degrade | Cumulative monotone |
| 6 | One excellent + one poor | Dilution vs domination |
| 7 | Risk CRITICAL, quality high | Digit unchanged; risk visible |
| 8 | Missing required | NOT_COMPUTABLE |
| 9 | Same readings × 5 profiles | Profile deltas only |
| 10 | Re-publish path | No silent overwrite |

---

## 6. Explicit non-goals

- Portal / Case lifecycle / OCR redesign  
- Notion property renames  
- Auto-recalculate historical published Q-V3  
- Cross-country magnitude ranking  
- Inventing α “because it looks right”  
- Case-specific patches  

---

## 7. Definition of done for “Implementation Planning”

Planning is complete when this prompt is accepted as the execution contract and:

- [ ] Write-once design tasks listed with owners  
- [ ] Canonical module boundary listed  
- [ ] Calibration protocol + evidence sources listed  
- [ ] Flag / rollout / rollback listed  
- [ ] Test matrix mapped to existing test folders  

**Scoring code remains unchanged until execution is explicitly started under Phase A→C rules.**

---

## 8. One-line kickoff for a future agent (when Product opens execution)

```text
Execute V7 per docs/quality-v3/V7_IMPLEMENTATION_PROMPT.md.
Design package is ratified. Do not reopen PD-V7-01..09.
Do not invent α. Start Phase A (write-once) only.
No deploy of live V7 Hero until Calibration Gate clears.
```
