#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# O15-05112: the log used to be written INSIDE the repo tree (.scripts/sync.log),
# where the auto-commit below swept it back into git every run. State lives in
# the per-app state dir outside the repo, never in the tree.
LOG="${TESTERS_LOG_DIR:-$HOME/.hasna/testers}/sync.log"
mkdir -p "$(dirname "$LOG")"

cd "$REPO"

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="

  # Commit any uncommitted changes to TRACKED files only (-u). Never stage
  # untracked files: runtime state artifacts (heartbeat blobs, exports,
  # test-run markers) must not be swept into git by an auto-commit.
  git add -u
  if ! git diff --cached --quiet; then
    git commit -m "chore: auto-commit uncommitted changes before sync"
    echo "Committed local changes"
  else
    echo "No tracked changes to commit"
  fi

  # Pull latest from GitHub
  git pull --rebase
  echo "Pulled latest from GitHub"
  echo "=== done ==="
  echo ""
} >> "$LOG" 2>&1
