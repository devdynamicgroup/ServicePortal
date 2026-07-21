# Water Motion OCR Service — supported local launcher (Windows).
# Always uses ocr-service\.venv — never PATH python.
$ErrorActionPreference = "Stop"

$ServiceRoot = $PSScriptRoot
$VenvPython = Join-Path $ServiceRoot ".venv\Scripts\python.exe"
$DefaultCache = "C:\paddlex_cache"

if (-not (Test-Path $VenvPython)) {
    Write-Error "OCR venv not found: $VenvPython`nCreate with: py -3.12 -m venv .venv"
}

if (-not $env:PADDLE_PDX_CACHE_HOME) {
    $env:PADDLE_PDX_CACHE_HOME = $DefaultCache
    Write-Host "PADDLE_PDX_CACHE_HOME set to $DefaultCache"
}

Write-Host "=== OCR Service Runtime ==="
& $VenvPython -c @"
import os, sys
print('Python executable :', sys.executable)
print('Python version    :', sys.version.split()[0])
print('PADDLE_PDX_CACHE_HOME:', os.environ.get('PADDLE_PDX_CACHE_HOME', '<unset>'))
for name in ('paddle', 'paddleocr', 'paddlex'):
    try:
        m = __import__(name)
        print(f'{name:10}:', getattr(m, '__version__', '?'))
    except Exception as e:
        print(f'{name:10}: IMPORT_FAIL', e)
"@

$check = & $VenvPython -c @"
import sys
maj, min = sys.version_info[:2]
if not (maj == 3 and min == 12):
    raise SystemExit(f'Expected Python 3.12.x, got {sys.version.split()[0]}')
import importlib
p = importlib.import_module('paddle')
if not str(getattr(p, '__version__', '')).startswith('3.2.'):
    raise SystemExit(f'Expected paddle 3.2.x, got {getattr(p, \"__version__\", \"?\")}')
o = importlib.import_module('paddleocr')
if not str(getattr(o, '__version__', '')).startswith('3.7.'):
    raise SystemExit(f'Expected paddleocr 3.7.x, got {getattr(o, \"__version__\", \"?\")}')
print('runtime_check: OK')
"@ 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Error "Runtime check failed:`n$check"
}
Write-Host $check
Write-Host "=== Starting main.py ==="
Set-Location $ServiceRoot
& $VenvPython main.py
