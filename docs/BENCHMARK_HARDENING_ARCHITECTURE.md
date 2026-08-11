# Benchmark Hardening — Architecture

```text
Production (FROZEN)
  src/js/score/production/computeProductionScore.js
  computeScoreFromReadings()
        │
        ▼
  Share / LINE / Public Report / DB   ← unchanged

Benchmark Registry
  src/js/score/benchmark/registry.js
        │
        ├─ ThailandEngine.calculate() → metadata
        ├─ WHOEngine.calculate()      → metadata
        ├─ EUEngine.calculate()       → metadata
        ├─ JapanEngine.calculate()    → metadata
        └─ USEpaEngine.calculate()    → metadata
                │
                ▼
        ComparisonResult (score + verdict + summary + reasons)
                │
                ▼
        UI / future Dashboard / PDF / LINE / AI
        (consume metadata — do not recompute)
```

Isolation is enforced by `tests/benchmark/benchmark-isolation.test.js`.
Metadata schema: `docs/BENCHMARK_METADATA_SCHEMA.md`.

## Semantic contract (display / product — scoring unchanged)

Country Benchmark outputs are **comparison signals per selected engine**, not
a universal quality ranking. See `docs/quality-v3/COUNTRY_BENCHMARK_SEMANTIC_CONTRACT.md`.

- Quality V3 (`computeScoreFromReadings`) → Hero / publish path (separate).
- Compliance → PASS/WARNING/FAIL channel (separate).
- Country engines → dropdown comparison only; **equal scores across countries
  are valid**; magnitude must not imply “better country.”
