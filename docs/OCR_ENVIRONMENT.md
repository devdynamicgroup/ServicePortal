# OCR Environment — Paddle Runtime Compatibility

**Status:** Runtime investigation only. OCR Service architecture, API, pipeline, and tests are complete.

**Purpose:** Document the safest officially supported PaddleOCR runtime for this project and explain why the current environment fails before `predict()`.

---

## Executive Summary

| Question | Answer |
|----------|--------|
| Is the OCR Service code at fault? | **No** |
| Is the failure runtime / environment? | **Yes** |
| Is the model cache corrupted? | **No** — PP-OCRv6 uses `inference.json` (PIR), not `inference.pdmodel` |
| Is Python 3.13 + Paddle 3.3.1 + PaddleOCR 3.7 officially recommended? | **No** |
| Safest supported runtime | **Python 3.12** + **paddlepaddle 3.2.0** (or **3.2.2**) + **paddleocr 3.7.0** + **paddlex 3.7.x** on **Windows 11 CPU** |

---

## Current Failure (Observed)

```
PaddleOCR()
  → load PP-OCRv6_medium_det
    → paddle_inference.create_predictor(config)
      → RuntimeError: [json.exception.parse_error.101] attempting to parse an empty input
```

- `predict()` is **never reached**
- Model download **succeeds**
- Cache contains `inference.json`, `inference.pdiparams`, `inference.yml`
- `inference.pdmodel` is **absent by design** for PP-OCRv6 (PIR JSON format)

### Failure classification

| Layer | Status |
|-------|--------|
| OCR Service API / routes / contracts | Complete, not involved |
| OCR pipeline / parser / readers / validation | Complete, not involved |
| PaddleOCR Python API usage | Correct for 3.7.x |
| PaddlePaddle predictor initialization | **Fails** |
| Installed version matrix | **Not officially recommended** |

---

## Supported Version Matrix

Based on official PaddleOCR / PaddlePaddle documentation and maintainer responses.

| Component | Current (broken) | Officially documented | Maintainer-confirmed stable | Notes |
|-----------|------------------|----------------------|----------------------------|-------|
| **Python** | 3.13.10 | >= 3.8 (paddleocr core) | **3.12.x** recommended | PaddleOCR install docs center on 3.2.0 framework; 3.12 has broadest Windows wheel support |
| **paddlepaddle** | 3.3.1 | **3.2.0** (PaddleOCR install guide) | **3.2.2** (workaround) | 3.3.1 has known PIR/oneDNN bugs with OCR 3.7 |
| **paddleocr** | 3.7.0 | **3.7.0** (current) | **3.7.0** | Keep current API generation |
| **paddlex** | 3.7.2 | **3.7.x** (transitive) | **3.7.2** | Required by paddleocr 3.7.0 (`>=3.7.0,<3.8.0`) |
| **OS** | Windows 11 | Windows supported | Windows 11 CPU | CPU-only inference |
| **Device** | CPU | CPU supported | CPU | `is_compiled_with_cuda() = False` |

### Is Python 3.13 + Paddle 3.3.1 + PaddleOCR 3.7 officially recommended?

**No.**

