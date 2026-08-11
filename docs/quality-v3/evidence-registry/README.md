# Constant / Clause Evidence Registry

**Status:** Red-flag clause hunt complete (2026-08-11)  
**Authority:** Baseline for Product Decision — **not** a license to change numeric model  
**Model freeze:** No threshold / weight / curve / gate changes authorized from this registry alone

This directory is the **constant & clause** evidence registry for Country Benchmark + Quality V3.

It is **separate** from [`../evidence-registry.json`](../evidence-registry.json), which tracks **measurement samples** (calibration / validation / holdout). Mixing the two caused past confusion between “we measured water” and “this number is allowed in the model.”

## Files

| File | Role |
|------|------|
| [`constants.json`](constants.json) | Machine-readable red-flag + related constant rows |
| This README | Schema, freeze rules, action rollup |

**Nothing here is imported by scoring engines.** Documentation / governance only.

## Schema (every row)

| Field | Meaning |
|-------|---------|
| `id` | Stable row id (`ENGINE-PARAM-ASPECT`) |
| `engine` | `thailand` \| `japan` \| `who` \| `eu` \| `usEpa` \| `quality-v3` \| `shared` |
| `parameter` | e.g. `chlorine`, `do`, `weights` |
| `code_value` | Exact value(s) as used in code |
| `code_path` | File path of the constant |
| `semantic` | How the model *uses* the value (ideal band, MRDL ceiling, gate, weight, …) |
| `evidence_class` | One of the closed set below |
| `source_name` | Named source or empty string when `citation_status = NO CITATION` |
| `source_url` | URL or empty string |
| `clause` | Clause / section / article when known |
| `unit` | Unit as in code / source |
| `source_value` | What the source actually says (may differ from `code_value`) |
| `semantic_gap` | Difference between code use and source meaning |
| `action` | One of the closed set below |
| `citation_status` | `CITED` \| `PARTIAL` \| **`NO CITATION`** \| `CONFLICTING SOURCE` |
| `redesign_candidate` | `true` only for the four numeric-redesign candidates |
| `notes` | Free text; must not invent a nearby source |

### Closed `evidence_class` set

```text
VERIFIED
PARTIALLY VERIFIED
PROJECT-DEFINED
OPERATIONAL
FOUNDING CONSTANT
UNSUPPORTED
CONFLICTING
```

### Closed `action` set

```text
KEEP
KEEP BUT LABEL
REMOVE/REVIEW
RESEARCH
PRODUCT DECISION
```

### `NO CITATION` rule

If no matching authoritative clause was found after hunt:

- set `citation_status` to **`NO CITATION`**
- set `source_name`, `source_url`, `clause`, `source_value` to `""` or explicit null-equivalent empty string
- **do not** leave the field omitted (omission ≠ “not yet checked”)
- **do not** paste a “nearby” standard to make the number look sourced

## Freeze / process

```text
SOURCE VALIDITY     ✅ red-flag hunt complete — this registry is the baseline
NUMERIC MODEL       🔒 frozen
PRODUCT SEMANTICS   ⏸️ wait for Product Decision using this registry
MODEL-REPAIR COMMIT 🔴 prohibited until Product Decision authorizes specific rows
CASE FLOW           🔒 untouched
```

## Four numeric redesign candidates (frozen until PD)

1. **Thailand chlorine upper `2.0`** — CONFLICTING vs DoH residual `0.2–0.5`
2. **US EPA chlorine `0.2–4.0` as Ideal** — CONFLICTING (MRDL ceiling ≠ quality ideal)
3. **EU chlorine `0.1–0.5`** — CONFLICTING / unsupported as Directive free-chlorine residual
4. **Japan DO `≥5`** — UNSUPPORTED (not in MHLW 51/52 drinking-water criteria)

Weights, Q-V3 ideals, and WHO tier scores remain **PRODUCT DECISION / RESEARCH** — not silent bug-fixes.

## Action rollup (2026-08-11)

```text
KEEP              — JP pH 5.8–8.6; EPA TDS SMCL 500; EU pH 6.5–9.5; Q-V3 turb NI ≤0.1 (center)
KEEP BUT LABEL    — JP Cl (min law / max taste); JP turb (度 vs NTU); WHO Cl/TDS/turb;
                    EU turb + gate 65; EPA turb TT; Q-V3 TDS≤80 / Cl band
REMOVE/REVIEW     — TH Cl 0.2–2.0; JP DO≥5; EU Cl 0.1–0.5; EPA Cl 0.2–4.0 as Ideal
RESEARCH          — TH pH/TDS/turb; WHO DO≥6; Q-V3 ORP/DO; EPA internal TDS 300
PRODUCT DECISION  — JP/EU/EPA weight magnitudes; WHO tier scores; Q-V3 pH 7.2 + Cl>0.5 curve
OPERATIONAL       — ORP 200–600 (PD-004) — never label as national standard
```

## Related

- [`../COUNTRY_BENCHMARK_SEMANTIC_CONTRACT.md`](../COUNTRY_BENCHMARK_SEMANTIC_CONTRACT.md)
- [`../UNRESOLVED_DECISIONS.md`](../UNRESOLVED_DECISIONS.md) — PD-001…PD-005
- [`../PARAMETER_EVIDENCE_MATRIX.md`](../PARAMETER_EVIDENCE_MATRIX.md) — Quality V3 parameter matrix (pre-hunt)
- [`../evidence-registry.json`](../evidence-registry.json) — **samples only**
