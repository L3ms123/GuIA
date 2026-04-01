param(
  [int]$BackendPort = 8000,
  [int]$FrontendPort = 8080,
  [string]$Model = "llama3.2:3b",
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$ollamaBaseUrl = "http://127.0.0.1:11434"

function Test-Url {
  param([string]$Url)

  try {
    Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Wait-Url {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Url $Url) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }

  return $false
}

function Test-PortListening {
  param([int]$Port)

  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Start-Window {
  param(
    [string]$WorkingDirectory,
    [string]$Command
  )

  Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command", "Set-Location '$WorkingDirectory'; $Command"
  ) | Out-Null
}

function Ensure-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Get-OllamaModels {
  try {
    $tags = Invoke-RestMethod -Uri "$ollamaBaseUrl/api/tags" -TimeoutSec 2
    return @($tags.models | ForEach-Object { $_.name })
  } catch {
    return @()
  }
}

function Get-OllamaCommand {
  $command = Get-Command ollama -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
    (Join-Path $env:ProgramFiles "Ollama\ollama.exe"),
    (Join-Path $env:LOCALAPPDATA "Ollama\ollama.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Find-VenvActivate {
  $candidates = @(
    (Join-Path $backendDir ".venv\Scripts\Activate.ps1"),
    (Join-Path $repoRoot ".venv\Scripts\Activate.ps1")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

# Reuse the existing repository venv when backend/.venv does not exist.
$venvActivate = Find-VenvActivate

if (-not $venvActivate) {
  throw "Backend virtual environment not found. Checked backend\\.venv and repo-root \\.venv."
}

Ensure-Command python
$ollamaCommand = Get-OllamaCommand

if (-not (Test-Url "$ollamaBaseUrl/api/tags")) {
  if (-not $ollamaCommand) {
    throw "Ollama is not installed or is not on PATH. Install Ollama, reopen PowerShell, run 'ollama pull $Model', and then rerun .\start-dev.ps1"
  }

  if (Test-PortListening 11434) {
    Write-Host "Ollama port 11434 is already in use. Waiting for the existing Ollama process..." -ForegroundColor DarkGray
  } else {
    Write-Host "Starting Ollama..." -ForegroundColor Cyan
    Start-Window -WorkingDirectory $repoRoot -Command "& '$ollamaCommand' serve"
  }

  if (-not (Wait-Url "$ollamaBaseUrl/api/tags" 30)) {
    throw "Ollama did not become ready on $ollamaBaseUrl"
  }
} else {
  Write-Host "Ollama is already running." -ForegroundColor DarkGray
}

$models = Get-OllamaModels
if (@($models) -notcontains $Model) {
  if (-not $ollamaCommand) {
    throw "Model '$Model' is missing and Ollama could not be located to pull it."
  }

  Write-Host "Pulling Ollama model '$Model'..." -ForegroundColor Cyan
  & $ollamaCommand pull $Model
  if ($LASTEXITCODE -ne 0) {
    throw "Could not pull Ollama model '$Model'."
  }
}

if (-not (Test-Url "http://127.0.0.1:$BackendPort/health")) {
  Write-Host "Starting backend on port $BackendPort..." -ForegroundColor Cyan
  # Activate the existing backend virtualenv, then launch Uvicorn in its own window.
  Start-Window -WorkingDirectory $backendDir -Command "& '$venvActivate'; `$env:OLLAMA_URL='$ollamaBaseUrl'; uvicorn app:app --reload --host 127.0.0.1 --port $BackendPort"
  if (-not (Wait-Url "http://127.0.0.1:$BackendPort/health" 30)) {
    throw "Backend did not become ready on http://127.0.0.1:$BackendPort/health"
  }
} else {
  Write-Host "Backend is already running on port $BackendPort." -ForegroundColor DarkGray
}

if (-not (Test-Url "http://127.0.0.1:$FrontendPort")) {
  Write-Host "Starting frontend on port $FrontendPort..." -ForegroundColor Cyan
  Start-Window -WorkingDirectory $frontendDir -Command "python -m http.server $FrontendPort --bind 127.0.0.1"
  if (-not (Wait-Url "http://127.0.0.1:$FrontendPort" 15)) {
    throw "Frontend did not become ready on http://127.0.0.1:$FrontendPort"
  }
} else {
  Write-Host "Frontend is already running on port $FrontendPort." -ForegroundColor DarkGray
}

$frontendUrl = "http://127.0.0.1:$FrontendPort"
$backendUrl = "http://127.0.0.1:$BackendPort/health"

Write-Host ""
Write-Host "Frontend: $frontendUrl" -ForegroundColor Green
Write-Host "Backend health: $backendUrl" -ForegroundColor Green

if (-not $NoBrowser) {
  Start-Process $frontendUrl | Out-Null
}
