#!/usr/bin/env bash
set -euo pipefail

base_ref="${1:?base ref is required}"
mode="${2:-candidate}"

candidate_digest() {
  {
    git diff --binary --full-index --no-ext-diff "$base_ref" --
    while IFS= read -r -d '' candidate_path; do
      printf 'untracked\0%s\0' "$candidate_path"
      sha256sum -z -- "$candidate_path"
    done < <(git ls-files --others --exclude-standard -z | LC_ALL=C sort -z)
  } | sha256sum | awk '{print $1}'
}

case "$mode" in
  candidate)
    candidate_digest
    ;;
  tracked)
    git diff --binary --full-index --no-ext-diff "$base_ref" -- | sha256sum | awk '{print $1}'
    ;;
  untracked)
    git ls-files --others --exclude-standard -z | LC_ALL=C sort -z | sha256sum | awk '{print $1}'
    ;;
  *)
    printf 'unknown digest mode: %s\n' "$mode" >&2
    exit 2
    ;;
esac
