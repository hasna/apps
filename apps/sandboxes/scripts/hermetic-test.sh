#!/bin/sh
set -eu

if ! command -v bwrap >/dev/null 2>&1; then
  echo "bubblewrap is required for hermetic tests" >&2
  exit 1
fi

repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
bun_bin=$(command -v bun)

exec bwrap \
  --unshare-net \
  --die-with-parent \
  --clearenv \
  --setenv HOME /nonexistent \
  --setenv PATH /runtime \
  --setenv TMPDIR /tmp \
  --ro-bind /usr /usr \
  --symlink usr/lib /lib \
  --dir /runtime \
  --ro-bind "$bun_bin" /runtime/bun \
  --ro-bind "$repo" /workspace \
  --proc /proc \
  --dev /dev \
  --tmpfs /tmp \
  --dir /nonexistent \
  --chdir /workspace \
  /usr/bin/sh /workspace/scripts/hermetic-entry.sh
