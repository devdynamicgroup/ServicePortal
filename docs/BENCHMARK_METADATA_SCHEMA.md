# Benchmark Metadata Schema (final)

Every `engine.calculate(readings)` returns:

```ts
{
  // Core
  engine: string;
  engineKey: string;
  score: number | null;
  verdict: "Excellent" | "Good" | "Acceptable" | "Attention" | "Poor";
  summary: string;

  // Classification
  passedParameters: string[];
  warningParameters: string[];
  failedParameters: string[];
  criticalFailures: string[];
  classifications?: Record<string, "PASS" | "WARNING" | "FAIL" | "CRITICAL">;
  reasons: Array<{ parameter: string; severity: string; message: string }>;

  // Explainability (engine-authored)
  topPositiveFactors: string[];  // why score stayed high
  topNegativeFactors: string[];  // what reduced the score

  // Traceability
  calculationId: string;         // calc_YYYYMMDD_######
  engineVersion: string;         // e.g. v1.0
  standardRevision: string;      // human-readable standard reference
  calculatedAt: string;          // ISO timestamp
  inputFingerprint: string;      // 8-char hash of normalized measurements only

  // Optional UI helpers
  params?: Record<string, number> | null;
  statuses?: Record<string, string>;
  findings?: Array<{ label: string; val: string; note?: string }>;
  gated?: boolean;
}
```

## Rules

- Explainability and trace fields are authored **inside** each country engine (via finalize helpers for envelope/fingerprint only).
- UI / Dashboard / PDF / LINE / Mobile / AI **consume** metadata — never recompute explanations.
- `inputFingerprint` covers only normalized `ph,tds,chlorine,turbidity,orp,do,temp` — never customer identity, case id, or timestamps.
- Production `computeScoreFromReadings()` does **not** emit this contract.
