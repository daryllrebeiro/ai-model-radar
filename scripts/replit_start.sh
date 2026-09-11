#!/usr/bin/env bash
###############################################################################
# replit_start.sh — Replit run stage for ai-model-radar (process supervision)
#
# Modes (first arg or $MODE, default: all):
#   all      — start the Next.js server (serves API + frontend in this repo).
#   backend  — same server, backend-weighted logging prefix.
#   frontend — same server (Next.js is unified here), frontend-weighted prefix.
#
# Production auto-detection: REPL_ENVIRONMENT=production or DEPLOYMENT_ID set
#   => NODE_ENV=production. Otherwise NODE_ENV defaults to development.
# Port conflicts: kills lingering listeners on $PORT (fuser, else lsof/ss).
# Supervision: child PIDs trapped (EXIT INT TERM) and reaped via `wait -n`.
###############################################################################
set -euo pipefail

C_CYAN='\033[0;36m'; C_YELLOW='\033[1;33m'; C_GREEN='\033[0;32m'; C_RED='\033[0;31m'; C_OFF='\033[0m'
hdr()  { printf "${C_CYAN}==> %s${C_OFF}\n" "$*"; }
step() { printf "${C_YELLOW}  --> %s${C_OFF}\n" "$*"; }
ok()   { printf "${C_GREEN}  [OK] %s${C_OFF}\n" "$*"; }
die()  { printf "${C_RED}  [FAIL] %s${C_OFF}\n" "$*" >&2; exit 1; }

# --- free-tier guard ---
case " ${REPLIT_VM:-} " in
  *dedicated*|*reserved*|*paid*)
    printf "${C_RED}  [COST-ABORT] Paid Replit VM spec '${REPLIT_VM}' mandated; autoscale/standard container required (exit 1).${C_OFF}\n" >&2
    exit 1 ;;
esac

MODE="${1:-${MODE:-all}}"
case "$MODE" in all|backend|frontend) ;; *) die "Unknown MODE '$MODE' (want: all|backend|frontend)." ;; esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# --- production auto-detection ---
if [ "${REPL_ENVIRONMENT:-}" = "production" ] || [ -n "${DEPLOYMENT_ID:-}" ]; then
  export NODE_ENV=production
  step "Production deployment detected (REPL_ENVIRONMENT/DEPLOYMENT_ID) — NODE_ENV=production."
else
  export NODE_ENV="${NODE_ENV:-development}"
  step "Non-production run — NODE_ENV=${NODE_ENV}."
fi

PORT="${PORT:-3000}"
export PORT
step "Mode=${MODE}; port=${PORT}."

# --- port conflict resolution ---
step "Clearing lingering listeners on port ${PORT}…"
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -ti:"$PORT" 2>/dev/null || true); do kill -9 "$pid" 2>/dev/null || true; done
else
  step "No fuser/lsof available — skipping port kill (bind will fail loudly if occupied)."
fi
sleep 1

# --- resolve start command for the detected layout ---
if [ -f apps/web/package.json ]; then
  START_CMD="npm run start --workspace=${REPLIT_BUILD_WORKSPACE:-apps/web} -- -- -p $PORT"
elif [ -f frontend/package.json ] && [ -f backend/package.json ]; then
  # Split layout: backend API + frontend UI as supervised siblings.
  BACKEND_PORT="${BACKEND_PORT:-3001}"
  export INTERNAL_API_URL="http://localhost:${BACKEND_PORT}"
  step "Split layout — backend on ${BACKEND_PORT}, frontend on ${PORT}."
  (cd backend && PORT="$BACKEND_PORT" npm run start > /tmp/radar-backend.log 2>&1 & echo $! > /tmp/radar-backend.pid)
  BACKEND_PID="$(cat /tmp/radar-backend.pid)"
  cleanup_split() { kill -TERM "$BACKEND_PID" 2>/dev/null || true; }
  trap cleanup_split EXIT INT TERM
  step "Backend started (pid ${BACKEND_PID}); starting frontend…"
  (cd frontend && PORT="$PORT" npm run start > /tmp/radar-frontend.log 2>&1 & echo $! > /tmp/radar-frontend.pid)
  FRONTEND_PID="$(cat /tmp/radar-frontend.pid)"
  step "Tailing both logs (backend=${BACKEND_PID}, frontend=${FRONTEND_PID})…"
  tail -F /tmp/radar-backend.log /tmp/radar-frontend.log & TAIL_PID=$!
  trap 'kill -TERM "$BACKEND_PID" "$FRONTEND_PID" "$TAIL_PID" 2>/dev/null || true' EXIT INT TERM
  wait -n "$BACKEND_PID" "$FRONTEND_PID"
  ec=$?
  kill -TERM "$TAIL_PID" 2>/dev/null || true
  exit "$ec"
else
  [ -d .next ] || { step "No .next artifact — building inline…"; NEXT_TELEMETRY_DISABLED=1 npm run build || die "Build failed."; }
  START_CMD="npx next start -p $PORT"
fi

# --- unified single-server supervision ---
hdr "Starting ai-model-radar (${MODE}) on port ${PORT}…"
# shellcheck disable=SC2086
$START_CMD &
CHILD_PID=$!
ok "Server launched (pid ${CHILD_PID}; mode=${MODE})."
trap 'step "Stopping child ${CHILD_PID}…"; kill -TERM "$CHILD_PID" 2>/dev/null || true; wait "$CHILD_PID" 2>/dev/null || true' EXIT INT TERM
wait -n "$CHILD_PID"
EC=$?
step "Child exited with code ${EC} — shutting down."
exit "$EC"
