#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/hasna/workspace/repos/hasna/apps/conversations"
LOG_FILE="$REPO_DIR/.scripts/midnight-sync.log"

cd "$REPO_DIR"

echo "=== Sync started at $(date -Iseconds) ===" >> "$LOG_FILE"

# Check for uncommitted changes and commit them
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo "Uncommitted changes found, committing..." >> "$LOG_FILE"
    git add -A

    # Secrets scan before commit
    if git diff --cached --diff-filter=ACM -- '*.env' '*.json' '*.toml' '*.ts' '*.js' '*.md' '*.sh' '*.yml' '*.yaml' | grep -qiE 'sk[-]ant-|sk[-]proj-|npm[_][a-zA-Z]|gho[_]|ghp[_]|secret[-]token:|ctx7sk[-]|xai[-]|AIza[a-zA-Z0-9]|AKIA[A-Z0-9]'; then
        echo "SECRETS DETECTED — aborting commit" >> "$LOG_FILE"
        git reset HEAD
        exit 1
    fi

    git commit -m "chore: auto-commit uncommitted changes before sync" >> "$LOG_FILE" 2>&1
else
    echo "Working tree clean, nothing to commit." >> "$LOG_FILE"
fi

# Pull latest from GitHub
echo "Pulling latest from origin..." >> "$LOG_FILE"
git pull --rebase origin main >> "$LOG_FILE" 2>&1

echo "=== Sync completed at $(date -Iseconds) ===" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
