#!/usr/bin/env bash
# Shared deploy logic for deploy_notes.sh, factored out so the stale-install
# scan and the backup-remove sequence are testable (regression test:
# test/deploy-stale-install.test.mjs, todos 27c51f16).
#
# Functions-only; no set flags and no top-level commands, so the lib is safe to
# source from the deploy script (set -euo pipefail) and from tests.
#
# Variables consumed (must be set by the caller, or defaulted here):
#   APPLICATIONS_ROOT  directory scanned for *.app bundles (default /Applications)
#   BUNDLE_ID          bundle id that identifies an install of this app
#   INSTALL_APP        path of the current install (never reported as stale)
#   BACKUP_HOME        directory backups are written under
#   STAMP              timestamp used in the backup archive name
#
# The repo's acceptance gate greps the tree for the retired app name, so no
# legacy-brand token may appear in this file.

APPLICATIONS_ROOT="${APPLICATIONS_ROOT:-/Applications}"

# Read one key out of a bundle's Info.plist. PlistBuddy is macOS-only; tests
# override this function with a portable reader.
plist_key() {
  local plist="$1" key="$2"
  /usr/libexec/PlistBuddy -c "Print :$key" "$plist" 2>/dev/null || true
}

# Enumerate stale installs: any app under APPLICATIONS_ROOT whose bundle id
# matches ours but whose path is not the current install. Matching by bundle id
# (read from each candidate's Info.plist) finds every historical generation
# without naming any of them.
stale_installs() {
  while IFS= read -r cand; do
    # -f: Contents/Info.plist is a FILE; -d here silently skipped every
    # candidate and made the whole stale-install pass vacuous (bug 27c51f16).
    [[ -n "$cand" && -f "$cand/Contents/Info.plist" ]] || continue
    cand_id="$(plist_key "$cand/Contents/Info.plist" CFBundleIdentifier)"
    if [[ -n "$cand_id" && "$cand_id" == "$BUNDLE_ID" && "$cand" != "$INSTALL_APP" ]]; then
      printf '%s\n' "$cand"
    fi
  done < <(find "$APPLICATIONS_ROOT" -maxdepth 1 -name '*.app' 2>/dev/null)
}

# Back up and remove one stale install. Reversible: the bundle is tarred under
# BACKUP_HOME first, and a bundle whose backup came out empty is never removed
# (returns 1; the caller's `set -e` aborts the deploy).
backup_and_remove_stale() {
  local cand="$1"
  mkdir -p "$BACKUP_HOME"
  local archive="$BACKUP_HOME/legacy-backup-$STAMP.tar"
  tar -C "$APPLICATIONS_ROOT" -rf "$archive" "$(basename "$cand")"
  if [[ -s "$archive" ]]; then
    rm -rf "$cand"
  else
    echo "ERROR: backup archive $archive is empty; refusing to remove $cand" >&2
    return 1
  fi
}
