#!/usr/bin/env bash
set -euo pipefail
umask 077

repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary=$(mktemp /dev/shm/sandboxes-disposable-postgres-runner.XXXXXX)
cleanup() { rm -f -- "$temporary"; }
trap cleanup EXIT

sed \
  -e "s|^repo=.*$|repo='$repo'|" \
  -e '/printf "hostssl sandboxes_v1_test sandboxes_runtime/a\  printf "hostssl sandboxes_v1_test sandboxes_witness_ack 127.0.0.1/32 trust\\n"' \
  -e '/CREATE ROLE sandboxes_runtime/a\  -c "CREATE ROLE sandboxes_witness_ack LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \\\n  -c "CREATE ROLE sandboxes_runtime_delegate NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \\\n  -c "CREATE ROLE sandboxes_witness_ack_delegate NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \\\n  -c "CREATE ROLE sandboxes_unrelated_database_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \\' \
  -e '/GRANT sandboxes_migration, sandboxes_runtime TO sandboxes_privileged_member/c\  -c "GRANT sandboxes_migration, sandboxes_runtime, sandboxes_witness_ack TO sandboxes_privileged_member" \\' \
  -e 's|sandboxes_migration, sandboxes_runtime"|sandboxes_migration, sandboxes_runtime, sandboxes_witness_ack"|' \
  -e '/^runtime_url=/a\witness_ack_url="postgresql://sandboxes_witness_ack@localhost:$port/sandboxes_v1_test?sslmode=verify-full"' \
  -e '/SANDBOXES_POSTGRES_RUNTIME_URL=/a\  SANDBOXES_POSTGRES_WITNESS_ACK_URL="$witness_ack_url" \\' \
  -e '/SANDBOXES_POSTGRES_RUNTIME_ROLE=/a\  SANDBOXES_POSTGRES_WITNESS_ACK_ROLE=sandboxes_witness_ack \\\n  SANDBOXES_POSTGRES_RUNTIME_DELEGATE_ROLE=sandboxes_runtime_delegate \\\n  SANDBOXES_POSTGRES_WITNESS_ACK_DELEGATE_ROLE=sandboxes_witness_ack_delegate \\\n  SANDBOXES_POSTGRES_UNRELATED_DATABASE_ROLE=sandboxes_unrelated_database_role \\' \
  -e 's|"$repo/tests/postgres-live.integration.ts"|"$repo/tests/managed-adapters/disposable-task-postgres.integration.test.ts"|' \
  "$repo/scripts/postgres-integration.sh" >"$temporary"
chmod 700 "$temporary"
"$temporary"
