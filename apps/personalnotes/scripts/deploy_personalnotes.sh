#!/usr/bin/env bash
# Deploy PersonalNotes to /Applications on a Mac.
#
# Local mode (default — run ON the Mac):
#   scripts/deploy_personalnotes.sh
#   Builds dist/PersonalNotes.app via scripts/build_personalnotes.sh, quits any
#   running copy gracefully, installs to /Applications/PersonalNotes.app, removes
#   the stale pre-rename "/Applications/Hasna Notes.app" install if present,
#   relaunches the app, and verifies it is running from /Applications.
#
# Remote mode (run from any dev box):
#   scripts/deploy_personalnotes.sh <ssh-host>        # or REMOTE_HOST=<ssh-host>
#   Rsyncs this working tree to the same $HOME-relative checkout path on the Mac
#   (override with REMOTE_DIR, relative to the remote $HOME) and re-runs itself
#   there over ssh. No machine names are hardcoded here — the target always comes
#   from argv or the environment.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="PersonalNotes"
BUNDLE_ID="com.hasna.notes"
INSTALL_APP="/Applications/$APP_NAME.app"
# Pre-rename install left behind by builds before the PersonalNotes rebrand.
# Same bundle id, old name — superseded by $INSTALL_APP and removed on deploy.
LEGACY_APP="/Applications/Hasna Notes.app"
LEGACY_EXEC="HasnaNotes"

REMOTE_HOST="${1:-${REMOTE_HOST:-}}"

if [[ -n "$REMOTE_HOST" ]]; then
  # ---------------- remote mode: push the tree, run local mode over ssh ----------------
  if [[ -z "${REMOTE_DIR:-}" ]]; then
    if [[ "$REPO_ROOT" == "$HOME"/* ]]; then
      REMOTE_DIR="${REPO_ROOT#"$HOME"/}" # mirror the local $HOME-relative checkout path
    else
      echo "ERROR: repo is outside \$HOME; set REMOTE_DIR (checkout path relative to the remote \$HOME)" >&2
      exit 1
    fi
  fi
  echo "==> Syncing sources -> $REMOTE_HOST:$REMOTE_DIR"
  ssh "$REMOTE_HOST" "mkdir -p '$REMOTE_DIR'"
  # Excludes: VCS + build/install outputs + gitignored scratch (tools/shots holds
  # screenshot evidence on the target; a deploy must not delete it).
  rsync -a --delete \
    --exclude '.git' --exclude 'node_modules' --exclude '.build' \
    --exclude 'dist' --exclude '.claude' --exclude '.hasna' \
    --exclude 'tools/shots' \
    "$REPO_ROOT/" "$REMOTE_HOST:$REMOTE_DIR/"
  echo "==> Running deploy on $REMOTE_HOST"
  exec ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && bash scripts/deploy_personalnotes.sh"
fi

# ---------------- local mode: build + install + relaunch + verify ----------------
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: local deploy must run on macOS (pass an ssh host or set REMOTE_HOST to drive a Mac remotely)" >&2
  exit 1
fi

bash "$REPO_ROOT/scripts/build_personalnotes.sh"
BUILT_APP="$REPO_ROOT/dist/$APP_NAME.app"
[[ -d "$BUILT_APP" ]] || { echo "ERROR: build did not produce $BUILT_APP" >&2; exit 1; }

# Quit any running copy — new or pre-rename executable, both share $BUNDLE_ID.
# Graceful AppleScript quit first, then escalate to pkill; tolerate not-running.
echo "==> Quitting running $APP_NAME (if any)"
osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
for _ in $(seq 1 10); do
  pgrep -x "$APP_NAME" >/dev/null 2>&1 || pgrep -x "$LEGACY_EXEC" >/dev/null 2>&1 || break
  sleep 1
done
pkill -x "$APP_NAME" >/dev/null 2>&1 || true
pkill -x "$LEGACY_EXEC" >/dev/null 2>&1 || true
# Orphaned AI sidecars spawned by an installed copy (normally die with the app).
pkill -f "/Applications/.*/Contents/Resources/ai-sidecar/server\.mjs" >/dev/null 2>&1 || true
sleep 1

echo "==> Installing -> $INSTALL_APP"
rm -rf "$INSTALL_APP"
ditto "$BUILT_APP" "$INSTALL_APP"

if [[ -d "$LEGACY_APP" ]]; then
  echo "==> Removing stale pre-rename install: $LEGACY_APP"
  rm -rf "$LEGACY_APP"
fi

echo "==> Launching $INSTALL_APP"
open "$INSTALL_APP"

echo "==> Verifying"
RUNNING=""
for _ in $(seq 1 15); do
  if pgrep -f "$INSTALL_APP/Contents/MacOS/$APP_NAME" >/dev/null 2>&1; then RUNNING=1; break; fi
  sleep 1
done
[[ -n "$RUNNING" ]] || { echo "ERROR: $APP_NAME is not running from $INSTALL_APP after launch" >&2; exit 1; }
INSTALLED_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INSTALL_APP/Contents/Info.plist")"
INSTALLED_VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INSTALL_APP/Contents/Info.plist")"
INSTALLED_BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$INSTALL_APP/Contents/Info.plist")"
[[ "$INSTALLED_ID" == "$BUNDLE_ID" ]] || { echo "ERROR: installed bundle id is $INSTALLED_ID (want $BUNDLE_ID)" >&2; exit 1; }
[[ ! -d "$LEGACY_APP" ]] || { echo "ERROR: stale legacy app still present: $LEGACY_APP" >&2; exit 1; }
[[ -f "$INSTALL_APP/Contents/Resources/AppIcon.icns" ]] || echo "WARNING: AppIcon.icns missing from installed bundle" >&2

echo "DEPLOYED: $INSTALL_APP"
echo "          bundle id=$INSTALLED_ID version=$INSTALLED_VER build=$INSTALLED_BUILD"
pgrep -fl "$INSTALL_APP/Contents/MacOS/$APP_NAME" | sed 's/^/          running: /'
