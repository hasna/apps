#!/usr/bin/env bash
# post-commit hook for open-todos: auto-links commits to tasks
# Parses commit message and branch name for task short_ids (e.g. OPE-00042)
# and calls todos CLI to link them via linkTaskToCommit.
#
# Install: todos hook install
# Uninstall: todos hook uninstall

set -euo pipefail

# Get commit info
SHA=$(git rev-parse HEAD)
MESSAGE=$(git log -1 --format='%s' HEAD)
AUTHOR=$(git log -1 --format='%an <%ae>' HEAD)
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
FILES=$(git diff-tree --no-commit-id --name-only -r HEAD | tr '\n' ',' | sed 's/,$//')

# Extract task IDs from message and branch (pattern: PREFIX-NNNNN)
TASK_IDS=$(echo "$MESSAGE $BRANCH" | grep -oE '[A-Z]+-[0-9]+' | sort -u || true)

if [ -z "$TASK_IDS" ]; then
  exit 0
fi

# Check if todos CLI is available
if ! command -v todos &>/dev/null; then
  # Try bun run
  if [ -f "$(git rev-parse --show-toplevel)/src/cli/index.tsx" ]; then
    TODOS_CMD="bun run $(git rev-parse --show-toplevel)/src/cli/index.tsx"
  else
    exit 0
  fi
else
  TODOS_CMD="todos"
fi

for TASK_ID in $TASK_IDS; do
  $TODOS_CMD link-commit "$TASK_ID" "$SHA" --message "$MESSAGE" --author "$AUTHOR" --files "$FILES" 2>/dev/null || true
done
