#!/usr/bin/env bash
###############################################################################
# deploy.sh — Zero-cost Cloud Run deployment for ai-model-radar (POSIX Bash)
#
# Deploys this Next.js app to Google Cloud Run strictly inside free-tier
# bounds. ANY paid-tier parameter aborts the run (exit 1) BEFORE any cloud
# command executes (fail-on-cost enforcement).
#
# Free-tier contract (enforced by assert_free_tier_compliance):
#   --min-instances 0 | --cpu <= 1 | --memory <= 1Gi | --max-instances <= 2
#   --cpu-throttling (never --no-cpu-throttling) | default *.run.app ingress
#   (no paid LB / static-IP flags) | standard Cloud Build machines only.
#
# Usage:
#   bash scripts/deploy.sh [--project ID] [--region us-central1]
#                          [--service ai-model-radar] [--no-build] [--image TAG]
#
# Env (all optional, sane defaults):
#   GCP_PROJECT, GCP_REGION, SERVICE_NAME, AR_REPO, HEALTH_PATH,
#   DEPLOY_ALLOW_UNAUTHENTICATED (default true), REQUIRED_SECRETS
###############################################################################
set -euo pipefail

# --- colors ---
C_CYAN='\033[0;36m'; C_YELLOW='\033[1;33m'; C_GREEN='\033[0;32m'; C_RED='\033[0;31m'; C_OFF='\033[0m'
hdr()  { printf "${C_CYAN}==> %s${C_OFF}\n" "$*"; }
step() { printf "${C_YELLOW}  --> %s${C_OFF}\n" "$*"; }
ok()   { printf "${C_GREEN}  [OK] %s${C_OFF}\n" "$*"; }
die()  { printf "${C_RED}  [FAIL] %s${C_OFF}\n" "$*" >&2; exit 1; }

# --- defaults (all within free tier) ---
PROJECT="${GCP_PROJECT:-}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE_NAME:-ai-model-radar}"
AR_REPO="${AR_REPO:-radar}"
HEALTH_PATH="${HEALTH_PATH:-/api/health}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-2}"
CPU="${CPU:-1}"
MEMORY="${MEMORY:-1Gi}"
ALLOW_UNAUTH="${DEPLOY_ALLOW_UNAUTHENTICATED:-true}"
DO_BUILD=1
IMAGE_TAG=""
# Secrets are injected out-of-band via Secret Manager (--set-secrets) and
# NEVER baked into the image. Comma-separated "ENV_VAR=secret-name" pairs.
REQUIRED_SECRETS="${REQUIRED_SECRETS:-AUTH_SECRET=auth-secret,CRON_SECRET=cron-secret,ADMIN_SECRET=admin-secret}"

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:?}"; shift 2 ;;
    --region) REGION="${2:?}"; shift 2 ;;
    --service) SERVICE="${2:?}"; shift 2 ;;
    --image) IMAGE_TAG="${2:?}"; DO_BUILD=0; shift 2 ;;
    --no-build) DO_BUILD=0; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# --- benchmark tracking ---
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
HIST_DIR="$REPO_ROOT/deploy-history"
mkdir -p "$HIST_DIR"
declare -A DUR=()
t0_all=$(date +%s)
mark() { # mark <step> <start_epoch>
  DUR["$1"]=$(($(date +%s) - $2));
}

# ===========================================================================
# STEP 1 — Free-tier assertion (runs BEFORE any cloud command)
# ===========================================================================
assert_free_tier_compliance() {
  local viol=0
  deny() { printf "${C_RED}  [COST-ABORT] %s${C_OFF}\n" "$*" >&2; viol=1; }

  [ "$MIN_INSTANCES" = "0" ] || deny "MIN_INSTANCES=$MIN_INSTANCES (must be 0; idle instances bill)."
  [ "$CPU" = "1" ] || deny "CPU=$CPU (must be <= 1 vCPU on free tier)."
  [ "$MAX_INSTANCES" = "1" ] || [ "$MAX_INSTANCES" = "2" ] || deny "MAX_INSTANCES=$MAX_INSTANCES (must be <= 2)."
  case "$MEMORY" in
    256Mi|512Mi|1Gi) ;;
    *) deny "MEMORY=$MEMORY (must be <= 1Gi)." ;;
  esac
  # CPU throttling must be ON: reject any explicit opt-out smuggled via env/args
  case " $* " in
    *" --no-cpu-throttling "*) deny "--no-cpu-throttling requested (bills for idle CPU)." ;;
  esac
  # Paid networking: reject static-IP / LB reservations
  for flag in --static-ip --address= --load-balancer --neg= --network-endpoint-group; do
    case " $* " in *" $flag"*) deny "Paid networking flag '$flag' requested." ;; esac
  done
  # Paid build machines: only standard (default) Cloud Build workers allowed
  case " ${BUILD_MACHINE_TYPE:-} " in
    *highcpu*|*HIGHCPU*|*e2-highcpu*|*n1-highcpu*) deny "Paid build machine '${BUILD_MACHINE_TYPE}' requested." ;;
  esac
  # Replit guard: refuse dedicated/reserved VM mandates in this pipeline
  case " ${REPLIT_VM:-} " in
    *dedicated*|*reserved*|*paid*) deny "Paid Replit VM spec '${REPLIT_VM}' mandated." ;;
  esac
  [ "$viol" -eq 0 ] || { printf "${C_RED}Free-tier compliance FAILED — aborting before any cloud spend (exit 1).${C_OFF}\n" >&2; exit 1; }
}