| Claim | Evidence |
|-------|----------|
| paddleocr 3.7 allows Python 3.13 | PyPI classifiers include 3.13; package declares `Python >= 3.8` |
| paddlepaddle 3.3.1 ships a cp313 Windows wheel | PyPI: `paddlepaddle-3.3.1-cp313-cp313-win_amd64.whl` |
| This combo is the **recommended OCR runtime** | **Not documented.** PaddleOCR's own install guide pins **paddlepaddle==3.2.0**, not 3.3.1 |
| paddlepaddle 3.3.1 is safe with PaddleOCR 3.7 | **Explicitly disputed** by maintainers — framework bug in PIR executor / oneDNN path ([issue #18162](https://github.com/PaddlePaddle/PaddleOCR/issues/18162)) |

**Conclusion:** The stack is *installable* but not *officially recommended* or *known-good* for PaddleOCR 3.7 inference.

---

## Known Runtime Issues

### 1. PaddlePaddle 3.3.1 + PaddleOCR 3.7 — PIR / oneDNN bug (primary)

- **GitHub:** [PaddleOCR #18162](https://github.com/PaddlePaddle/PaddleOCR/issues/18162)
- **Maintainer response (Jun 2026):** Bug is in **PaddlePaddle 3.3.1**, not PaddleOCR. Related to the **PIR executor and oneDNN execution path**.
- **Symptoms:**
  - `NotImplementedError: ConvertPirAttribute2RuntimeAttribute not support ...` during `predictor.run()` (Linux/Windows)
  - `RuntimeError: [json.exception.parse_error.101]` during `create_predictor()` (Windows, observed in this project)
- **Official workarounds:**
  1. Downgrade to **paddlepaddle 3.2.2**
  2. Disable oneDNN (`enable_mkldnn=False` in PaddleOCR, or `FLAGS_use_mkldnn=0`)
- **Community confirmation:** Multiple users report **only paddlepaddle <= 3.2.2 works** with PaddleOCR 3.7 on CPU.

### 2. PP-OCRv6 model format — `inference.pdmodel` not expected

- **Not a bug.** Paddle 3.x default export uses **PIR JSON** (`inference.json`), not legacy `inference.pdmodel`.
- **Official model:** [HuggingFace PP-OCRv6_medium_det](https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_det) ships:
  - `inference.json` (~312 KB)
  - `inference.pdiparams` (~62 MB)
  - `inference.yml`
- Re-downloading will **not** produce `inference.pdmodel`.

### 3. Python 3.13 — installable but not the safest choice

- paddlepaddle 3.3.1 publishes cp313 wheels, but PaddleOCR documentation and maintainer guidance do not validate 3.13 as the primary target.
- Paddle maintainers have stated pre-built packages historically targeted up to 3.12; higher versions may require source builds ([Paddle #71616](https://github.com/PaddlePaddle/Paddle/issues/71616)).
- For production OCR, prefer **Python 3.12.x** until the full stack is validated on 3.13.

---

## Recommended Environments

### Development Environment (Windows 11 CPU)

| Setting | Value |
|---------|-------|
| Python | **3.12.x** (64-bit) |
| paddlepaddle | **3.2.0** from official CPU index |
| paddleocr | **3.7.0** |
| paddlex | **3.7.2** (installed transitively) |
| OCR engine | `OCR_ENGINE=paddle` |
| Virtual env | Dedicated venv for OCR service (isolated from Node backend) |

Use a separate Python 3.12 virtual environment. Do not mix with the current Python 3.13 + 3.3.1 stack until validated.

### Production Environment (Windows 11 CPU)

| Setting | Value |
|---------|-------|
| Python | **3.12.x** (64-bit) |
| paddlepaddle | **3.2.0** (or **3.2.2** if 3.2.0 is unavailable) |
| paddleocr | **3.7.0** (pinned) |
| paddlex | **3.7.2** (pinned via lock file or explicit install) |
| Process model | Standalone `ocr-service` process (unchanged architecture) |
| Health check | `/health` + `/version` (existing contract) |
| Fallback | Mock engine remains available if Paddle init fails |

For production, pin exact versions in deployment manifests. Use `requirements-supported.txt` as the reference pin set.

---

## Installation Steps

### 1. Create a clean Python 3.12 environment

```powershell
py -3.12 -m venv .venv-ocr
.\.venv-ocr\Scripts\Activate.ps1
python -m pip install --upgrade pip
```

### 2. Install PaddlePaddle from the official CPU index

```powershell
python -m pip install paddlepaddle==3.2.0 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
```

If 3.2.0 is unavailable or unstable, use the maintainer-confirmed workaround:

```powershell
python -m pip install paddlepaddle==3.2.2 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
```

### 3. Install PaddleOCR

```powershell
python -m pip install paddleocr==3.7.0
```

Or from the project pin file:

```powershell
python -m pip install -r requirements-supported.txt
```

### 4. Verify framework

```powershell
python -c "import paddle; print('paddle', paddle.__version__)"
python -c "import paddleocr; print('paddleocr', paddleocr.__version__)"
python -c "import paddlex; print('paddlex', paddlex.__version__)"
python -c "import paddle; print('cuda', paddle.device.is_compiled_with_cuda())"
```

Expected: `paddle 3.2.0` (or `3.2.2`), `paddleocr 3.7.0`, `paddlex 3.7.x`, `cuda False`.

### 5. Verify PaddleOCR initialization (minimal smoke test)

```powershell
python -c "from paddleocr import PaddleOCR; ocr=PaddleOCR(lang='en', use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False); print('init ok')"
```

If this prints `init ok`, predictor creation succeeded. Then test `predict()` with a real image.

### 6. Start OCR service (unchanged)

```powershell
cd ocr-service
.\run.ps1
```

No changes to service code, API, or pipeline are required.

---

## Upgrade Notes

### From current stack (Python 3.13 + paddlepaddle 3.3.1)

1. **Do not change OCR Service code** — architecture is complete.
2. Create a **new** Python 3.12 virtual environment (do not upgrade in-place).
3. Install **paddlepaddle 3.2.0** (or 3.2.2), then **paddleocr 3.7.0**.
4. Re-run contract tests (`14/14` must still pass with mock engine).
5. Run a Paddle smoke test (`PaddleOCR()` init + one `predict()` call).
6. Point the deployment process at the new venv.

### Do not

- Downgrade paddleocr below 3.7 (API used by this project is 3.7.x).
- Upgrade paddlepaddle to 3.3.1 until [PaddleOCR #18162](https://github.com/PaddlePaddle/PaddleOCR/issues/18162) is resolved upstream.
- Delete and re-download PP-OCRv6 models expecting `inference.pdmodel` — the JSON format is correct.
- Modify OCR Service architecture, routes, pipeline, or contracts as part of runtime repair.

### Version pin reference

See [`requirements-supported.txt`](../requirements-supported.txt) at the repository root.

---

## Official References

| Source | URL |
|--------|-----|
| PaddleOCR — PaddlePaddle installation (pins 3.2.0) | https://www.paddleocr.ai/latest/en/version3.x/paddlepaddle_installation.html |
| PaddleOCR — package installation | https://www.paddleocr.ai/main/en/version3.x/installation.html |
| PaddleOCR #18162 — 3.3.1 incompatibility | https://github.com/PaddlePaddle/PaddleOCR/issues/18162 |
| PP-OCRv6_medium_det model (inference.json format) | https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_det |
| Paddle #71616 — Python 3.13 support discussion | https://github.com/PaddlePaddle/Paddle/issues/71616 |
| paddlepaddle 3.3.1 PyPI metadata | https://pypi.org/project/paddlepaddle/3.3.1/ |
| paddleocr 3.7.0 PyPI metadata | https://pypi.org/project/paddleocr/3.7.0/ |

---

## Compatibility Report (Final)

| Area | Verdict |
|------|---------|
| Project OCR Service code | Not the cause |
| Model download / cache | Not corrupted |
| Missing `inference.pdmodel` | Expected for PP-OCRv6 / Paddle 3.x PIR |
| `create_predictor()` failure | **Runtime / environment** — PaddlePaddle 3.3.1 PIR/oneDNN incompatibility with PaddleOCR 3.7 |
| Recommended fix scope | **Environment only** — new Python 3.12 venv + paddlepaddle 3.2.0/3.2.2 |
| Architecture changes required | **None** |
