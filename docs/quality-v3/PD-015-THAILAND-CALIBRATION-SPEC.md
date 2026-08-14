# PD-015 — Thailand Country Benchmark Calibration Spec

**Status:** DECIDED + authorization to implement  
**Engine scope:** Thailand only  
**Date:** 2026-08-14  
**Canonical decision record:** `UNRESOLVED_DECISIONS.md` → PD-015

This specification is the numeric SoT for the Thailand Country Benchmark
ordinary-band recalibration. It does **not** change Q-V3, Japan, WHO, EU,
US EPA, Case lifecycle, registry, resolver, or the Country Hero ceiling (99).

---

## Product intent

Thailand Country Benchmark must resolve usefully inside the ordinary /
acceptable measurement region. Flat-100 on nearly every ordinary parameter
producing Hero ≈ 97–99 for imperfect water is unacceptable.

Meaning of Country 100 (PD-006 A, refined by PD-015 for Thailand only):

```text
100 = inside the Thailand excellent / preferred inner band for that parameter
Compliance pass band may still be wider; in-pass values outside the excellent
inner band grade below 100 (named severity — same class as 7a3f35a7 / PD-014).
```

---

## Locked (unchanged)

| Item | Value |
| --- | --- |
| Outer pH | 6.5 – 8.5 |
| TDS passMax / softEnd | 1000 / 1500 |
| Chlorine compliance | 0.2 – 2.0 |
| Chlorine excellent inner | 0.2 – 0.5 (DoH surveillance residual framing) |
| Turbidity passMax / softEnd | 5 / 12 |
| ORP outer | 200 – 600 |
| ORP excellent inner | 350 – 450 (PD-014 D1) |
| Weights | equal among scored params |
| Aggregation | weighted mean |
| Math.round | kept |
| Hero ceiling | **KEEP 99** |
| DO / Temp | not scored |

---

## Authorized numeric changes (Thailand only) — PROJECT-DEFINED

| Parameter | Old excellent / curve | New excellent / curve | Provenance |
| --- | --- | --- | --- |
| **pH** | entire 6.5–8.5 → 100 | Preferred **6.8–7.8** → 100; inside pass but outside preferred → linear to **85** at 6.5 / 8.5; outside pass unchanged (×35) | PROJECT-DEFINED preferred band for ordinary-band resolution |
| **TDS** | excellentMax **300**; in-pass decline **25** pts to passMax | excellentMax **80**; in-pass decline **60** pts to passMax; soft zone anchored at post-decline edge | PROJECT-DEFINED ordinary resolution (not WHO Ideal claim; not Q-V3 Ideal copy) |
| **Turbidity** | excellentMax **1**; in-pass decline **40** | excellentMax **0.3**; in-pass decline **50**; soft zone anchored at post-decline edge | PROJECT-DEFINED ordinary resolution |
| **Chlorine** | unchanged | unchanged | PD-008 / prior TH severity |
| **ORP** | unchanged | unchanged | PD-014 D1 |

---

## Soft-zone continuity

At `passMax`, grade equals `100 - inBandDecline`. Soft-zone formulas must
anchor at that edge (not the historical 75 / 60) so the curve stays continuous.

---

## Explicit non-goals

- No Case-specific hard-codes
- No global `score -= N` / `score *= k` / `Math.min(score, 90)`
- No Q-V3 replacement of Country Hero
- No change to other Country engines in this PD
