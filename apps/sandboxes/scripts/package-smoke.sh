#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

cd "$repo_root"
bun run build
bun pm pack --destination "$temporary" --quiet >/dev/null
tarball="$(find "$temporary" -maxdepth 1 -type f -name '*.tgz' -print -quit)"
test -n "$tarball"
tar -tzf "$tarball" >"$temporary/package-files.txt"
for required in \
  package/dist/index.js \
  package/dist/index.d.ts \
  package/dist/repository-postgres.js \
  package/dist/repository-postgres.d.ts \
  package/dist/adapters/managed/index.js \
  package/dist/adapters/managed/index.d.ts \
  package/dist/adapters/managed/e2b-guest-broker-v1.py \
  package/schemas/dispatched-journal-anchor-v1.schema.json \
  package/schemas/provider-outcome-anchor-v1.schema.json \
  package/schemas/read-probe-anchor-v1.schema.json \
  package/schemas/effect-journal-recovery-range-v1.schema.json \
  package/schemas/provider-boundary-v1.schema.json
do
  grep -Fx "$required" "$temporary/package-files.txt" >/dev/null
done
if grep -E '/(tests|testing|scripts)/' "$temporary/package-files.txt" >/dev/null; then
  echo "packed artifact contains test-only or script files" >&2
  exit 1
fi
mkdir -p "$temporary/consumer"
cp tests/packed-consumer/package.json tests/packed-consumer/index.mjs "$temporary/consumer/"
cd "$temporary/consumer"
bun add --no-save "$tarball" >/dev/null
bun run index.mjs
