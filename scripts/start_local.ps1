param(
  [int]$Port = 8001
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Python = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path $Python)) {
  throw "Virtual environment python not found: $Python"
}

Push-Location $Root
try {
  Push-Location (Join-Path $Root "frontend")
  try {
    npm.cmd run build
  } finally {
    Pop-Location
  }

  $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($listenerPid in $listeners) {
    if ($listenerPid) {
      Stop-Process -Id $listenerPid -Force
    }
  }

  Start-Process -FilePath $Python `
    -ArgumentList @("-m", "uvicorn", "backend.public_main:app", "--host", "127.0.0.1", "--port", "$Port") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Root "data\public_server.out.log") `
    -RedirectStandardError (Join-Path $Root "data\public_server.err.log")

  Write-Output "Local app started: http://127.0.0.1:$Port/"
} finally {
  Pop-Location
}
