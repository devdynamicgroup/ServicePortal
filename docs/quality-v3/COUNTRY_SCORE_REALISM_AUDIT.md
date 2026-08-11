# Country Score Realism & Resolution Audit

Read-only diagnostic. No production code changed. Every number below was
produced by loading the real, unmodified engines into a `vm` sandbox and
sweeping them directly — never inferred from documentation.

Source: `.tmp_probe/country-realism-sweep.js` → `country-realism-sweep-output.json`
(raw sweep, ~250 data points across 6 parameters) and `country-realism-flags.json`
(automated same-score detector output).

---

## A. Current Architecture (verified per engine, this pass)

```
raw reading
  → parameter grade (per-country curve: flat-in-band, one-sided ramp, or
    two-sided distance-decay — shape and breakpoints differ per engine)
  → parameter weight (equal 1/1/1/1/1[/1] for Thailand/WHO; custom
    per-parameter weights for Japan/EU/US EPA — see weights.js, already
    documented in prior passes)
  → weighted average → raw composite
  → hard gate (EU only: chlorine-out-of-band caps the whole composite at 65,
    `gateCapOnChlorineFail`, regardless of other parameters)
  → Math.round() → final score
```

No other country engine has a hard gate. No country engine re-uses another
country's raw composite. Confirmed via `grep` (no cross-engine references)
in earlier passes of this review series — reconfirmed by the sweep itself
producing independent numbers per engine at every point.

---

## B. Parameter-by-Parameter Comparison (grading type + weight + gate)

| Country | Parameter | Threshold shape | Grading type | Weight | Hard gate | Rounding |
|---|---|---|---|---|---|---|
| Thailand | pH | 6.5–8.5 | flat-in-band, linear outside | 1 | none | final only |
| Thailand | TDS | ≤1000 (passMax), 1000–1500 ramp | flat + one-sided ramp | 1 | none | final only |
| Thailand | Turbidity | ≤5 (passMax), 5–12 ramp | flat + one-sided ramp | 1 | none | final only |
| Thailand | ORP | 200–600 | flat-in-band, linear outside | 1 | none | final only |
| Thailand | Chlorine | 0.2–2.0 | flat-in-band, linear outside | 1 | none | final only |
| Thailand | DO | — | **not scored** | 0 | none | — |
| Japan | pH | 5.8–8.6 | flat-in-band, linear outside | 0.16 | none | final only |
| Japan | TDS | ideal≤300 (hardcoded), ramp to displayMax 500 | flat + ramp | 0.16 | none | final only |
| Japan | Turbidity | ideal≤2, steepEnd 6 | flat + ramp | 0.22 | none | final only |
| Japan | ORP | 200–600 | flat-in-band, linear outside | 0.12 | none | final only |
| Japan | Chlorine | 0.1–1.0 | flat-in-band, linear outside | 0.22 | none | final only |
| Japan | DO | ≥5 | one-sided ramp | 0.12 | none | final only |
| WHO | pH | 6.5–8.5 (fair 6–9, poor 5.5–9.5) | **3-step discrete function** | 1 | none | final only |
| WHO | TDS | ideal≤300, fair 600, poor 1000 | 3-tier ramp | 1 | none | final only |
| WHO | Turbidity | ideal≤1, fair 5, poor 10 | 3-tier ramp | 1 | none | final only |
| WHO | ORP | 200–600 | flat-in-band, linear outside | 1 | none | final only |
| WHO | Chlorine | 0.2–0.5 (fair 1, poor 2) | **4-step discrete function** | 1 | none | final only |
| WHO | DO | ≥6 | one-sided ramp | 1 | none | final only |
| EU | pH | 6.5–9.5 | flat-in-band, linear outside | 0.15 | none | final only |
| EU | TDS | ideal≤300 (hardcoded), ramp to displayMax 500 | flat + ramp | 0.15 | none | final only |
| EU | Turbidity | ideal≤1, hardFail 4 | flat + ramp | 0.25 | none | final only |
| EU | ORP | 200–600 | flat-in-band, linear outside | 0.10 | none | final only |
| EU | Chlorine | 0.1–0.5 | flat-in-band, linear outside | 0.25 | **YES — composite capped at 65 if out of band** | final only |
| EU | DO | ≥6 | one-sided ramp | 0.10 | none | final only |
| US EPA | pH | 6.5–8.5 | flat-in-band, linear outside | 0.15 | none | final only |
| US EPA | TDS | ideal≤300 (hardcoded), ramp to smcl 500 | flat + ramp | 0.20 | none | final only |
| US EPA | Turbidity | ideal≤1, steepEnd 5 | flat + ramp | 0.30 | none | final only |
| US EPA | ORP | 200–600 | flat-in-band, linear outside | 0.10 | none | final only |
| US EPA | Chlorine | 0.2–4.0 | flat-in-band, linear outside | 0.15 | none | final only |
| US EPA | DO | ≥6 | one-sided ramp | 0.10 | none | final only |

