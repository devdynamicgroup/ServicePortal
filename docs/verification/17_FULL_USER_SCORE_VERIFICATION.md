# 17 — Full User-Real Score Verification

**Mode:** QA / Verification only — **no scoring formula, weight, severity, country, or Quality V3 changes**  
**Date:** 2026-08-20  
**Environment:** Local Field App `http://127.0.0.1:3177` · manual Case `local-score-qa-v17` (no Notion write)  
**Independent calculator:** `.tmp_probe/independent-calc.js` → `.tmp_probe/independent-calc.out.json` (does **not** import `src/js/score/**`)  
**UI evidence dump:** `.tmp_probe/v17-ui-results.json`

---

## Architecture understanding (Score path)

```text
DOM input/change
  → meterReadings / chlorineReadings (+ invalidate stale standardMeasurement keys)
  → draft persistence (wm-jobs)
  → resolveScoreReadings / lastReadingsPresent
  → country engine + Quality V3
  → Hero gauge / All Locations / Share eligibility
```

Case remains aggregate root. This round verifies **user-typed values are the values scored**, not only that the formula is self-consistent.

---

## Summary

| Metric | Count |
| --- | ---: |
| Total scored cases (CORE+SEN+FIX) | **43** |
| PASS | **43** |
| Arithmetic Mismatch | **0** |
| Lineage Mismatch | **0** |
| Persistence Fail | **0** |
| Eligibility Fail | **0** |
| UI Display Fail | **0** |
| Regression Fail | **0** |
| BLOCKED | **1** (real camera OCR) |

Harness note: first pass of TC-014…017 flagged Q-V3 `0` vs expected `null` because the probe used `Number(null) === 0`. Null-aware re-read → **PASS**. Not a product defect.

---

## Phase A — Test Case Matrix

### A. Baseline / severity / missing (CORE)

| ID | Name | Intent |
| --- | --- | --- |
| TC-001 | Ideal | All grades 100 |
| TC-002 | Near ideal | Slight offset from ideal |
| TC-003 | Normal Good | Sensitivity baseline |
| TC-018 | Average | Mid water, still TH-safe |
| TC-004 | Border PASS (TH) | Upper edge still PASS |
| TC-005 | Border FAIL | Just over TC-004 |
| TC-006 | Weak turbidity | Single weak param |
| TC-007 | Multi-parameter weak | Several weak |
| TC-008 | Severity WARNING | pH just under TH |
| TC-009 | Severity FAIL | Turbidity FAIL band |
| TC-010 | Critical chlorine | Gate / CRITICAL |
| TC-011 / TC-012 | DO up / down | TH/JP ignore DO; WHO/EU/EPA react |
| TC-013 | TDS JP band | TH vs JP diverge |
| TC-014 | Missing Cl | Cap 79; Q-V3 null |
| TC-015 | Missing TDS | Not Eligible |
| TC-016 | Missing Cl + FAIL turb | Severity + incomplete Q-V3 |
| TC-017 | pH = 0 | False-zero probe |

### B. Parameter isolation (SEN)

From TC-003 baseline: SEN-A…G plus LO/HI for pH, TDS, Turbidity, ORP, Chlorine, DO (**19** cases).

### C–E. Extreme / clear / invalid

Covered by TC-004/005/010/017, DEL-*, INV-* UI probes.

### F. OCR → manual

Simulated: plant `standardMeasurement` OCR values, then DOM-correct pH/TDS. **Real camera OCR = BLOCKED.**

### K. Fixtures

FX-IDEAL, FX-NEAR-IDEAL, FX-BASE, FX-DIFF-TH-SAFE, FX-LOCKED, FX-1328 — expected **not** edited to pass.

---

## Phase B — Independent expected matrix (excerpt)

Full breakdowns (grade / weight / contribution / severity / ceiling) live in `.tmp_probe/independent-calc.out.json`.

| ID | TH | JP | WHO | EU | EPA | Q-V3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TC-001 | 99 | 85 | 99 | 99 | 99 | 100 |
| TC-003 | 91 | 91 | 91 | 91 | 89 | 91 |
| TC-010 | 60 | 60 | 60 | 65 | 77 | 77 |
| TC-014 | 79 | 79 | 79 | 79 | 79 | null |
| TC-015 | null | null | null | null | null | null |
| FX-BASE | 79 | 76 | 70 | 65 | 71 | 76 |
| FX-DIFF-TH-SAFE | 83 | 75 | 81 | 82 | 79 | 81 |
| FX-1328 | 95 | 85 | 92 | 94 | 94 | 92 |

