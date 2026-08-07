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
