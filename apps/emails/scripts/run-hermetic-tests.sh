#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

mode="${1:-shared}"
case "$mode" in
  shared|isolated) ;;
  *)
    echo "usage: $0 [shared|isolated]" >&2
    exit 2
    ;;
esac

mapfile -d '' -t test_files < <(
  find . \
    \( -path './.git' -o -path './node_modules' -o -path './dist' \) -prune -o \
    -type f \( \
      -name '*.test.js' -o -name '*.test.jsx' -o -name '*.test.ts' -o -name '*.test.tsx' -o \
      -name '*_test.js' -o -name '*_test.jsx' -o -name '*_test.ts' -o -name '*_test.tsx' -o \
      -name '*.spec.js' -o -name '*.spec.jsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' -o \
      -name '*_spec.js' -o -name '*_spec.jsx' -o -name '*_spec.ts' -o -name '*_spec.tsx' \
    \) -print0 |
    sort -z
)

if (("${#test_files[@]}" == 0)); then
  echo "No test files discovered" >&2
  exit 1
fi

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT

printf 'Discovered %d test files\n' "${#test_files[@]}"

if [[ "$mode" == "isolated" ]]; then
  for test_file in "${test_files[@]}"; do
    printf '\n=== %s ===\n' "$test_file"
    bun scripts/prepublish-local-test.mjs --max-concurrency 1 "$test_file"
  done
  exit 0
fi

shared_output="$tmp_root/shared-output.log"
set +e
bun scripts/prepublish-local-test.mjs --max-concurrency 1 2>&1 | tee "$shared_output"
test_status="${PIPESTATUS[0]}"
set -e

if [[ "$test_status" -ne 0 ]]; then
  exit "$test_status"
fi

reported_files="$(
  sed -nE 's/^Ran [0-9]+ tests across ([0-9]+) files\..*$/\1/p' "$shared_output" |
    tail -n 1
)"
if [[ -z "$reported_files" ]]; then
  echo "Bun did not report the number of executed test files" >&2
  exit 1
fi
if [[ "$reported_files" -ne "${#test_files[@]}" ]]; then
  echo "Test discovery mismatch: repository=${#test_files[@]} bun=${reported_files}" >&2
  exit 1
fi