---

## C. Threshold-Crossing Sweep Results

### C1. DO — the cleanest, best-preserved crossing (Japan 5 vs. WHO/EU/EPA 6)

| DO | Thailand | Japan | WHO | EU | EPA |
|---:|---:|---:|---:|---:|---:|
| 0 | 100 (unscored) | 88 | 83 | 90 | 90 |
| 3 | 100 | 95 | 92 | 95 | 95 |
| 4.9 | 100 | 100 | 97 | 98 | 98 |
| **5.0** | 100 | **100** | 97 | 98 | 98 |
| 5.5 | 100 | 100 | 99 | 99 | 99 |
| 5.9 | 100 | 100 | 100 | 100 | 100 |
| **6.0** | 100 | 100 | **100** | **100** | **100** |

**Reading this:** at DO exactly 5.0–5.5 mg/L — the real gap this review's own test case (DO=5.30) sits in — Japan is already at 100 while WHO/EU/EPA are still at 97–99. The crossing is preserved cleanly and continuously; no rounding or aggregation loss found anywhere in this parameter across 21 tested points. → **CASE A** below 6, **TRUE SAME RESULT** at/above 6 (all four scored engines correctly agree DO≥6 is unambiguously good).

### C2. Chlorine — TH/JP/EPA vs. WHO/EU (wide bands vs. narrow bands + EU hard gate)

| Chlorine | Thailand | Japan | WHO | EU | EPA |
|---:|---:|---:|---:|---:|---:|
| 0.15 | 96 | 96 | 87 | 82 | 96 |
| 0.2 | 100 | 100 | 100 | 89 | 100 |
| 0.5 | 100 | 100 | 100 | 100 | 100 |
| 0.7 | 100 | 100 | 95 | **65** | 100 |
| 1.0 | 100 | 100 | 92 | **65** | 100 |
| 2.0 | 100 | 92 | 79 | **65** | 100 |
| 4.0 | 96 | 78 | 68 | **65** | 100 |

**Reading this:** EU's hard gate produces a sharp, visible, correctly-differentiating floor the instant chlorine leaves 0.1–0.5 — exactly as designed. WHO shows a genuine, continuous decline distinct from Thailand/Japan/EPA's much wider tolerance. No resolution loss found. → **CASE A**, differences preserved exactly where the standards genuinely diverge.

### C3. ORP — no crossing found anywhere, for a structural reason (see §D, CASE E)

| ORP | Thailand | Japan | WHO | EU | EPA |
|---:|---:|---:|---:|---:|---:|
| 100 | 50 | 50 | 50 | 50 | 50 |
| 300 | 100 | 100 | 100 | 100 | 100 |
| 600 | 100 | 100 | 100 | 100 | 100 |
| 700 | 90 | 90 | 90 | 90 | 90 |

Identical at **every one of 71 swept points, 100–700 mV**, with zero exception. This is not a coincidence of this particular sweep — see §D.

### C4. TDS — shared "ideal=300" center, but genuinely differentiated slopes past it

| TDS | Japan | EU | US EPA | WHO |
|---:|---:|---:|---:|---:|
| 300 | 100 | 100 | 100 | 100 |
| 301 | 99.90 | 99.875 | 99.91 | 99.93 |
| 350 | 95 | 93.75 | 95.5 | 96.67 |
| 1000 | (past displayMax, declining) | (past displayMax, declining) | (past smcl, declining) | 50 |

The shared "300" only affects where the flat zone *ends* — the four engines diverge immediately and meaningfully once past it (already visibly different by TDS=301). → **CASE A** below 300 (genuinely all "ideal" there), **not** a resolution-loss case, but the shared, uncited "300" constant across three of these four is itself a separate evidence-provenance concern (§D, DOCUMENT ONLY).

### C5. pH — Japan's wider band (5.8–8.6) vs. Thailand/WHO/EPA (6.5–8.5) vs. EU (6.5–9.5)

| pH | Thailand | Japan | WHO | EU | EPA |
|---:|---:|---:|---:|---:|---:|
| 6.0 | 97 | 100 | 96 (fair-tier) | 97 | 97 |
| 6.2 | 98 | 100 | 96 | 98 | 98 |
| 8.6 | 96 | 100 | 92 | 100 | 96 |
| 8.7 | 95 | (crosses out) 98 | 92 | 100 | 92 |
| 9.5 | 84 | 87 | 78 | 100 | 82 |
| 9.6 | 81 | 84 | 78 | (crosses out) 96 | 79 |