TC-001 Thailand intermediates (independent): params all 100 → weightedSum 500 / weightTotal 5 → raw 100 → severity off → Hero ceiling **99**.

---

## Phase C–D — UI actual vs independent

Fill path: DOM `input`/`change` → `MeterReadingCapture.save` / chlorine complete → score screen. **No direct object-state fill for scored values.**

| Suite | N | PASS | Lineage fail | Arithmetic fail |
| --- | ---: | ---: | ---: | ---: |
| CORE TC-* | 18 | 18 | 0 | 0 |
| SEN-* | 19 | 19 | 0 | 0 |
| FX-* | 6 | 6 | 0 | 0 |

**PASS rule used:** `user typed == engineInput` **and** `independent expected == UI gauge / held Q-V3`.

---

## Phase E — Persistence / reload

| Probe | Result |
| --- | --- |
| Fill ideal → save → empty-session save guard (UJ-06) | **PASS** (`guardHolds`) |
| Reload → meter / present / all 5 countries + Q-V3 | **PASS** (99/85/99/99/99 + Q100) |
| Clear TDS → save → reload → still missing; no stale 80 | **PASS** (Not Eligible, gauge `—`, Share hidden) |

---

## Phase F — Clear field

| Case | Engine key missing | UI | Share |
| --- | --- | --- | --- |
| DEL-TDS / PH / TURB / ORP | yes | Not Eligible / `—` | hidden |
| DEL-DO | yes | TH still 99 (DO not in TH weights) | **hidden** (eligibility) |
| DEL-CL | yes | TH 79 (missing-Cl cap) | hidden |

Clear ≠ absent-from-payload silently ignored: clears persist as `null` and resolve as missing.

---

## Phase G — OCR override

| Layer | Evidence |
| --- | --- |
| Planted OCR | `standardMeasurement.ph=8.9`, `tds=250` |
| User DOM | pH → 7.2, TDS → 80 |
| After save | stale ph/tds keys removed from standard; engine uses **7.2 / 80** |
| Scores | TH99 JP85 WHO99 EU99 EPA99 Q100 (= TC-001) |
| Real camera OCR | **BLOCKED** (no camera path exercised) |

---

## Phase H — Country switch

Ideal readings: TH→JP→WHO→EU→EPA→TH  
Scores: **99 → 85 → 99 → 99 → 99 → 99**  
`readingsStable: true`, `thRoundTrip: true`.

---

## Phase I — Hero vs All Locations

One measured tap (Kitchen); empty rooms not synthesized.  
Hero readings == All Locations; TDS **80**, pH **7.2**.

---

## Phase J — Eligibility / Share

| State | Band | Gauge | Share |
| --- | --- | --- | --- |
| Complete ideal | Excellent | 99 | available |
| Missing required (TDS/pH/turb/orp) | Not Eligible | `—` | hidden |
| Missing Cl only | Good (79) | 79 | hidden (Q-V3 incomplete) |

---

## Phase K — Fixture regression

All six FX-* match locked independent expecteds (same numbers as report 09 / unit locks). **No expected values were changed to pass.**

---

## Invalid input (UI)

`type=number` rejects `abc`, whitespace, malformed → DOM `""` → persisted `null`. **`becameZero: false`** for all four probes.  
Independent `toFinite(" ")===0` remains a **parser** hazard if a non-UI path feeds whitespace; UI path does not.

---

## FAIL inventory

**None** for scored UI cases after null-aware Q-V3 read.

**BLOCKED:** real camera OCR (simulation only).

---

## Verdict (split — do not collapse)

```text
ARITHMETIC VERIFIED
RUNTIME INPUT VERIFIED
PERSISTENCE VERIFIED
OCR OVERRIDE VERIFIED   ← simulated plant+manual only
UI SCORE VERIFIED
FULL SCORE FLOW VERIFIED  ← manual UI + persistence + clear + country + hero
```

**Real OCR camera path:** not verified → treat OCR end-to-end as **BLOCKED**.

**Production Ready:** **NO** — this package proves score lineage on local manual UI; it does not certify publish / LINE / Notion / camera OCR production readiness.

---

## Compatibility / regression / rollback

- No production scoring sources modified in this QA round.
- Probe artifacts under `.tmp_probe/` and this doc only.
- Local job `local-score-qa-v17` may remain in browser `wm-jobs`; safe to delete from UI.

---

## Acceptance criteria checklist

| Criterion | Status |
| --- | --- |
| Independent formula == UI score | **Met** (43/43) |
| User input == persisted == engine input | **Met** |
| Reload input/score stable | **Met** |
| Clear remains missing (no stale fallback) | **Met** |
| OCR manual wins | **Met (simulated)** / camera **BLOCKED** |
