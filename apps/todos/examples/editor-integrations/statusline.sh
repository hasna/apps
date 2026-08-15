#!/usr/bin/env bash
set -euo pipefail

json="$(todos --json status)"
bun -e '
const status = JSON.parse(await Bun.stdin.text());
const pending = status.pending ?? 0;
const active = status.in_progress ?? 0;
const blocked = status.blocked ?? 0;
process.stdout.write(`todos p:${pending} i:${active} b:${blocked}`);
' <<< "$json"