s=$(date +%s); hdr "Step 1/8 — Free-tier assertion"
assert_free_tier_compliance "$@"
ok "Free-tier compliant (min=$MIN_INSTANCES cpu=$CPU mem=$MEMORY max=$MAX_INSTANCES, throttling on)."
mark "free_tier_check" "$s"

# ===========================================================================
# STEP 2 — Environment & CLI preflight
# ===========================================================================
s=$(date +%s); hdr "Step 2/8 — Environment & CLI preflight"
command -v gcloud >/dev/null 2>&1 || die "gcloud CLI not found. Install it: https://cloud.google.com/sdk/docs/install"
command -v docker >/dev/null 2>&1 || die "docker CLI not found (needed for local-build fallback)."
command -v curl >/dev/null 2>&1 || die "curl not found (needed for health probing)."
[ -n "$PROJECT" ] || PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
[ -n "$PROJECT" ] || die "GCP project unknown. Pass --project ID or set GCP_PROJECT."
step "Authenticating as project ${PROJECT}…"
gcloud auth print-access-token >/dev/null 2>&1 || die "No valid GCP credentials. Run: gcloud auth login"
SHA="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
ok "Preflight OK (project=${PROJECT}, region=${REGION}, sha=${SHA})."
mark "preflight" "$s"

# ===========================================================================
# STEP 3 — Service API enablement (idempotent)
# ===========================================================================
s=$(date +%s); hdr "Step 3/8 — Enabling required (free) service APIs"
for api in run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com; do
  step "Enabling ${api}…"
  gcloud services enable "$api" --project="$PROJECT" --quiet || die "Failed to enable ${api}."
done
ok "Service APIs enabled."
mark "api_enablement" "$s"

# ===========================================================================
# STEP 4 — Out-of-band secret handling (never baked into the image)
# ===========================================================================
s=$(date +%s); hdr "Step 4/8 — Secret Manager check (out-of-band injection)"
step "Ensuring Artifact Registry repo '${AR_REPO}'…"
gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" --project="$PROJECT" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$AR_REPO" --repository-format=docker \
       --location="$REGION" --project="$PROJECT" --quiet || die "Artifact Registry setup failed."
SET_SECRETS_ARGS=()
[ -n "${REQUIRED_SECRETS//[ ,]/}" ] || die "REQUIRED_SECRETS is empty — refusing to deploy with zero secret bindings (auth/cron/admin would all be unconfigured in production)."
OLD_IFS="$IFS"; IFS=','
for pair in $REQUIRED_SECRETS; do
  env_name="${pair%%=*}"; secret_name="${pair##*=}"
  [ -n "$env_name" ] && [ -n "$secret_name" ] || die "Malformed REQUIRED_SECRETS entry: '$pair' (want ENV=secret-name)."
  if ! gcloud secrets describe "$secret_name" --project="$PROJECT" >/dev/null 2>&1; then
    step "Secret '${secret_name}' missing — creating empty container (payload must be added via console/SM API)…"
    printf '' | gcloud secrets create "$secret_name" --project="$PROJECT" --data-file=- --replication-policy=automatic >/dev/null \
      || die "Failed to create secret '${secret_name}'."
    printf "${C_YELLOW}  NOTE: secret '${secret_name}' created EMPTY — set its value, then re-run deploy.${C_OFF}\n"
  fi
  SET_SECRETS_ARGS+=("--set-secrets=${env_name}=${secret_name}:latest")
done
IFS="$OLD_IFS"
# DATABASE_URL is optional (app falls back to local JSON storage); wire it only if present.
if gcloud secrets describe "database-url" --project="$PROJECT" >/dev/null 2>&1; then
  SET_SECRETS_ARGS+=("--set-secrets=DATABASE_URL=database-url:latest")
  step "DATABASE_URL secret found — wiring it."
else
  step "No 'database-url' secret — deploying with local JSON storage fallback."
fi
ok "Secrets resolved (${#SET_SECRETS_ARGS[@]} bindings)."
mark "secrets" "$s"

