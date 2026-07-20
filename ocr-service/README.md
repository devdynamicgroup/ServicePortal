# Water Motion OCR Service

Isolated Python OCR microservice for Water Motion.

Default engine: **MockEngine**. Optional: `OCR_ENGINE=paddle` (Phase 4 adapter).

Phase 5 adds an internal processing pipeline (validate → preprocess → OCR → reader → parser → validate → confidence) without changing the public HTTP contract.

## Folder structure

```text
ocr-service/
├── main.py
├── config/settings.py
├── core/                 # logger, response, exceptions, metrics
├── api/                  # routes, request validators (HTTP)
├── services/             # ocr_service → pipeline
├── processing/           # pipeline.py, context.py
├── validation/           # image_validator, result_validator
├── confidence/           # confidence_service
├── engines/              # base, mock, paddle, easyocr
├── preprocess/           # optional image steps
├── readers/              # TDS / pH / EC / ORP / DO
├── parser/               # OCR text correction + structure
├── benchmark/            # pipeline timing / confidence report
├── datasets/
│   ├── meters/           # sample images (structure only)
│   └── labels/           # expected labels (structure only)
├── models/
├── logs/
└── tests/
```

## Startup

```bash
cd ocr-service
python main.py
```

Defaults: `http://0.0.0.0:5055`

## Environment

Copy `.env.example` → `.env` for local development (gitignored). Process environment
variables always override `.env` values.

| Variable | Default | Meaning |
|----------|---------|---------|
| `OCR_HOST` | `0.0.0.0` | Bind host |
| `OCR_PORT` | `5055` | Bind port |
| `OCR_ENGINE` | `mock` | `mock` / `paddle` / `easyocr` |
| `PADDLE_PDX_CACHE_HOME` | _(unset)_ | ASCII-only PaddleX model cache (recommended on Windows) |
| `OCR_MAX_BODY_BYTES` | `262144` | Max POST body |
| `OCR_SERVICE_PHASE` | `3.5` | Reported phase (keep for contract tests) |
| `OCR_ALLOW_VIRTUAL_IMAGES` | `true` | Allow non-file paths (mock/contract) |
| `OCR_PREPROCESS_RESIZE` | `false` | Enable resize step |
| `OCR_PREPROCESS_ROTATE` | `false` | Enable rotate step |
| `OCR_PREPROCESS_CROP` | `false` | Enable crop step |
| `OCR_PREPROCESS_CONTRAST` | `false` | Enable contrast step |
| `OCR_PREPROCESS_THRESHOLD` | `false` | Enable threshold step |
| `OCR_PREPROCESS_DENOISE` | `false` | Enable denoise step |
| `OCR_PREPROCESS_NORMALIZE` | `false` | Enable normalize step |

### Use PaddleOCR locally

```powershell
cd ocr-service
# Ensure .env has OCR_ENGINE=paddle (see .env.example)
.\.venv\Scripts\python.exe main.py
```

Startup log should show `engine=paddle`. Contract tests still force `OCR_ENGINE=mock`.

Pillow is optional; preprocess steps no-op when Pillow is not installed.

## API list

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness / readiness |
| `GET` | `/version` | Service + engine version |
| `GET` | `/metrics` | In-memory counters |
| `POST` | `/ocr/read-meter` | Meter read (unchanged contract) |

### Health / Version / Metrics

Unchanged from Phase 3.5.

### Read meter

```bash
curl -X POST http://127.0.0.1:5055/ocr/read-meter ^
  -H "Content-Type: application/json" ^
  -d "{\"image_url\":\"sample.jpg\",\"meter_type\":\"tds\"}"
```

Supported `meter_type`: `tds`, `ph`, `ec`, `orp`, `do`

## Pipeline (internal)

```text
Image Validator → Preprocessor → OCR Engine → Reader → Parser
  → Result Validator → Confidence → Standard Response
```

Stage timings are recorded on the pipeline context (`preprocess_ms`, `ocr_ms`, `parser_ms`, …).

## Benchmark

```bash
cd ocr-service
python -m benchmark.benchmark --samples 20
```

## Test instructions

```bash
cd ocr-service
python -m unittest discover -s tests -v
```

Existing contract / integration / performance tests must pass unchanged.
