#!/usr/bin/env bash
###############################################################################
# pull-and-deploy.sh — Pull & Deploy Orchestration (POSIX Bash)
#
# Flow: git status -> auto-stash (timestamp tag) -> git pull origin <branch>
#       -> stash pop -> hand off to ./scripts/deploy.sh
#
# Usage:
#   bash scripts/pull-and-deploy.sh [--branch main] [--deploy-args "..."]
#
# Safety:
#   - On pull failure the stash is restored and the script exits 1.
#   - Never deletes user work: stash pop conflicts abort with instructions.
#   - Free-tier compliance is enforced inside deploy.sh (fail-on-cost).
###############################################################################
set -euo pipefail

# --- color helpers (Cyan headers, Yellow steps, Green success, Red errors) ---
C_CYAN='\033[0;36m'; C_YELLOW='\033[1;33m'; C_GREEN='\033[0;32m'; C_RED='\033[0;31m'; C_OFF='\033[0m'
hdr()  { printf "${C_CYAN}==> %s${C_OFF}\n" "$*"; }
step() { printf "${C_YELLOW}  --> %s${C_OFF}\n" "$*"; }
ok()   { printf "${C_GREEN}  [OK] %s${C_OFF}\n" "$*"; }
die()  { printf "${C_RED}  [FAIL] %s${C_OFF}\n" "$*" >&2; exit 1; }

BRANCH="main"
DEPLOY_ARGS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:?--branch needs a value}"; shift 2 ;;
    --deploy-args) DEPLOY_ARGS="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "Unknown argument: $1 (see --help)" ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

hdr "Pull & Deploy — ai-model-radar (branch: ${BRANCH})"
START_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

command -v git >/dev/null 2>&1 || die "git is not installed or not on PATH."

# --- Step 1: inspect working tree ---
step "Inspecting working tree (git status --porcelain)…"
PORCELAIN="$(git status --porcelain || die "git status failed.")"
STASHED=0
STASH_TAG=""
if [ -n "$PORCELAIN" ]; then
  STASH_TAG="pull-and-deploy-auto-stash-$(date +%Y%m%d%H%M%S)"
  step "Uncommitted changes found — stashing as '${STASH_TAG}'…"
  git stash push -u -m "$STASH_TAG" || die "git stash failed; aborting before pull."
  STASHED=1
  ok "Working tree stashed."
else
  ok "Working tree clean — nothing to stash."
fi

# --- Step 2: pull latest ---
step "Pulling latest (git pull origin ${BRANCH})…"
if ! git pull origin "$BRANCH"; then
  printf "${C_RED}  [FAIL] git pull failed.${C_OFF}\n" >&2
  if [ "$STASHED" -eq 1 ]; then
    step "Restoring stashed state (git stash pop)…"
    git stash pop || die "Pull failed AND stash pop failed — your work is in 'git stash list' under '${STASH_TAG}'. Resolve manually."
  fi
  die "git pull origin ${BRANCH} failed; working tree restored."
fi
ok "Pull complete (@ $(git rev-parse --short HEAD))."

# --- Step 3: restore stash ---
if [ "$STASHED" -eq 1 ]; then
  step "Restoring stashed changes (git stash pop)…"
  if ! git stash pop; then
    die "stash pop conflicted. Your changes are preserved in 'git stash list' (${STASH_TAG}). Resolve conflicts manually, then run ./scripts/deploy.sh"
  fi
  ok "Stashed changes restored."
fi

# --- Step 4: hand off to deploy ---
DEPLOY_SH="./scripts/deploy.sh"
[ -f "$DEPLOY_SH" ] || die "${DEPLOY_SH} not found."
step "Handing off to ${DEPLOY_SH} (started ${START_TS})…"
if [ -n "$DEPLOY_ARGS" ]; then
  # shellcheck disable=SC2086
  bash "$DEPLOY_SH" $DEPLOY_ARGS
else
  bash "$DEPLOY_SH"
fi
