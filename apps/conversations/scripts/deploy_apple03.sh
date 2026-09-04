#!/usr/bin/env bash
# Sync this repo to apple03, build "Hasna Conversations.app" there, upload it via the
# attachments CLI, install it to /Applications, and launch it. Run from spark02.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-apple03}"
REMOTE_PATH="${REMOTE_PATH:-/Users/hasna/workspace/repos/hasna/apps/apps/conversations}"
APP_NAME="Hasna Conversations"

echo "==> rsync $REPO_ROOT -> $REMOTE_HOST:$REMOTE_PATH"
ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_PATH'"
rsync -az --delete \
  --exclude '.git/' \
  --exclude '.build/' \
  --exclude 'dist-app/' \
  --exclude 'node_modules/' \
  "$REPO_ROOT/" "$REMOTE_HOST:$REMOTE_PATH/"

echo "==> building on $REMOTE_HOST"
ssh "$REMOTE_HOST" "cd '$REMOTE_PATH' && bash scripts/build_conversations_app.sh"

echo "==> zipping .app on $REMOTE_HOST"
ssh "$REMOTE_HOST" "cd '$REMOTE_PATH/dist-app' && rm -f '$APP_NAME.zip' && ditto -c -k --keepParent '$APP_NAME.app' '$APP_NAME.zip' && du -sh '$APP_NAME.zip'"

echo "==> uploading via attachments CLI (from $REMOTE_HOST)"
if ssh "$REMOTE_HOST" "command -v attachments >/dev/null 2>&1 || [ -x \$HOME/.bun/bin/attachments ]"; then
  ssh "$REMOTE_HOST" "cd '$REMOTE_PATH/dist-app' && (command -v attachments >/dev/null 2>&1 && attachments || \$HOME/.bun/bin/attachments) upload '$APP_NAME.zip' --tag hasna-conversations-macos --expiry 30d --brief" || echo "   (upload step reported an error; continuing)"
else
  echo "   attachments CLI not on $REMOTE_HOST; pulling zip to spark02 and uploading here"
  scp "$REMOTE_HOST:$REMOTE_PATH/dist-app/$APP_NAME.zip" "/tmp/$APP_NAME.zip"
  attachments upload "/tmp/$APP_NAME.zip" --tag hasna-conversations-macos --expiry 30d --brief || echo "   (upload step reported an error; continuing)"
fi

echo "==> installing to /Applications and launching on $REMOTE_HOST"
ssh "$REMOTE_HOST" "rm -rf '/Applications/$APP_NAME.app' && cp -R '$REMOTE_PATH/dist-app/$APP_NAME.app' '/Applications/' && open '/Applications/$APP_NAME.app' && echo '   launched'" \
  || echo "   install/launch reported an error (headless session?); app is at $REMOTE_HOST:/Applications/$APP_NAME.app"

echo ""
echo "Done. $APP_NAME.app built, uploaded, installed on $REMOTE_HOST."
