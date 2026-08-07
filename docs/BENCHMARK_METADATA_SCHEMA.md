# Benchmark Metadata Schema

Every `engine.calculate(readings)` MUST return:

```ts
{
  engine: string;              // "WHO" | "Thailand" | ...
  engineKey: string;           // registry key
  score: number | null;
  verdict: "Excellent" | "Good" | "Acceptable" | "Attention" | "Poor";
  summary: string;             // engine-authored one-liner
  passedParameters: string[];
  warningParameters: string[];
  failedParameters: string[];
  criticalFailures: string[];
  reasons: Array<{
    parameter: string;
    severity: "pass" | "warning" | "fail" | "critical";
    message: string;           // engine-specific wording
  }>;
  classifications?: Record<string, "PASS" | "WARNING" | "FAIL" | "CRITICAL">;
  params?: Record<string, number> | null;  // sub-scores (optional for UI bars)
  statuses?: Record<string, string>;       // legacy good/attn for metric rows
  findings?: Array<{ label: string; val: string; note?: string }>;
}
```

Rules:
- Metadata is produced **inside** each country engine.
- UI / reports / LINE / PDF must **consume**, never recompute, explanations.
- Production `computeScoreFromReadings` is out of scope and must not emit this contract.
