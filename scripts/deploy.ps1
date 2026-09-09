# deploy.ps1 - Zero-cost Cloud Run deployment for ai-model-radar (PowerShell)
#
# Mirrors scripts/deploy.sh step-for-step (dual-shell parity). Strict
# fail-on-cost enforcement runs BEFORE any cloud command (exit 1 on violation).
#
# Free-tier contract (enforced by Test-FreeTierCompliance):
#   min-instances 0 | cpu <= 1 | memory <= 1Gi | max-instances <= 2
#   cpu-throttling (never --no-cpu-throttling) | default *.run.app ingress
#   standard Cloud Build machines only.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1 [-Project ID]
#     [-Region us-central1] [-Service ai-model-radar] [-NoBuild] [-Image TAG]

param(
  [string]$Project = $env:GCP_PROJECT,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [string]$Service = $(if ($env:SERVICE_NAME) { $env:SERVICE_NAME } else { "ai-model-radar" }),
  [string]$ArRepo = $(if ($env:AR_REPO) { $env:AR_REPO } else { "radar" }),
  [string]$HealthPath = $(if ($env:HEALTH_PATH) { $env:HEALTH_PATH } else { "/api/health" }),
  [string]$MinInstances = $(if ($env:MIN_INSTANCES) { $env:MIN_INSTANCES } else { "0" }),
  [string]$MaxInstances = $(if ($env:MAX_INSTANCES) { $env:MAX_INSTANCES } else { "2" }),
  [string]$Cpu = $(if ($env:CPU) { $env:CPU } else { "1" }),
  [string]$Memory = $(if ($env:MEMORY) { $env:MEMORY } else { "1Gi" }),
  [switch]$NoBuild,
  [string]$Image = ""
)

$ErrorActionPreference = "Stop"

