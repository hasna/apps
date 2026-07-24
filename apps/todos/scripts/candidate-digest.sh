#!/usr/bin/env bash
set -euo pipefail

base_ref="${1:?base ref is required}"
mode="${2:-candidate}"
bun_bin="${BUN_EXECUTABLE:-bun}"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)

if [[ "$("$bun_bin" --version)" != "1.3.14" ]]; then
  printf 'candidate identity requires Bun 1.3.14\n' >&2
  exit 2
fi

exec "$bun_bin" "$script_dir/stage-a-candidate-identity.ts" "$base_ref" "$mode"
