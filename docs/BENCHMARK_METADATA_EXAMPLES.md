# Benchmark Metadata Examples

Sample readings:
```json
{
  "ph": 7.2,
  "tds": 450,
  "chlorine": 0.8,
  "turbidity": 2.5,
  "orp": 350,
  "do": 6.5,
  "temp": 28
}
```

Production WHO/DWQI (unchanged): **93**

## Score lock

| Engine | Score | Verdict |
|---|---|---|
| Thailand | 100 | Excellent |
| WHO | 93 | Excellent |
| EU | 65 | Attention |
| Japan | 96 | Excellent |
| US EPA | 91 | Excellent |

## Explainability + Traceability payloads

### Thailand

```json
{
  "engine": "Thailand",
  "engineKey": "thailand",
  "score": 100,
  "verdict": "Excellent",
  "summary": "Strong match to Thailand local drinking-water acceptability.",
  "topPositiveFactors": [
    "pH is within Thailand recommended range (6.5–8.5)",
    "TDS is within Thailand local acceptability (≤ 1000 mg/L)",
    "Free chlorine residual is within Thailand guidance (0.2–2.0 mg/L)",
    "Turbidity meets Thailand local limit (≤ 5 NTU)",
    "ORP is inside the operational window used for Thailand comparison",
    "Dissolved oxygen is not scored under Thailand local comparison"
  ],
  "topNegativeFactors": [],
  "calculationId": "calc_20260807_695400",
  "engineVersion": "v1.0",
  "standardRevision": "Thailand Drinking Water Standard 2024",
  "calculatedAt": "2026-08-07T07:57:37.587Z",
  "inputFingerprint": "f3a90019",
  "passedParameters": [
    "ph",
    "tds",
    "chlorine",
    "turbidity",
    "orp",
    "do",
    "temp"
  ],
  "warningParameters": [],
  "failedParameters": [],
  "criticalFailures": []
}
```

### WHO

```json
{
  "engine": "WHO",
  "engineKey": "who",
  "score": 93,
  "verdict": "Excellent",
  "summary": "Does not fully meet WHO drinking-water guideline proximity for all indicators.",
  "topPositiveFactors": [
    "pH is within WHO recommended range (6.5–8.5)",
    "TDS is at or below WHO aesthetic guideline (≤ 500 mg/L)",
    "ORP indicates an effective disinfection / redox window (200–600 mV)",
    "Dissolved oxygen meets WHO comparison minimum (≥ 6 mg/L)"
  ],
  "topNegativeFactors": [
    "Free chlorine exceeds WHO guideline residual band (0.2–0.5 mg/L).",
    "Turbidity exceeds WHO drinking-water guideline (≤ 1 NTU)."
  ],
  "calculationId": "calc_20260807_852282",
  "engineVersion": "v1.0",
  "standardRevision": "WHO Drinking Water Guideline 2025",
  "calculatedAt": "2026-08-07T07:57:37.589Z",
  "inputFingerprint": "f3a90019",
  "passedParameters": [
    "ph",
    "tds",
    "orp",
    "do",
    "temp"
  ],
  "warningParameters": [
    "chlorine",
    "turbidity"
  ],
  "failedParameters": [],
  "criticalFailures": []
}
```

### EU

```json
{
  "engine": "EU",
  "engineKey": "eu",
  "score": 65,
  "verdict": "Attention",
  "summary": "Fails EU parametric chlorine check — composite score is gated.",
  "topPositiveFactors": [
    "pH is within EU drinking-water range (6.5–9.5)",
    "TDS is within EU indicator threshold used here (≤ 500 mg/L)",
    "Dissolved oxygen meets EU comparison minimum (≥ 6 mg/L)",
    "ORP is inside the operational window used for EU comparison"
  ],
  "topNegativeFactors": [
    "Free chlorine exceeds EU parametric residual value (≤ 0.5 mg/L). Score capped.",
    "Turbidity exceeds EU drinking-water parametric expectation (≤ 1 NTU)."
  ],
  "calculationId": "calc_20260807_070537",
  "engineVersion": "v1.0",
  "standardRevision": "EU Drinking Water Directive parametric values 2020/2184",
  "calculatedAt": "2026-08-07T07:57:37.589Z",
  "inputFingerprint": "f3a90019",
  "passedParameters": [
    "ph",
    "tds",
    "orp",
    "do"
  ],
  "warningParameters": [
    "temp"
  ],
  "failedParameters": [
    "turbidity"
  ],
  "criticalFailures": [
    "chlorine"
  ]
}
```

### Japan

```json
{
  "engine": "Japan",
  "engineKey": "japan",
  "score": 96,
  "verdict": "Excellent",
  "summary": "One or more Japanese drinking-water criteria need attention.",
  "topPositiveFactors": [
    "pH is within Japan national range (5.8–8.6)",
    "TDS is within Japan comparison ceiling (≤ 500 mg/L)",
    "Free chlorine residual meets Japan recommendation (0.1–1 mg/L)",
    "Dissolved oxygen meets Japan comparison minimum (≥ 5 mg/L)",
    "ORP is inside the operational window used for Japan comparison"
  ],
  "topNegativeFactors": [
    "Turbidity exceeds Japanese drinking-water recommendation (≤ 2 NTU)."
  ],
  "calculationId": "calc_20260807_511017",
  "engineVersion": "v1.0",
  "standardRevision": "Japan Drinking Water Standard 2023",
  "calculatedAt": "2026-08-07T07:57:37.590Z",
  "inputFingerprint": "f3a90019",
  "passedParameters": [
    "ph",
    "tds",
    "chlorine",
    "orp",
    "do",
    "temp"
  ],
  "warningParameters": [
    "turbidity"
  ],
  "failedParameters": [],
  "criticalFailures": []
}
```

### US EPA

```json
{
  "engine": "US EPA",
  "engineKey": "usEpa",
  "score": 91,
  "verdict": "Excellent",
  "summary": "One or more US EPA comparison expectations need attention.",
  "topPositiveFactors": [
    "pH is within US EPA secondary range (6.5–8.5)",
    "TDS is at or below US EPA SMCL aesthetic guideline (≤ 500 mg/L)",
    "Free chlorine is within US EPA MRDL-style comparison band (0.2–4 mg/L)",
    "Dissolved oxygen meets EPA comparison minimum (≥ 6 mg/L)",
    "ORP is inside the operational window used for EPA comparison"
  ],
  "topNegativeFactors": [
    "Turbidity exceeds US EPA treatment-technique style target used here (≤ 1 NTU)."
  ],
  "calculationId": "calc_20260807_921660",
  "engineVersion": "v1.0",
  "standardRevision": "US EPA MCL / SMCL / TT comparison set 2024",
  "calculatedAt": "2026-08-07T07:57:37.590Z",
  "inputFingerprint": "f3a90019",
  "passedParameters": [
    "ph",
    "tds",
    "chlorine",
    "orp",
    "do",
    "temp"
  ],
  "warningParameters": [],
  "failedParameters": [
    "turbidity"
  ],
  "criticalFailures": []
}
```
