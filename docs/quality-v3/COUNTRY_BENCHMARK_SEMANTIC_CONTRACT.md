# Country Benchmark — Semantic Contract

**Status:** ACTIVE (documentation / product contract)  
**HEAD reference:** `02387730` and later  
**Scope:** Country benchmark engines only — **does not change scoring math**

This document is the authoritative product contract for what Country Benchmark
scores mean, how they may be displayed, and what they must **not** be claimed
to represent. It implements the verified root-cause audit findings (semantic
mismatch, unsupported EU gate anchor, shared ORP, Thailand DO exclusion).

---

## Core contract

**Country Benchmark** is a **country-specific compliance / benchmark signal**
for the selected reference engine. It is:

- a **comparison view** for the same field readings under one selected engine
- **not** a universal water-quality score
- **not** a cross-country ranking
- **not** interchangeable with **Quality V3** (Hero / publish path)

Rules:

1. **Score magnitude must not be interpreted as “Country A water is better than
   Country B water.”** Different engines use different parameter sets, grading
   semantics, weights, and gates.
2. **Identical scores between countries are allowed** and must **not** be
   artificially differentiated for visual spread.
3. **Quality V3**, **Compliance** (PASS/WARNING/FAIL), and **Country Benchmark**
   remain three separate channels (see `computeQualityScoreV2.js` architecture
   comment and `tests/score/quality-compliance-separation.test.js`).

---

## Per-engine semantics (current implementation)

### Thailand

- **Included in score:** pH, TDS, chlorine, turbidity, ORP (equal weights).
- **Excluded by project design:** DO and temperature (`weights.js` — not scored).
- **Weak DO can fail to reduce Thailand's benchmark score** because DO is omitted
  from the composite, not because a cited Thai standard was proven to omit DO.
- **Do not claim** “Thailand's drinking-water standard does not include DO”
  unless an authoritative citation is added to the evidence registry.
- **100 in-band** means **within modeled acceptability bands** (compliance-style
  flat grade), **not** near-perfect water quality.

### Japan

- **Compliance-style composite** with flat in-band grading for most parameters.
- **100** means **modeled criteria pass** inside accepted bands, **not**
  near-perfect or “exceptional” water quality in an absolute sense.
- DO ≥ 5 mg/L is scored; temp is display-only (zero weight).

### WHO (country engine)

- **Project guideline / proximity hybrid** — soft tiers on chlorine and DO,
  flat in-band elsewhere.
- **Do not call** this an **official WHO water-quality index** or WHO product
  score. It is a Water Motion comparison engine inspired by guideline framing.

### EU

- **Parametric / indicator composite** with a **hard chlorine gate**
  (`gateCapOnChlorineFail = 65`).
- **EU 65 is an implementation / model outcome**, **not** “EU Directive score =
  65” and not an official regulatory index.
- **`gateCapOnChlorineFail = 65` remains UNSUPPORTED ANCHOR** — no replacement
  without evidence and product decision (`COUNTRY_SCORE_SEMANTICS_REVIEW.md`).

### US EPA

- **Engineering benchmark** inspired by selected EPA-style limits (e.g. MRDL/SMCL
  framing for some parameters).
- **Do not call** this an **official EPA water-quality score**.
- DO ≥ 6 mg/L is a **model / operational parameter** unless authoritative
  drinking-water MCL evidence is added.

### ORP (all five engines)

- Band **200–600 mV** is **shared operational logic** across all engines.
- **Do not describe** it as five independently verified national drinking-water
  standards (`NO COUNTRY-SPECIFIC DRINKING-WATER STANDARD VERIFIED` for ORP).

---

## Verdict labels (Excellent / Good / …)

**PD-001 = DECIDED A:** Country Benchmark **UI presentation** uses pass-band /
comparison-pass language (`Within pass band`, etc.). Engine-authored
`verdictFrom()` strings (e.g. Excellent) may still exist in engine metadata
but must not be shown as the Country Benchmark comparison badge meaning.

Engine and UI tier labels for Quality V3 remain separate (quality channel).

---

## Cross-country numeric comparison

**PD-005 = DECIDED A — FORBID MAGNITUDE RANKING.** Numeric comparison across
engines is **not valid** for magnitude ranking.

Allowed use: **“Under engine X, these readings yield score Y”** for the
**selected** engine only. Equal scores remain valid.

---

## Evidence and change policy

```text
STOP — NO SAFE NUMERIC FIX
```

Without sufficient evidence:

- do **not** replace `gateCapOnChlorineFail = 65`
- do **not** tune thresholds, weights, or curves to create country spread
- do **not** add DO to Thailand or remove DO from other engines without
  product + evidence review
- do **not** invent per-country ORP standards

Permitted now: **documentation**, **UI copy** that prevents misinterpretation,
and **semantic contract tests** that lock scoring math unchanged.

---

## Related artifacts

- Root-cause audit: `COUNTRY_SCORE_SEMANTICS_REVIEW.md`, `COUNTRY_SCORE_REALISM_AUDIT.md`
- EU gate provenance: commit `f5579564`, `docs/BENCHMARK_ENGINE_COMPARISON_SAMPLE.md`
- Isolation: `tests/benchmark/benchmark-isolation.test.js`
- Channel separation: `tests/score/quality-compliance-separation.test.js`
- Semantic contract tests: `tests/score/country-benchmark-semantics.test.js`
