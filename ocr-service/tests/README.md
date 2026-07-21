# OCR Service Tests (Phase 3.5)

## Layout

```text
tests/
├── contract/       # OCR Service HTTP contract
├── integration/    # Node ocrClient ↔ OCR Service
├── performance/    # Concurrent load smoke
├── helpers.py
└── README.md
```

## Run

```powershell
cd ocr-service
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Requires:

- Python 3.10+ (3.13 OK for mock service)
- Node.js available on PATH for integration tests

## Coverage map

| # | Scenario | Suite |
|---|----------|--------|
| 1 | Healthy service | contract |
| 2 | OCR offline | integration |
| 3 | Timeout | integration |
| 4 | Missing image_url | contract |
| 5 | Missing meter_type | contract |
| 6 | Unsupported meter | contract |
| 7 | Malformed JSON | contract |
| 8 | Engine exception | contract |
| 9 | Concurrent requests | contract + performance |
| 10 | Large payload | contract |
