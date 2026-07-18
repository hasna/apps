#!/usr/bin/env bash
set -euo pipefail

task_bun="${TODOS_INCIDENT_TEST_BUN_BIN:-bun}"
task_db_user="${TODOS_INCIDENT_TEST_DB_USER:-$(id -un)}"
task_db="todos_incident_ee2ecad7_${BASHPID}_${RANDOM}"
task_db_created=0
task_pg_host="127.0.0.1"
task_pg_port="5432"
task_pgpass_file=""

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
  local cleanup_status=0
  if [[ "$task_db_created" == "1" ]]; then
    if [[ ! "$task_db" =~ ^todos_incident_ee2ecad7_[0-9]+_[0-9]+$ ]]; then
      echo "refusing unsafe cleanup target" >&2
      cleanup_status=2
    else
      dropdb --host="$task_pg_host" --port="$task_pg_port" --username="$task_db_user" --if-exists "$task_db" ||
        cleanup_status=$?
      if [[ "$cleanup_status" == "0" ]]; then
        task_db_created=0
      fi
    fi
  fi
  if [[ -n "$task_pgpass_file" && -f "$task_pgpass_file" ]]; then
    rm -f -- "$task_pgpass_file" || cleanup_status=$?
    task_pgpass_file=""
  fi
  return "$cleanup_status"
}

finish_task_db_verification() {
  local main_status=$?
  local cleanup_status=0
  trap - EXIT
  cleanup_task_db || cleanup_status=$?
  if [[ "$main_status" != "0" ]]; then
    exit "$main_status"
  fi
  exit "$cleanup_status"
}
trap finish_task_db_verification EXIT

# Do not let ambient libpq state redirect any wrapper or Bun child connection.
# A task-owned empty password file prevents implicit fallback to ~/.pgpass.
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGTARGETSESSIONATTRS
task_pgpass_file="$(mktemp)"
chmod 600 "$task_pgpass_file"
export PGPASSFILE="$task_pgpass_file"

createdb --host="$task_pg_host" --port="$task_pg_port" --username="$task_db_user" "$task_db"
task_db_created=1
TODOS_INCIDENT_TEST_ALLOW_TEMP_DATABASE=1 \
TODOS_INCIDENT_TEST_DATABASE_URL="postgresql://${task_db_user}@127.0.0.1:5432/${task_db}" \
  "$task_bun" test src/incidents/postgres-store.integration.test.ts

residual_tables="$(psql --host="$task_pg_host" --port="$task_pg_port" --username="$task_db_user" --dbname="$task_db" -XAtqc \
  "select count(*) from pg_tables where schemaname = 'public' and tablename like 'todos_incident%'" \
)"
if [[ "$residual_tables" != "0" ]]; then
  echo "incident PostgreSQL rollback left ${residual_tables} task tables" >&2
  exit 1
fi
# Cleanup is part of the success contract. Disarm the emergency EXIT handler
# and run it explicitly so a failed owned drop or pgpass removal cannot be
# converted into a successful wrapper exit.
trap - EXIT
cleanup_task_db
echo "incident PostgreSQL verification passed; rollback residual tables=0"
