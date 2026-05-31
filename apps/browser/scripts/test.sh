#!/usr/bin/env bash
set -euo pipefail

chunks=(
  "src/engines/selector.test.ts src/engines/tui.test.ts src/engines/bun-webview.test.ts"
  "src/mcp/v4.test.ts src/mcp/gallery.test.ts src/mcp/index.test.ts src/mcp/http.test.ts src/mcp/meta-regression.test.ts"
  "src/server/index.test.ts src/cli/index.test.ts"
  "src/db/agents.test.ts src/db/gallery.test.ts src/db/projects.test.ts src/db/recordings.test.ts src/db/schema.test.ts src/db/sessions.test.ts"
  "src/lib/actions.test.ts src/lib/actions-ref.test.ts src/lib/extractor.test.ts src/lib/snapshot.test.ts src/lib/screenshot.test.ts src/lib/screenshot-v4.test.ts src/lib/annotate.test.ts"
  "src/lib/qol.test.ts src/lib/recorder.test.ts src/lib/session-v3.test.ts src/lib/network.test.ts"
  "src/lib/agents.test.ts src/lib/downloads.test.ts src/lib/integrations.test.ts src/lib/snapshot-diff.test.ts src/lib/stealth.test.ts"
)

for chunk in "${chunks[@]}"; do
  # shellcheck disable=SC2086
  bun test $chunk
done