function Write-Hdr([string]$m)  { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Step([string]$m) { Write-Host "  --> $m" -ForegroundColor Yellow }
function Write-Ok([string]$m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Fail([string]$m)       { Write-Host "  [FAIL] $m" -ForegroundColor Red; exit 1 }

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $RepoRoot
$HistDir = Join-Path $RepoRoot "deploy-history"
if (-not (Test-Path $HistDir)) { New-Item -ItemType Directory -Path $HistDir | Out-Null }
$dur = @{}
$t0All = Get-Date
function Mark-Step([string]$name, [datetime]$start) { $dur[$name] = [int]((Get-Date) - $start).TotalSeconds }

# ===========================================================================
# STEP 1 - Free-tier assertion (runs BEFORE any cloud command)
# ===========================================================================
function Test-FreeTierCompliance {
  param([string[]]$ExtraArgs)
  $violations = @()
  if ($MinInstances -ne "0") { $violations += "MIN_INSTANCES=$MinInstances (must be 0; idle instances bill)." }
  if ($Cpu -ne "1") { $violations += "CPU=$Cpu (must be <= 1 vCPU on free tier)." }
  if ($MaxInstances -ne "1" -and $MaxInstances -ne "2") { $violations += "MAX_INSTANCES=$MaxInstances (must be <= 2)." }
  if ($Memory -notin @("256Mi", "512Mi", "1Gi")) { $violations += "MEMORY=$Memory (must be <= 1Gi)." }
  $joined = " $($ExtraArgs -join ' ') "
  if ($joined -match '--no-cpu-throttling') { $violations += "--no-cpu-throttling requested (bills for idle CPU)." }
  foreach ($flag in @('--static-ip', '--address=', '--load-balancer', '--neg=', '--network-endpoint-group')) {
    if ($joined -match [regex]::Escape($flag)) { $violations += "Paid networking flag '$flag' requested." }
  }
  if ($env:BUILD_MACHINE_TYPE -match 'highcpu|e2-highcpu|n1-highcpu') { $violations += "Paid build machine '$env:BUILD_MACHINE_TYPE' requested." }
  if ($env:REPLIT_VM -match 'dedicated|reserved|paid') { $violations += "Paid Replit VM spec '$env:REPLIT_VM' mandated." }
  if ($violations.Count -gt 0) {
    foreach ($v in $violations) { Write-Host "  [COST-ABORT] $v" -ForegroundColor Red }
    Write-Host "Free-tier compliance FAILED - aborting before any cloud spend (exit 1)." -ForegroundColor Red
    exit 1
  }
}

$s = Get-Date; Write-Hdr "Step 1/8 - Free-tier assertion"
Test-FreeTierCompliance -ExtraArgs $args
Write-Ok "Free-tier compliant (min=$MinInstances cpu=$Cpu mem=$Memory max=$MaxInstances, throttling on)."
Mark-Step "free_tier_check" $s

# ===========================================================================
# STEP 2 - Environment & CLI preflight
# ===========================================================================
$s = Get-Date; Write-Hdr "Step 2/8 - Environment & CLI preflight"
try { $null = Get-Command gcloud -ErrorAction Stop } catch { Fail "gcloud CLI not found. Install it: https://cloud.google.com/sdk/docs/install" }
try { $null = Get-Command docker -ErrorAction Stop } catch { Fail "docker CLI not found (needed for local-build fallback)." }
if ([string]::IsNullOrWhiteSpace($Project)) {
  $Project = (& gcloud config get-value project 2>$null).Trim()
}
if ([string]::IsNullOrWhiteSpace($Project)) { Fail "GCP project unknown. Pass -Project ID or set GCP_PROJECT." }
Write-Step "Authenticating as project $Project..."
& gcloud auth print-access-token | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "No valid GCP credentials. Run: gcloud auth login" }
$Sha = ""
try { $Sha = (& git rev-parse --short HEAD 2>$null).Trim() } catch { $Sha = "" }
if ([string]::IsNullOrWhiteSpace($Sha)) { $Sha = Get-Date -Format "yyyyMMddHHmmss" }
Write-Ok "Preflight OK (project=$Project, region=$Region, sha=$Sha)."
Mark-Step "preflight" $s

# ===========================================================================
# STEP 3 - Service API enablement (idempotent)
# ===========================================================================
$s = Get-Date; Write-Hdr "Step 3/8 - Enabling required (free) service APIs"
foreach ($api in @("run.googleapis.com", "cloudbuild.googleapis.com", "artifactregistry.googleapis.com", "secretmanager.googleapis.com")) {
  Write-Step "Enabling $api..."
  & gcloud services enable $api --project=$Project --quiet
  if ($LASTEXITCODE -ne 0) { Fail "Failed to enable $api." }
}
Write-Ok "Service APIs enabled."
Mark-Step "api_enablement" $s

# ===========================================================================
# STEP 4 - Out-of-band secret handling (never baked into the image)
# ===========================================================================
$s = Get-Date; Write-Hdr "Step 4/8 - Secret Manager check (out-of-band injection)"
Write-Step "Ensuring Artifact Registry repo '$ArRepo'..."
& gcloud artifacts repositories describe $ArRepo --location=$Region --project=$Project 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  & gcloud artifacts repositories create $ArRepo --repository-format=docker --location=$Region --project=$Project --quiet
  if ($LASTEXITCODE -ne 0) { Fail "Artifact Registry setup failed." }
}
$requiredSecrets = if ($env:REQUIRED_SECRETS) { $env:REQUIRED_SECRETS } else { "AUTH_SECRET=auth-secret,CRON_SECRET=cron-secret,ADMIN_SECRET=admin-secret" }
if ([string]::IsNullOrWhiteSpace($requiredSecrets.Replace(",", "").Replace(" ", ""))) { Fail "REQUIRED_SECRETS is empty - refusing to deploy with zero secret bindings (auth/cron/admin would all be unconfigured in production)." }
$setSecretsArgs = @()
foreach ($pair in ($requiredSecrets -split ',')) {
  $kv = $pair -split '=', 2
  if ($kv.Count -ne 2 -or [string]::IsNullOrWhiteSpace($kv[0]) -or [string]::IsNullOrWhiteSpace($kv[1])) { Fail "Malformed REQUIRED_SECRETS entry: '$pair' (want ENV=secret-name)." }
  $envName, $secretName = $kv[0].Trim(), $kv[1].Trim()
  & gcloud secrets describe $secretName --project=$Project 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Step "Secret '$secretName' missing - creating empty container (set payload via console/SM API)..."
    "" | & gcloud secrets create $secretName --project=$Project --data-file=- --replication-policy=automatic | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "Failed to create secret '$secretName'." }
    Write-Host "  NOTE: secret '$secretName' created EMPTY - set its value, then re-run deploy." -ForegroundColor Yellow
  }
  $setSecretsArgs += "--set-secrets=${envName}=${secretName}:latest"
}
& gcloud secrets describe "database-url" --project=$Project 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  $setSecretsArgs += "--set-secrets=DATABASE_URL=database-url:latest"
  Write-Step "DATABASE_URL secret found - wiring it."
} else {
  Write-Step "No 'database-url' secret - deploying with local JSON storage fallback."
}
Write-Ok "Secrets resolved ($($setSecretsArgs.Count) bindings)."
Mark-Step "secrets" $s