# ===========================================================================
# STEP 5 — Container build & push (free-tier Cloud Build or local Docker)
# ===========================================================================
s=$(date +%s); hdr "Step 5/8 — Container build & push"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}/${SERVICE}:${SHA}"
[ -f "$REPO_ROOT/Dockerfile" ] || die "Dockerfile not found at repo root; refusing to guess a build."
if [ "$DO_BUILD" -eq 1 ]; then
  step "Submitting free-tier Cloud Build (standard machine)…"
  gcloud builds submit --tag "$IMAGE" --project="$PROJECT" --quiet . \
    || {
      step "Cloud Build failed — falling back to local docker build + push…"
      docker build -t "$IMAGE" . || die "docker build failed."
      docker push "$IMAGE" || die "docker push failed."
    }
else
  IMAGE="${IMAGE_TAG}"
  step "Skipping build; using provided image ${IMAGE}."
fi
ok "Image ready: ${IMAGE}."
mark "build" "$s"

# ===========================================================================
# STEP 6 — Zero-cost deploy
# ===========================================================================
s=$(date +%s); hdr "Step 6/8 — Deploy to Cloud Run (min=0, throttled, capped)"
AUTH_FLAG="--allow-unauthenticated"
[ "$ALLOW_UNAUTH" = "true" ] || AUTH_FLAG="--no-allow-unauthenticated"
step "Deploying ${SERVICE} → ${REGION}…"
gcloud run deploy "$SERVICE" \
  --image="$IMAGE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --platform=managed \
  --min-instances="$MIN_INSTANCES" \
  --max-instances="$MAX_INSTANCES" \
  --cpu="$CPU" \
  --memory="$MEMORY" \
  --cpu-throttling \
  "$AUTH_FLAG" \
  --port=3000 \
  "${SET_SECRETS_ARGS[@]}" \
  --set-env-vars="NODE_ENV=production" \
  --quiet || die "Cloud Run deploy failed."
SERVICE_URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
[ -n "$SERVICE_URL" ] || die "Deploy succeeded but service URL is empty."
case "$SERVICE_URL" in
  *.run.app) ok "Default provider hostname confirmed: ${SERVICE_URL}" ;;
  *) die "Unexpected service hostname '${SERVICE_URL}' (expected *.run.app; paid custom infra suspected)." ;;
esac
mark "deploy" "$s"

# ===========================================================================
# STEP 7 — Liveness & readiness probing (GET $HEALTH_PATH, 12 × 5s)
# ===========================================================================
s=$(date +%s); hdr "Step 7/8 — Health probing ${SERVICE_URL}${HEALTH_PATH}"
ATTEMPTS=12; SLEEP_S=5; PROBE_OK=0
for i in $(seq 1 $ATTEMPTS); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${SERVICE_URL}${HEALTH_PATH}" || echo 000)"
  if [ "$CODE" = "200" ]; then PROBE_OK=1; ok "Healthy on attempt ${i}/${ATTEMPTS} (HTTP 200)."; break; fi
  step "Attempt ${i}/${ATTEMPTS}: HTTP ${CODE} — retrying in ${SLEEP_S}s…"
  sleep "$SLEEP_S"
done
[ "$PROBE_OK" -eq 1 ] || die "Service failed readiness (12 attempts, no HTTP 200 at ${HEALTH_PATH})."
mark "health_probe" "$s"

# ===========================================================================
# STEP 8 — Benchmark & audit artifact
# ===========================================================================
s=$(date +%s); hdr "Step 8/8 — Writing audit artifact"
TOTAL=$(($(date +%s) - t0_all))
ARTIFACT="${HIST_DIR}/deploy_$(date +%Y%m%d%H%M%S)_${SHA}.md"
{
  echo "# Deploy audit — ${SERVICE} @ ${SHA}"
  echo
  echo "- Timestamp (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- Project: ${PROJECT} | Region: ${REGION} | Service: ${SERVICE}"
  echo "- Image: ${IMAGE}"
  echo "- URL: ${SERVICE_URL}"
  echo "- Free-tier compliance: CONFIRMED (min=${MIN_INSTANCES}, cpu=${CPU}, mem=${MEMORY}, max=${MAX_INSTANCES}, cpu-throttling, *.run.app ingress)"
  echo
  echo "| Step | Duration (s) |"
  echo "|------|--------------|"
  for k in free_tier_check preflight api_enablement secrets build deploy health_probe; do
    echo "| ${k} | ${DUR[$k]:-0} |"
  done
  echo "| TOTAL | ${TOTAL} |"
} > "$ARTIFACT"
ok "Audit written: ${ARTIFACT}"
mark "audit" "$s"

printf "${C_GREEN}Deploy complete: ${SERVICE_URL} (total ${TOTAL}s, free-tier compliant).${C_OFF}\n"