Japan and EU's wider bands are visibly, continuously reflected exactly where they diverge from the others. → **CASE A**.

---

## D. Resolution-Loss Cases (strict classification)

### CASE A — TRUE SAME RESULT (the overwhelming majority of same-score instances)

Every "same final score across two or more countries" instance produced by
the sweep where the swept parameter's grade is **also** identical (or the
country in question doesn't score that parameter at all, e.g. Thailand/DO)
is **CASE A** — correct, not a defect, not resolution loss. This covers
essentially all of pH/TDS/Turbidity/Chlorine/DO within each country's own
comfortably-passing zone.

### CASE B / CASE C — ROUNDING / AGGREGATION DILUTION

**Searched for specifically, using an automated cross-parameter-grade
comparator against every sweep point (see `country-realism-flags.json`,
81 raw hits).** After reviewing the flagged instances by hand: **none of
them represent a genuine within-country resolution loss.** Every flagged
case is two *different* countries' independently-weighted composites
coincidentally landing on the same rounded integer while their swept
parameter's grade differs — e.g. `[chlorine=0.09] japan vs usEpa: both
finalScore=89, paramGrade 49.5 vs 27.0`. This is not information loss: each
country's own composite is internally consistent and traceable to real,
different weights and thresholds; two independently-computed numbers
landing on the same integer by coincidence is expected statistical
behavior when comparing 5 differently-weighted functions, not evidence
that either country's engine is hiding information about *itself*.

**No within-country instance was found** (across all 250 sweep points) where
a parameter's grade moved meaningfully but that same country's own final
score failed to move due to rounding or low weight. §C1 (DO) demonstrates
this directly: even at Japan's low DO weight (0.12) and EU/EPA's (0.10),
every 1–2 mg/L DO change produces a 2–13 point final-score change — no
dilution found.

**Conclusion: CASE B and CASE C — not found in this sweep**, for the 6
parameters and ranges tested.

### CASE D — FLAT-GRADE LOSS

Every country's flat-100 zone corresponds to that country's own PASS/ideal
band, not an arbitrarily-widened product choice layered on top of it — with
one caveat already flagged in prior passes of this review series (not new
here): **Thailand's TDS/Turbidity flat zones (≤1000 ppm / ≤5 NTU) are
substantially wider than the other four engines' (~300 ppm / ~1–2 NTU)**,
meaning Thailand cannot distinguish "just barely under 1000 ppm" from
"50 ppm" — both score 100. This *is* evidence-consistent with Thailand's
own stated limits (Thailand Drinking Water Standard 2024's own pass
threshold, per `limits.js` comments), so it is **not** automatically a
defect — but it is the one place a real margin-to-threshold signal is
lost *within* a single country's own scoring. → **CASE D, DOCUMENT ONLY**
(already tracked in `SCORING_RESOLUTION_REVIEW.md` §7 as an open decision;
not re-litigated here as new).

### CASE E — FORCED EQUALITY / SCORING DESIGN DEFECT

**One clear, confirmed instance, re-verified directly this pass:**

```
ORP: grades are byte-identical across all 5 countries at every one of
71 tested points spanning 100-700 mV, with zero exception.
```

Root cause (verified by reading all 5 `gradeOrp()` functions again this
pass): the formula itself —
`if (orp >= L.orp.min && orp <= L.orp.max) return 100; if (orp < L.orp.min) return clamp(orp / L.orp.min * 100); return clamp(100 - (orp - L.orp.max) / 10);`
— is character-for-character identical in all 5 `score.js` files, and all
5 `limits.js` files define `orp: { min: 200, max: 600 }` identically. This
is not "5 countries whose real standards happen to agree" — it is one
formula and one band, copy-pasted 5 times, with **no ORP standard cited
anywhere for any of the 5 countries** (confirmed across three independent
research passes earlier in this review series — `EVIDENCE_BASED_SCORING_AUDIT.md`
§Step 3, external WHO search included).

**This is CASE E as defined in this task's own framework**: parameter-level
results are (trivially) identical not because of standard semantics, but
because the code contains no per-country differentiation logic at all for
this parameter. **STOPPING here per instruction — no code change proposed
or made.**

**Secondary, milder finding (not CASE E, flagged for completeness):** TDS's
"ideal ≤300" cutoff is hardcoded identically in Japan, EU, and US EPA's
`gradeTds()` — but unlike ORP, the *slopes* past that shared point differ
meaningfully per country (§C4), so scores are **not** forced equal in
practice. This is an evidence-provenance concern (an unexplained shared
assumption), not a scoring-behavior defect. → **DOCUMENT ONLY**.

---

## E. Realism Findings

**Is there a case where the system is technically correct but could mislead
a user into thinking two countries' standards are "the same"?**

**Yes — one, and it is exactly the ORP finding above.** A user comparing
Thailand vs. EU vs. WHO for ORP will see identical scores at every possible
reading, forever, with no way to discover from the UI that this is because
no per-country ORP standard was ever implemented — not because ORP
genuinely evaluates the same way under Thai, EU, and WHO regulation. This
is a realism risk distinct from a math defect: **the score is arithmetically
correct given the code, but the code does not represent 5 independent
national standards for this one parameter**, and nothing in the current UI
discloses that distinction (this matches the exact concern already
recorded in `QUALITY_V3_MODEL_SPECIFICATION.md` §4 — reconfirmed here with
a full 71-point sweep rather than spot checks).

Every other same-score instance found in this audit (pH/TDS/Turbidity/
Chlorine/DO within their genuinely-shared PASS zones) reflects **real**
regulatory agreement or near-agreement across countries for that specific
reading, and is not misleading — a user reading "TH=JP=WHO=EU=EPA=100" for
a genuinely excellent sample is being told the truth, not shown an
artifact.

---

## F. Recommended Action Per Finding

| Finding | Classification | Recommended action |
|---|---|---|
| pH/TDS/TDS-below-300/Turbidity/Chlorine/DO same-score instances (all countries, within their real PASS zones) | CASE A — TRUE SAME RESULT | **NO ACTION** |
| DO threshold crossing (Japan 5 vs. WHO/EU/EPA 6) | CASE A, confirmed well-preserved | **NO ACTION** |
| Chlorine threshold crossing incl. EU hard gate | CASE A, confirmed well-preserved | **NO ACTION** |
| Rounding / aggregation dilution within a single country | Searched, **not found** in this sweep | **NO ACTION** |
| Thailand's wide TDS/Turbidity flat zone (own-standard margin-to-threshold lost) | CASE D — FLAT-GRADE LOSS | **DOCUMENT ONLY** (already tracked, `SCORING_RESOLUTION_REVIEW.md` §7 — not re-opened here) |
| TDS "ideal=300" hardcoded identically in JP/EU/EPA, uncited for those 3 countries specifically | Evidence-provenance concern, not a scoring defect (slopes differ) | **DOCUMENT ONLY** |
| **ORP — byte-identical formula + band across all 5 countries, zero differentiation possible for any input** | **CASE E — SCORING DESIGN DEFECT** (as defined by this task) | **PRODUCT DECISION REQUIRED** before any code change — options are: (a) find and cite genuine per-country ORP standards if they exist, (b) explicitly relabel ORP as a shared operational indicator rather than implying 5 independent national standards, (c) remove ORP from country-differentiated display entirely. **No option is implemented here.** |

---

## FINAL OUTPUT

```text
COUNTRY SCORE REALISM AUDIT

