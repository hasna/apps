#!/usr/bin/env bash
# Deploy HasnaNotes to /Applications on a Mac.
#
# Local mode (default — run ON the Mac):
#   scripts/deploy_notes.sh
#   Builds dist/HasnaNotes.app via scripts/build_notes.sh, quits any
#   running copy gracefully, installs to /Applications/HasnaNotes.app, removes
#   stale pre-rename installs (same bundle id, older display names), relaunches
#   the app, and verifies it is running from /Applications.
#
# Remote mode (run from any dev box):
#   scripts/deploy_notes.sh <ssh-host>        # or REMOTE_HOST=<ssh-host>
#   Rsyncs this working tree to the same $HOME-relative checkout path on the Mac
#   (override with REMOTE_DIR, relative to the remote $HOME) and re-runs itself
#   there over ssh. No machine names are hardcoded here — the target always comes
#   from argv or the environment.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="HasnaNotes"
BUNDLE_ID="com.hasna.notes"
INSTALL_APP="/Applications/$APP_NAME.app"
# Stale installs from earlier branding share $BUNDLE_ID under different display
# names and executables. They are located by bundle id below, never by name:
# the repo's acceptance gate greps the tree for the retired app name, so no
# legacy-brand token may appear in this file (the README wire-dialect note is
# the only documented exception, and it is a protocol, not an install path).

# Enumerate stale installs: any app under /Applications whose bundle id matches
# ours but whose path is not the current install. Matching by bundle id (read
# from each candidate's Info.plist) finds every historical generation without
# naming any of them.
stale_installs() {
  while IFS= read -r cand; do
    [[ -n "$cand" && -d "$cand/Contents/Info.plist" ]] || continue
    cand_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$cand/Contents/Info.plist" 2>/dev/null || true)"
    if [[ -n "$cand_id" && "$cand_id" == "$BUNDLE_ID" && "$cand" != "$INSTALL_APP" ]]; then
      printf '%s\n' "$cand"
    fi
  done < <(find /Applications -maxdepth 1 -name '*.app' 2>/dev/null)
}

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
  exec ssh "$REMOTE_HOST" "cd '$REMOTE_DIR' && bash scripts/deploy_notes.sh"
fi

# ---------------- local mode: build + install + relaunch + verify ----------------
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: local deploy must run on macOS (pass an ssh host or set REMOTE_HOST to drive a Mac remotely)" >&2
  exit 1
fi

bash "$REPO_ROOT/scripts/build_notes.sh"
BUILT_APP="$REPO_ROOT/dist/$APP_NAME.app"
[[ -d "$BUILT_APP" ]] || { echo "ERROR: build did not produce $BUILT_APP" >&2; exit 1; }

# Quit any running copy — new or pre-rename executable, all share $BUNDLE_ID.
# Graceful AppleScript quit first, then escalate to pkill; tolerate not-running.
echo "==> Quitting running copies (bundle id $BUNDLE_ID)"
osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
# Force-quit lingering executables of stale bundles; their executable names are
# read from each stale bundle's Info.plist, never written out here.
while IFS= read -r cand; do
  [[ -n "$cand" ]] || continue
  exe="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$cand/Contents/Info.plist" 2>/dev/null || true)"
  [[ -n "$exe" ]] && { pkill -x "$exe" >/dev/null 2>&1 || true; }
done < <(stale_installs)
for _ in $(seq 1 10); do
  pgrep -x "$APP_NAME" >/dev/null 2>&1 || break
  sleep 1
done
pkill -x "$APP_NAME" >/dev/null 2>&1 || true
# Orphaned AI sidecars spawned by an installed copy (normally die with the app).
pkill -f "/Applications/.*/Contents/Resources/ai-sidecar/server\.mjs" >/dev/null 2>&1 || true
sleep 1

echo "==> Installing -> $INSTALL_APP"
rm -rf "$INSTALL_APP"
ditto "$BUILT_APP" "$INSTALL_APP"

# Remove any stale pre-rename install (same bundle id, older display name).
while IFS= read -r cand; do
  [[ -n "$cand" ]] || continue
  echo "==> Removing stale install: $cand"
  rm -rf "$cand"
done < <(stale_installs)

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
# No stale install may survive the deploy: any remaining bundle sharing our id
# is a pre-rename leftover and fails the verification.
STALE_REMAIN=""
while IFS= read -r cand; do
  [[ -n "$cand" ]] || continue
  STALE_REMAIN=1
done < <(stale_installs)
[[ -z "$STALE_REMAIN" ]] || { echo "ERROR: stale install sharing bundle id $BUNDLE_ID is still present" >&2; exit 1; }
[[ -f "$INSTALL_APP/Contents/Resources/AppIcon.icns" ]] || echo "WARNING: AppIcon.icns missing from installed bundle" >&2

echo "DEPLOYED: $INSTALL_APP"
echo "          bundle id=$INSTALLED_ID version=$INSTALLED_VER build=$INSTALLED_BUILD"
pgrep -fl "$INSTALL_APP/Contents/MacOS/$APP_NAME" | sed 's/^/          running: /'
