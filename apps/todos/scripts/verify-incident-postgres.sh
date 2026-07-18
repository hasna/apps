#!/usr/bin/env bash
set -euo pipefail

task_bun="${TODOS_INCIDENT_TEST_BUN_BIN:-bun}"
task_db_user="${TODOS_INCIDENT_TEST_DB_USER:-$(id -un)}"
task_db="todos_incident_ee2ecad7_${BASHPID}_${RANDOM}"

case "$task_db_user" in
  ''|*[!A-Za-z0-9_.-]*)
    echo "refusing unsafe PostgreSQL user name" >&2
    exit 2
    ;;
esac
if [[ ! "$task_db" =~ ^todos_incident_ee2ecad7_[0-9]+_[0-9]+$ ]]; then
  echo "refusing unsafe temporary database name" >&2
  exit 2
fi

cleanup_task_db() {
  if [[ ! "$task_db" =~ ^todos_incident_ee2ecad7_[0-9]+_[0-9]+$ ]]; then
    echo "refusing unsafe cleanup target" >&2
    return 2
  fi
  dropdb --if-exists "$task_db"
}
trap cleanup_task_db EXIT

createdb "$task_db"
TODOS_INCIDENT_TEST_ALLOW_TEMP_DATABASE=1 \
TODOS_INCIDENT_TEST_DATABASE_URL="postgresql://${task_db_user}@127.0.0.1:5432/${task_db}" \
  "$task_bun" test src/incidents/postgres-store.integration.test.ts

residual_tables="$(psql -XAtqc \
  "select count(*) from pg_tables where schemaname = 'public' and tablename like 'todos_incident%'" \
  "$task_db")"
if [[ "$residual_tables" != "0" ]]; then
  echo "incident PostgreSQL rollback left ${residual_tables} task tables" >&2
  exit 1
fi
echo "incident PostgreSQL verification passed; rollback residual tables=0"