# ===========================================================================
# STEP 5 - Container build & push (free-tier Cloud Build or local Docker)
# ===========================================================================
$s = Get-Date; Write-Hdr "Step 5/8 - Container build & push"
$FinalImage = "$Region-docker.pkg.dev/$Project/$ArRepo/${Service}:${Sha}"
if (-not (Test-Path (Join-Path $RepoRoot "Dockerfile"))) { Fail "Dockerfile not found at repo root; refusing to guess a build." }
if (-not $NoBuild -and [string]::IsNullOrWhiteSpace($Image)) {
  Write-Step "Submitting free-tier Cloud Build (standard machine)..."
  & gcloud builds submit --tag $FinalImage --project=$Project --quiet .
  if ($LASTEXITCODE -ne 0) {
    Write-Step "Cloud Build failed - falling back to local docker build + push..."
    & docker build -t $FinalImage .
    if ($LASTEXITCODE -ne 0) { Fail "docker build failed." }
    & docker push $FinalImage
    if ($LASTEXITCODE -ne 0) { Fail "docker push failed." }
  }
} else {
  if (-not [string]::IsNullOrWhiteSpace($Image)) { $FinalImage = $Image }
  Write-Step "Skipping build; using provided image $FinalImage."
}
Write-Ok "Image ready: $FinalImage."
Mark-Step "build" $s

# ===========================================================================
# STEP 6 - Zero-cost deploy
# ===========================================================================
$s = Get-Date; Write-Hdr "Step 6/8 - Deploy to Cloud Run (min=0, throttled, capped)"
$allowUnauth = if ($env:DEPLOY_ALLOW_UNAUTHENTICATED) { $env:DEPLOY_ALLOW_UNAUTHENTICATED } else { "true" }
$authFlag = if ($allowUnauth -eq "true") { "--allow-unauthenticated" } else { "--no-allow-unauthenticated" }
Write-Step "Deploying $Service -> $Region..."
$deployArgs = @("run", "deploy", $Service, "--image=$FinalImage", "--project=$Project",
  "--region=$Region", "--platform=managed", "--min-instances=$MinInstances",
  "--max-instances=$MaxInstances", "--cpu=$Cpu", "--memory=$Memory",
  "--cpu-throttling", $authFlag, "--port=3000",
  "--set-env-vars=NODE_ENV=production", "--quiet") + $setSecretsArgs
& gcloud @deployArgs
if ($LASTEXITCODE -ne 0) { Fail "Cloud Run deploy failed." }
$ServiceUrl = (& gcloud run services describe $Service --project=$Project --region=$Region --format="value(status.url)").Trim()
if ([string]::IsNullOrWhiteSpace($ServiceUrl)) { Fail "Deploy succeeded but service URL is empty." }
if ($ServiceUrl -notlike "*.run.app") { Fail "Unexpected hostname '$ServiceUrl' (expected *.run.app; paid custom infra suspected)." }
Write-Ok "Default provider hostname confirmed: $ServiceUrl"
Mark-Step "deploy" $s

# ===========================================================================
# STEP 7 - Liveness & readiness probing (GET $HealthPath, 12 x 5s)
# ===========================================================================
$s = Get-Date; Write-Hdr "Step 7/8 - Health probing $ServiceUrl$HealthPath"
$probeOk = $false
for ($i = 1; $i -le 12; $i++) {
  try {
    $resp = Invoke-WebRequest -Uri "$ServiceUrl$HealthPath" -TimeoutSec 15 -UseBasicParsing
    $code = [int]$resp.StatusCode
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  }
  if ($code -eq 200) { $probeOk = $true; Write-Ok "Healthy on attempt $i/12 (HTTP 200)."; break }
  Write-Step "Attempt $i/12: HTTP $code - retrying in 5s..."
  Start-Sleep -Seconds 5
}
if (-not $probeOk) { Fail "Service failed readiness (12 attempts, no HTTP 200 at $HealthPath)." }
Mark-Step "health_probe" $s

# ===========================================================================
# STEP 8 - Benchmark & audit artifact
# ===========================================================================
$s = Get-Date; Write-Hdr "Step 8/8 - Writing audit artifact"
$total = [int]((Get-Date) - $t0All).TotalSeconds
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$artifact = Join-Path $HistDir "deploy_${stamp}_${Sha}.md"
$lines = @(
  "# Deploy audit - $Service @ $Sha",
  "",
  "- Timestamp (UTC): $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))",
  "- Project: $Project | Region: $Region | Service: $Service",
  "- Image: $FinalImage",
  "- URL: $ServiceUrl",
  "- Free-tier compliance: CONFIRMED (min=$MinInstances, cpu=$Cpu, mem=$Memory, max=$MaxInstances, cpu-throttling, *.run.app ingress)",
  "",
  "| Step | Duration (s) |",
  "|------|--------------|"
)
foreach ($k in @("free_tier_check", "preflight", "api_enablement", "secrets", "build", "deploy", "health_probe")) {
  $v = if ($dur.ContainsKey($k)) { $dur[$k] } else { 0 }
  $lines += "| $k | $v |"
}
$lines += "| TOTAL | $total |"
$lines | Set-Content -Path $artifact -Encoding UTF8
Write-Ok "Audit written: $artifact"
Mark-Step "audit" $s

Write-Host "Deploy complete: $ServiceUrl (total ${total}s, free-tier compliant)." -ForegroundColor Green
