# OCR Benchmark Report

- Engine: `mock`
- Dataset: `D:/Service Portal/ocr-service/datasets/meters`
- Total images: **2**
- Labeled images: **2**

## Summary

- Average accuracy: **1.0**
- Average latency: **6.388 ms**
- Failure rate: **0.0**
- Successes: 2
- Failures: 0

## Worst images

| Image | Accuracy | Confidence | Latency ms | Expected | OCR | Error |
|---|---:|---:|---:|---|---|---|
| demo_ph_001.png | 1.0 | 0.99 | 11.02 | 7.29 | 7.29 |  |
| demo_tds_001.png | 1.0 | 0.99 | 1.756 | 280 | 280 |  |

## Best images

| Image | Accuracy | Confidence | Latency ms | Expected | OCR |
|---|---:|---:|---:|---|---|
| demo_tds_001.png | 1.0 | 0.99 | 1.756 | 280 | 280 |
| demo_ph_001.png | 1.0 | 0.99 | 11.02 | 7.29 | 7.29 |

## Per-image results

| Image | Meter | Expected | OCR | Accuracy | Confidence | Latency ms | OK |
|---|---|---|---|---:|---:|---:|:---:|
| demo_ph_001.png | ph | 7.29 | 7.29 | 1.0 | 0.99 | 11.02 | yes |
| demo_tds_001.png | tds | 280 | 280 | 1.0 | 0.99 | 1.756 | yes |
