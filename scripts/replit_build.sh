#!/usr/bin/env bash
###############################################################################
# replit_build.sh — Replit build stage for ai-model-radar
#
#   1. Fail fast if a paid/dedicated Replit VM is mandated (free-tier guard).
#   2. Bust stale/corrupt caches (.next, __pycache__, node_modules validation).
#   3. Install dependencies from lockfiles (npm ci; pip only if present).
#   4. Emit the production Next.js artifact (npm run build).
#
# No placeholders: every step detects the real repo layout before acting.
###############################################################################
set -euo pipefail

C_CYAN='\033[0;36m'; C_YELLOW='\033[1;33m'; C_GREEN='\033[0;32m'; C_RED='\033[0;31m'; C_OFF='\033[0m'
hdr()  { printf "${C_CYAN}==> %s${C_OFF}\n" "$*"; }
step() { printf "${C_YELLOW}  --> %s${C_OFF}\n" "$*"; }
ok()   { printf "${C_GREEN}  [OK] %s${C_OFF}\n" "$*"; }
die()  { printf "${C_RED}  [FAIL] %s${C_OFF}\n" "$*" >&2; exit 1; }

# --- free-tier guard: refuse paid dedicated/reserved VM mandates ---
case " ${REPLIT_VM:-} " in
  *dedicated*|*reserved*|*paid*)
    printf "${C_RED}  [COST-ABORT] Paid Replit VM spec '${REPLIT_VM}' mandated; autoscale/standard container required (exit 1).${C_OFF}\n" >&2
    exit 1 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
hdr "Replit build — ai-model-radar"

# --- Step 1: cache busting ---
step "Cleaning previous build caches…"
rm -rf .next
find . -maxdepth 3 -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
if [ -d node_modules ] && [ ! -x node_modules/.bin/next ]; then
  step "node_modules present but corrupt (no .bin/next) — removing…"
  rm -rf node_modules
fi
ok "Caches clean."

# --- Step 2: dependency install from lockfiles ---
if [ -f package-lock.json ]; then
  step "Installing Node dependencies (npm ci)…"
  npm ci --no-audit --no-fund || die "npm ci failed."
elif [ -f package.json ]; then
  step "No package-lock.json — falling back to npm install…"
  npm install --no-audit --no-fund || die "npm install failed."
else
  die "No package.json found; nothing to build."
fi
# Python is optional in this repo: only install when a manifest exists.
if [ -f requirements.txt ]; then
  step "Installing Python dependencies (pip install --no-cache-dir)…"
  pip install --no-cache-dir -r requirements.txt || die "pip install failed."
else
  step "No requirements.txt — skipping Python install."
fi
ok "Dependencies installed."

# --- Step 3: production build ---
if [ -f apps/web/package.json ] && [ -f apps/web/next.config.mjs ]; then
  step "Monorepo detected (apps/web) — building workspace…"
  npm run build --workspace="${REPLIT_BUILD_WORKSPACE:-apps/web}" 2>/dev/null || npm run build || die "Build failed."
elif [ -f frontend/package.json ] && [ -f backend/package.json ]; then
  step "Split frontend/backend layout — building frontend…"
  (cd frontend && npm run build) || die "Frontend build failed."
else
  step "Single-package Next.js root — running npm run build…"
  NEXT_TELEMETRY_DISABLED=1 npm run build || die "Next.js build failed."
fi
[ -d .next ] || [ -d frontend/.next ] || [ -d apps/web/.next ] || die "Build finished but no .next artifact found."
ok "Build artifact ready."
printf "${C_GREEN}Replit build complete.${C_OFF}\n"
