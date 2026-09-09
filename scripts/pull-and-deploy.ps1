# pull-and-deploy.ps1 - Pull & Deploy Orchestration (PowerShell)
#
# Flow: git status -> auto-stash (timestamp tag) -> git pull origin <branch>
#       -> stash pop -> hand off to ./scripts/deploy.ps1
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/pull-and-deploy.ps1 [-Branch main] [-DeployArgs "..."]

param(
  [string]$Branch = "main",
  [string]$DeployArgs = ""
)

$ErrorActionPreference = "Stop"

function Write-Hdr([string]$m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Step([string]$m) { Write-Host "  --> $m" -ForegroundColor Yellow }
function Write-Ok([string]$m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Fail([string]$m)       { Write-Host "  [FAIL] $m" -ForegroundColor Red; exit 1 }

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $RepoRoot

Write-Hdr "Pull & Deploy - ai-model-radar (branch: $Branch)"

try { $null = Get-Command git -ErrorAction Stop } catch { Fail "git is not installed or not on PATH." }

# --- Step 1: inspect working tree ---
Write-Step "Inspecting working tree (git status --porcelain)..."
$porcelain = (& git status --porcelain)
if ($LASTEXITCODE -ne 0) { Fail "git status failed." }
$stashed = $false
$stashTag = ""
if ($porcelain) {
  $stashTag = "pull-and-deploy-auto-stash-$(Get-Date -Format 'yyyyMMddHHmmss')"
  Write-Step "Uncommitted changes found - stashing as '$stashTag'..."
  & git stash push -u -m $stashTag
  if ($LASTEXITCODE -ne 0) { Fail "git stash failed; aborting before pull." }
  $stashed = $true
  Write-Ok "Working tree stashed."
} else {
  Write-Ok "Working tree clean - nothing to stash."
}

# --- Step 2: pull latest ---
Write-Step "Pulling latest (git pull origin $Branch)..."
& git pull origin $Branch
if ($LASTEXITCODE -ne 0) {
  Write-Host "  [FAIL] git pull failed." -ForegroundColor Red
  if ($stashed) {
    Write-Step "Restoring stashed state (git stash pop)..."
    & git stash pop
    if ($LASTEXITCODE -ne 0) { Fail "Pull failed AND stash pop failed - work is in 'git stash list' under '$stashTag'. Resolve manually." }
  }
  Fail "git pull origin $Branch failed; working tree restored."
}
$sha = (& git rev-parse --short HEAD).Trim()
Write-Ok "Pull complete (@ $sha)."

# --- Step 3: restore stash ---
if ($stashed) {
  Write-Step "Restoring stashed changes (git stash pop)..."
  & git stash pop
  if ($LASTEXITCODE -ne 0) { Fail "stash pop conflicted. Changes preserved in 'git stash list' ($stashTag). Resolve manually, then run ./scripts/deploy.ps1" }
  Write-Ok "Stashed changes restored."
}

# --- Step 4: hand off to deploy ---
$deployPs1 = Join-Path $RepoRoot "scripts/deploy.ps1"
if (-not (Test-Path $deployPs1)) { Fail "$deployPs1 not found." }
Write-Step "Handing off to scripts/deploy.ps1..."
if ($DeployArgs -ne "") {
  $argArray = $DeployArgs -split '\s+'
  & $deployPs1 @argArray
} else {
  & $deployPs1
}
if ($LASTEXITCODE -ne 0) { Fail "deploy.ps1 exited with code $LASTEXITCODE." }
