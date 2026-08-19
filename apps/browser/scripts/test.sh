#!/usr/bin/env bash
set -euo pipefail

chunks=(
  "src/engines/selector.test.ts src/engines/kernel.test.ts src/engines/tui.test.ts src/engines/bun-webview.test.ts src/engines/extension.test.ts src/engines/extension.e2e.test.ts"
  "src/mcp/v4.test.ts src/mcp/gallery.test.ts src/mcp/compact.test.ts src/mcp/index.test.ts src/mcp/http.test.ts src/mcp/meta-regression.test.ts"
  "src/server/index.test.ts src/cli/index.test.ts src/sdk.test.ts src/docs-policy.test.ts"
  "src/db/storage-sync.test.ts src/cli/storage.test.ts src/server/security.test.ts"
  "src/db/agents.test.ts src/db/gallery.test.ts src/db/projects.test.ts src/db/recordings.test.ts src/db/schema.test.ts src/db/sessions.test.ts src/db/video-recordings.test.ts"
  "src/lib/actions.test.ts src/lib/actions-ref.test.ts src/lib/extractor.test.ts src/lib/snapshot.test.ts src/lib/screenshot.test.ts src/lib/screenshot-v4.test.ts src/lib/annotate.test.ts"
  "src/lib/qol.test.ts src/lib/recorder.test.ts src/lib/session-v3.test.ts src/lib/network.test.ts src/lib/semantic-actions.test.ts src/lib/security.test.ts src/lib/video-presets.test.ts src/lib/video-recording.test.ts src/lib/workflow-manifests.test.ts"
  "src/lib/agents.test.ts src/lib/downloads.test.ts src/lib/integrations.test.ts src/lib/snapshot-diff.test.ts src/lib/stealth.test.ts src/lib/policy.test.ts src/lib/session-policy.test.ts src/lib/extension-bridge.test.ts extension/src/executor.test.ts src/lib/coordination.test.ts"
  "src/lib/sanitize.test.ts src/lib/ref-cache.test.ts src/lib/ref-cache-l2.test.ts src/lib/tabs.test.ts src/lib/self-heal.test.ts src/lib/auth-flow.test.ts src/lib/datasets.test.ts src/lib/vision-fallback.test.ts"
  "src/db/timeline.test.ts src/db/console-log.test.ts src/db/heartbeats.test.ts src/db/crawl-results.test.ts"
  "test/publish-guard.test.ts test/registry-versions.test.ts"
)

listed_tests=()
for chunk in "${chunks[@]}"; do
  # shellcheck disable=SC2206
  files=($chunk)
  listed_tests+=("${files[@]}")
done

missing="$(
  comm -23 \
    <(find src extension -name '*.test.ts' -o -name '*.test.tsx' | sort) \
    <(printf '%s\n' "${listed_tests[@]}" | sort -u)
)"

if [[ -n "$missing" ]]; then
  printf 'scripts/test.sh is missing test files:\n%s\n' "$missing" >&2
  exit 1
fi

for chunk in "${chunks[@]}"; do
  # shellcheck disable=SC2086
  bun test --max-concurrency=1 $chunk
done
