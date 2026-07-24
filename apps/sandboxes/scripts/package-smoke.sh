#!/usr/bin/env bash
set -euo pipefail

repo_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
temporary=$(mktemp -d)
cleanup() { rm -rf -- "$temporary"; }
trap cleanup EXIT

cd "$repo_root"
bun run build
bun pm pack --destination "$temporary" --quiet >/dev/null
tarball=$(find "$temporary" -maxdepth 1 -type f -name '*.tgz' -print -quit)
test -n "$tarball"
tar -tzf "$tarball" >"$temporary/package-files.txt"

for required in \
  package/dist/index.js \
  package/dist/postgres.js \
  package/dist/types/index.d.ts \
  package/dist/types/postgres.d.ts \
  package/dist/adapters/managed/e2b-guest-broker-v1.py \
  package/migrations/disposable-task-journal/0001_disposable_task_journal.sql \
  package/migrations/disposable-task-journal/0002_disposable_task_intent_v2.sql \
  package/migrations/disposable-task-journal/0003_disposable_task_effect_transitions_v2.sql \
  package/migrations/durable-journal-witness/0001_durable_journal_witness.sql
do
  grep -Fx "$required" "$temporary/package-files.txt" >/dev/null
done

mkdir -m 700 "$temporary/consumer"
printf '%s\n' '{"private":true,"type":"module"}' >"$temporary/consumer/package.json"
cd "$temporary/consumer"
bun add --no-save "$tarball" >/dev/null
bun -e '
  import * as managed from "@hasna/sandboxes/managed";
  import * as postgres from "@hasna/sandboxes/postgres";
  if (typeof managed.prepareDisposableSandboxTaskIntentV2 !== "function") throw new Error("managed V2 export missing");
  if (typeof postgres.PostgresDisposableTaskJournalV1 !== "function") throw new Error("journal export missing");
  if (typeof postgres.PostgresDurableJournalWitnessV1 !== "function") throw new Error("witness export missing");
  for (const loader of [
    postgres.loadPostgresDisposableTaskJournalMigrationSourceV1,
    postgres.loadPostgresDisposableTaskJournalMigrationSourceV2,
    postgres.loadPostgresDisposableTaskJournalEffectTransitionsMigrationSourceV2,
    postgres.loadPostgresDurableJournalWitnessMigrationSourceV1,
  ]) {
    if (typeof loader !== "function" || loader().length === 0) throw new Error("checked migration missing");
  }
'
