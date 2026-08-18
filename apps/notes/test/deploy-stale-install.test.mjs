// Regression test for the stale-install scan defect (todos 27c51f16, O15-00011):
// deploy_notes.sh stale_installs() guarded every candidate with `-d` on
// Contents/Info.plist — a FILE, not a directory — so every stale pre-rename
// install was skipped: no backup tar was created, no stale bundle was removed,
// and the post-deploy "no stale install remaining" check passed vacuously over
// the same empty scan. Measured on station03: -d returned 0 results, -f found
// the candidate.
//
// The scan and backup-remove logic lives in scripts/notes-deploy-lib.sh (sourced
// by deploy_notes.sh); PlistBuddy is macOS-only, so the driver overrides the
// lib's plist_key() with a portable reader and drives the real functions
// against a fixture Applications tree.
import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const LIB = join(repoRoot, 'scripts', 'notes-deploy-lib.sh');
const DEPLOY = join(repoRoot, 'scripts', 'deploy_notes.sh');
const BUNDLE_ID = 'com.hasna.notes';

const PLIST = (bundleId) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
</dict>
</plist>
`;

// The driver is generated into the fixture dir. It sources the lib, overrides
// plist_key (PlistBuddy is macOS-only), runs stale_installs() and
// backup_and_remove_stale(), and prints one machine-readable marker per
// assertion, exiting non-zero on the first failure.
const DRIVER = (lib, root, staleApp, currentApp, otherApp, installApp, backupHome, stamp) => `#!/usr/bin/env bash
set -euo pipefail

LIB="${lib}"
ROOT="${root}"
BUNDLE_ID="${BUNDLE_ID}"
STALE_APP="${staleApp}"
CURRENT_APP="${currentApp}"
OTHER_APP="${otherApp}"
INSTALL_APP="${installApp}"
BACKUP_HOME="${backupHome}"
STAMP="${stamp}"

export APPLICATIONS_ROOT="$ROOT"
export INSTALL_APP="$INSTALL_APP"
export BACKUP_HOME="$BACKUP_HOME"
export STAMP="$STAMP"

source "$LIB"

# Portable plist reader override: PlistBuddy exists only on macOS. Handles
# both layouts: <string> on the same line as <key>, or on the following line.
plist_key() {
  local plist="$1" key="$2"
  awk -v key="$key" 'BEGIN { needle = "<key>" key "</key>" }
    index($0, needle) {
      if (match($0, /<string>[^<]*<\\/string>/)) {
        s = substr($0, RSTART, RLENGTH)
        gsub(/<\\/?string>/, "", s)
        print s
        exit
      }
      if (getline > 0) { gsub(/<[^>]+>/, ""); gsub(/^[ \\t]+|[ \\t]+$/, ""); print; exit }
    }' "$plist"
}

scan_list() {
  local out=""
  while IFS= read -r cand; do out="\${out}\${cand}\n"; done < <(stale_installs)
  printf '%b' "$out"
}

# Case 1: stale bundle-id app present -> must be found, backed up (non-empty
# tar), removed; current install and unrelated app untouched.
out="$(scan_list)"
grep -Fqx "$STALE_APP" <<<"$out" || { echo "STALE_NOT_FOUND"; exit 1; }
echo "STALE_FOUND=1"
grep -Fqx "$CURRENT_APP" <<<"$out" && { echo "CURRENT_MATCHED"; exit 1; }
grep -Fqx "$OTHER_APP" <<<"$out" && { echo "OTHER_MATCHED"; exit 1; }
echo "SCAN_EXACT=1"

backup_and_remove_stale "$STALE_APP"

ARCHIVE="$BACKUP_HOME/legacy-backup-$STAMP.tar"
[[ -s "$ARCHIVE" ]] || { echo "ARCHIVE_EMPTY_OR_MISSING"; exit 1; }
echo "ARCHIVE_NONEMPTY=1"
[[ ! -e "$STALE_APP" ]] || { echo "STALE_NOT_REMOVED"; exit 1; }
echo "STALE_REMOVED=1"
[[ -d "$CURRENT_APP" ]] || { echo "CURRENT_REMOVED"; exit 1; }
[[ -d "$OTHER_APP" ]] || { echo "OTHER_REMOVED"; exit 1; }
echo "OTHERS_INTACT=1"

# Case 2 (negative control): after the stale bundle was removed above, the scan
# over the remaining tree (current install + unrelated app) must be empty.
out="$(scan_list)"
[[ -z "$out" ]] || { echo "SCAN_NOT_EMPTY_WITHOUT_STALE"; exit 1; }
echo "SCAN_EMPTY=1"
echo "ALL_PASS=1"
`;

function runDriver(dir, driverPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [driverPath], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('deploy stale-install scan and backup-remove', () => {
  test('deploy_notes.sh sources the lib and carries no -d guard on Contents/Info.plist', async () => {
    const deploy = await readFile(DEPLOY, 'utf8');
    // The deploy script must consume the lib (single implementation), not
    // duplicate the scan inline — a second inline copy was how the -d guard
    // survived the first fix attempt.
    expect(deploy).toContain('source "$REPO_ROOT/scripts/notes-deploy-lib.sh"');
    expect(deploy).toContain('stale_installs');
    expect(deploy).not.toContain('stale_installs() {');
    // The exact defect: -d on Contents/Info.plist (a FILE) skipped every
    // candidate. If the guard comes back in any form, this fails.
    expect(deploy).not.toContain('-d "$cand/Contents/Info.plist"');
    expect(deploy).not.toContain('-d \\"$cand/Contents/Info.plist\\"');
    // The lib's own guard must be the file test, not the directory test.
    const lib = await readFile(LIB, 'utf8');
    expect(lib).toContain('-f "$cand/Contents/Info.plist"');
    expect(lib).not.toContain('-d "$cand/Contents/Info.plist"');
  });

  test('stale bundle-id app is found, backed up non-empty, and removed; scan is empty without one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'notes-deploy-'));
    try {
      const root = join(dir, 'Applications');
      const staleApp = join(root, 'LegacyNotes.app');
      const currentApp = join(root, 'HasnaNotes.app');
      const otherApp = join(root, 'OtherApp.app');
      const installApp = currentApp;
      const backupHome = join(dir, 'Library', 'Application Support', 'HasnaNotes');
      const stamp = '20260818-000000';

      for (const [p, id] of [[staleApp, BUNDLE_ID], [currentApp, BUNDLE_ID], [otherApp, 'com.example.unrelated']]) {
        await mkdir(join(p, 'Contents'), { recursive: true });
        await writeFile(join(p, 'Contents', 'Info.plist'), PLIST(id));
      }

      const driverPath = join(dir, 'driver.sh');
      await writeFile(driverPath, DRIVER(LIB, root, staleApp, currentApp, otherApp, installApp, backupHome, stamp));

      const r = await runDriver(dir, driverPath);
      expect(r.stderr).toBe('');
      expect(r.code).toBe(0);
      for (const marker of ['STALE_FOUND=1', 'SCAN_EXACT=1', 'ARCHIVE_NONEMPTY=1', 'STALE_REMOVED=1', 'OTHERS_INTACT=1', 'SCAN_EMPTY=1', 'ALL_PASS=1']) {
        expect(r.stdout).toContain(marker);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
