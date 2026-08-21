#!/usr/bin/env bash
# Regression check for I38-00554 — the machines docker image must build.
#
# Background: the deps half of the build stage runs `bun install`, whose
# lifecycle scripts include `prepare` ("bun run build"). At that point only
# package.json + bun.lock exist in the stage, so the prepare build fails on
# the missing src/. The install line therefore skips lifecycle scripts
# (--ignore-scripts) and the build runs explicitly afterwards, where src/
# exists. This check runs the real docker build to prove the whole thing.
#
# Usage: bash scripts/docker-build-check.sh   (also wired as `bun run docker:check`)
set -euo pipefail

cd "$(dirname "$0")/.."

docker build --platform=linux/arm64 --target runtime -t hasna/machines:docker-check .

echo "docker build OK (target runtime)"
