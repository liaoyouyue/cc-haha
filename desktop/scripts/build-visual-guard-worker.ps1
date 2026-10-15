$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Python = if ($env:PYTHON) { $env:PYTHON } else { 'python' }
$Output = Join-Path $Root 'desktop\src-tauri\binaries'

& $Python -c "import PyInstaller" 2>$null
if ($LASTEXITCODE -ne 0) {
  throw 'PyInstaller is required: python -m pip install pyinstaller'
}

& $Python -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name visual-guard-worker `
  --distpath $Output `
  --workpath (Join-Path $Root '.build\visual-guard-worker') `
  --specpath (Join-Path $Root '.build') `
  --collect-all rapidocr_onnxruntime `
  (Join-Path $Root 'runtime\visual_guard_worker.py')

if ($LASTEXITCODE -ne 0) { throw 'visual guard worker build failed' }
Write-Host "[visual-guard] built $Output\visual-guard-worker\visual-guard-worker.exe"
