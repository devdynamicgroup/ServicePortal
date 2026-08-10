# Quality V3 — Parameter Evidence Matrix

Per-parameter evidence classification for `computeQualityScoreV2.js`
(`quality-v3.0`). Complements the provenance table in
`docs/QUALITY_V3_MODEL_SPECIFICATION.md` (repo-root `docs/`) with explicit
sample-count columns, so nothing here can be silently upgraded from
`UNKNOWN` to a stronger category just because a value looks chemically
plausible.

Source-type classification used below: `DIRECT_STANDARD`,
`EXTERNAL_REFERENCE`, `EXPERT_DECISION`, `PRODUCT_DECISION`, `CASE_DRIVEN`,
`UNKNOWN`. All six real-sample/label columns are drawn from
`docs/quality-v3/evidence-registry.json`, which currently has exactly one
`REAL` record (Case 1328) — the same count applies to every parameter,
since Case 1328 supplies all six readings simultaneously.

| Parameter | Center | Breakpoints/slopes | Source (center) | Source_type | Independent source? | Real samples | Outcome labels | Calibration samples | Validation samples | Holdout samples | Confidence | Unresolved questions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pH | 7.2 | 0.15/0.4/0.8/1.3/1.8 (`\|Δ\|`) | "midpoint of common 6.5–8.5 acceptability band" | `EXTERNAL_REFERENCE` (center only) | No — band named, not linked | 1 | 0 | 1 | 0 | 0 | LOW | Pass-window vs. distance-decay shape undocumented; all breakpoints `UNKNOWN` |
| TDS | ≤80 | 120/200/300/500/1000 | "Japan complementary residue preference (30–200)... EPA SMCL 500" | `EXTERNAL_REFERENCE` (center only, self-acknowledged stricter than cited) | No | 1 | 0 | 1 | 0 | 0 | LOW | Ideal center chosen well below cited standards — intentional per comment, but rationale for the specific gap is undocumented; breakpoints `UNKNOWN` |
| Turbidity | ≤0.08 | 0.2/0.5/1.0/3.0/5.0 | "stricter than former ≤1 plateau and under EU plant operational ref 0.3 NTU (ops ≠ Ideal)" | `EXPERT_DECISION` | No — comment self-flags "ops ≠ Ideal" | 1 | 0 | 1 | 0 | 0 | LOW | Same shape-choice gap as TDS; breakpoints `UNKNOWN` |
| ORP | 400 | 25/70/130/200 (`\|Δ\|`) | "midpoint of former operational 200–600 (no external Ideal)" | `CASE_DRIVEN` / `EXPERT_DECISION` | No — self-admitted no external source | 1 | 0 | 1 | 0 | 0 | UNKNOWN | Identical band copy-pasted across all 5 country benchmark engines with no independent country derivation (see `QUALITY_V3_MODEL_SPECIFICATION.md` §4); breakpoints `UNKNOWN` |
| Chlorine (free) | 0.30 | 0.025/0.08/0.15/0.22 + raw-value branches below 0.1 and up to 2.0 | "midpoint of former Prod residual 0.2–0.5" | `PRODUCT_DECISION` (derived from a prior internal constant) | No | 1 | 0 | 1 | 0 | 0 | LOW | Structurally the most complex curve (mixed distance + raw-value branches); no documented rationale for branch boundaries |
| DO | ≥8.0 | 7.2/6.5/6.0/5.0/3.0, no upper bound in this file | "Near-Ideal ≥8.0; ≥6.0 is Compliance floor (~68), not exceptional" | `EXPERT_DECISION` | No | 1 | 0 | 1 | 0 | 0 | LOW | Ideal value 8.0 undocumented beyond this comment; physical upper-bound handling lives in the input-validation layer, not this file |

## Reading this table correctly

- **1 real sample everywhere** means exactly that — every "real samples"
  cell is `1` because Case 1328 is the only real profile in the repository
  and it supplies all six readings at once, not six independent samples.
- **`LOW`/`UNKNOWN` confidence is not a defect finding** — it is an honest
  statement that no parameter here has enough independent evidence to
  support a stronger claim yet. See `docs/quality-v3/CALIBRATION_WORKFLOW.md`
  §7 for what would be required to raise any of these.
- No cell in this table was upgraded merely because a value is chemically
  or operationally plausible. Plausibility is not evidence.
