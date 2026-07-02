#!/usr/bin/env bash
set -euo pipefail

test -f Package.swift
test -f Sources/ClipCore/ClipCLI.swift
test -f Sources/ClipMenuBar/main.swift
test -f Sources/ClipSmoke/main.swift

grep -q 'ClipCommand(arguments: \["capture", "full", "--copy-link"\])' Sources/ClipCore/ClipCLI.swift
grep -q 'ClipCommand(arguments: \["clipboard", "--copy-link"\])' Sources/ClipCore/ClipCLI.swift
grep -q 'ClipCommand(arguments: \["open-recent"\])' Sources/ClipCore/ClipCLI.swift
grep -q 'Process()' Sources/ClipCore/ClipCLI.swift
grep -q 'HASNA_CLIP_CLI' Sources/ClipCore/ClipCLI.swift
grep -q 'NSStatusBar.system.statusItem' Sources/ClipMenuBar/main.swift

if grep -R 'import SQLite\|Database(' Sources; then
  echo "macOS app must delegate writes through the clip CLI, not open storage directly" >&2
  exit 1
fi

echo "macOS source check OK"