Status:
RESOLUTION LOSS FOUND (CASE D, pre-existing/tracked) + SCORING DESIGN DEFECT FOUND (CASE E, ORP)

Countries tested:
Thailand / Japan / WHO / EU / EPA

Parameters tested:
pH / TDS / Turbidity / Chlorine / ORP / DO
(43 / 39 / 42 / 33 / 71 / 21 = 249 total sweep points, plus fine
threshold-crossing points around every known distinguishing limit)

True same-score cases:
The large majority of same-score instances across the full sweep — every
one traced to a genuinely shared PASS zone across the relevant countries'
real thresholds, confirmed parameter-by-parameter.

Resolution-loss cases:
1 (CASE D — Thailand's TDS/Turbidity flat zone loses its own margin-to-
threshold signal; already tracked as an open decision, not new here;
DOCUMENT ONLY)

Scoring defects:
1 (CASE E — ORP: identical formula + band copy-pasted across all 5
country engines; zero per-country differentiation possible for any ORP
input; no cited standard found for any of the 5 countries across three
independent research passes)

Production code changed:
NO

Next action:
ORP finding requires an explicit product decision (§F) before any code
change — this document does not select an option. Thailand TDS/Turbidity
flat-zone finding remains tracked in SCORING_RESOLUTION_REVIEW.md §7,
unchanged status. No other action required — the country benchmark
system's resolution is otherwise confirmed adequate across 249 tested
points spanning all 6 scored parameters.
```
