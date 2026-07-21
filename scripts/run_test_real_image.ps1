# Run scripts/test_real_image.py using OCR venv only — never PATH python.
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ImagePath,
    [string]$MeterType = "ph",
    [string]$Engine = "paddle"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$VenvPython = Join-Path $RepoRoot "ocr-service\.venv\Scripts\python.exe"
$Script = Join-Path $RepoRoot "scripts\test_real_image.py"
$DefaultCache = "C:\paddlex_cache"

if (-not (Test-Path $VenvPython)) {
    Write-Error "OCR venv not found: $VenvPython"
}
if (-not (Test-Path $Script)) {
    Write-Error "Script not found: $Script"
}
if (-not $env:PADDLE_PDX_CACHE_HOME) {
    $env:PADDLE_PDX_CACHE_HOME = $DefaultCache
}

Write-Host "Using:" $VenvPython
Write-Host "Cache:" $env:PADDLE_PDX_CACHE_HOME
& $VenvPython $Script $ImagePath --meter-type $MeterType --engine $Engine
