#!/usr/bin/env bash
set -euo pipefail

task_bun="${TODOS_INCIDENT_PUBLISHER_TEST_BUN_BIN:-bun}"
task_db_user="${TODOS_INCIDENT_PUBLISHER_TEST_DB_USER:-$(id -un)}"
task_db="todos_incident_e00050_${BASHPID}_${RANDOM}"
task_db_created=0
task_pg_host="127.0.0.1"
task_pg_port="5432"
task_pgpass_file=""
task_conversations_dir="${TODOS_INCIDENT_CONVERSATIONS_CONTRACT_DIR:-/home/hasna/.hasna/repos/worktrees/station01/open-conversations/incident-projection-timestamp-precision}"
task_conversations_head="1603d7cae7274b5bedb33b2d4321683a13a25a07"
task_fixture_hash="63cb9fafe606006003d033fbd2060d35ca10b6a520afa6a960a8e639c2be48ef"

case "$task_db_user" in
  ''|*[!A-Za-z0-9_.-]*)
    echo "refusing unsafe PostgreSQL user name" >&2
    exit 2
    ;;
esac
if [[ ! "$task_db" =~ ^todos_incident_e00050_[0-9]+_[0-9]+$ ]]; then
  echo "refusing unsafe temporary database name" >&2
  exit 2
fi
if [[ ! -d "$task_conversations_dir/.git" && ! -f "$task_conversations_dir/.git" ]]; then
  echo "missing pinned Conversations contract worktree" >&2
  exit 2
fi
if [[ "$(git -C "$task_conversations_dir" rev-parse HEAD)" != "$task_conversations_head" ]]; then
  echo "Conversations contract worktree is not at the pinned head" >&2
  exit 2
fi
if [[ -n "$(git -C "$task_conversations_dir" status --porcelain)" ]]; then
  echo "Conversations contract worktree is not clean" >&2
  exit 2
fi
if [[ "$(sha256sum fixtures/todos-incident-projection-v1.json | awk '{print $1}')" != "$task_fixture_hash" ]]; then
  echo "Todos shared incident fixture hash drifted" >&2
  exit 2
fi
if [[ "$(sha256sum "$task_conversations_dir/fixtures/todos-incident-projection-v1.json" | awk '{print $1}')" != "$task_fixture_hash" ]]; then
  echo "Conversations shared incident fixture hash drifted" >&2
  exit 2
fi

cleanup_task_db() {
  local cleanup_status=0
  if [[ "$task_db_created" == "1" ]]; then
    if [[ ! "$task_db" =~ ^todos_incident_e00050_[0-9]+_[0-9]+$ ]]; then
      echo "refusing unsafe cleanup target" >&2
      cleanup_status=2
    else
      dropdb --host="$task_pg_host" --port="$task_pg_port" --username="$task_db_user" --if-exists --force "$task_db" ||
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

unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGTARGETSESSIONATTRS
unset BASH_ENV ENV BUN_OPTIONS NODE_OPTIONS DOTENV_CONFIG_PATH
# The gate imports both applications. Keep future lazy-import or routing drift
# from observing any ambient live database, HTTP authority, or auth material.
# Only the explicit task-owned loopback database variables below are restored.
unset \
  DATABASE_URL \
  APP_API_URL APP_API_KEY \
  HASNA_TODOS_DATABASE_URL HASNA_TODOS_DATABASE_URL_OWNER \
  TODOS_DATABASE_URL TODOS_DATABASE_URL_OWNER \
  HASNA_TODOS_API_URL HASNA_TODOS_API_KEY \
  TODOS_API_URL TODOS_API_KEY TODOS_API TODOS_URL TODOS_V1_BASE_URL TODOS_V1_TOKEN \
  HASNA_TODOS_API_SIGNING_KEY TODOS_API_SIGNING_KEY HASNA_TODOS_SIGNING_KEY TODOS_SIGNING_KEY \
  HASNA_TODOS_STORAGE_MODE HASNA_TODOS_MODE TODOS_STORAGE_MODE TODOS_MODE \
  HASNA_TODOS_DB_PATH TODOS_DB_PATH \
  HASNA_CONVERSATIONS_DATABASE_URL HASNA_CONVERSATIONS_DATABASE_URL_OWNER \
  CONVERSATIONS_DATABASE_URL CONVERSATIONS_DATABASE_URL_OWNER \
  HASNA_CONVERSATIONS_API_URL HASNA_CONVERSATIONS_API_KEY \
  CONVERSATIONS_API_URL CONVERSATIONS_API_KEY \
  HASNA_CONVERSATIONS_API_SIGNING_KEY CONVERSATIONS_API_SIGNING_KEY \
  HASNA_CONVERSATIONS_STORAGE_MODE HASNA_CONVERSATIONS_MODE \
  CONVERSATIONS_STORAGE_MODE CONVERSATIONS_MODE \
  HASNA_CONVERSATIONS_DB_PATH CONVERSATIONS_DB_PATH \
  HASNA_API_SIGNING_KEY API_KEY_SIGNING_SECRET
task_pgpass_file="$(mktemp)"
chmod 600 "$task_pgpass_file"
export PGPASSFILE="$task_pgpass_file"

createdb --host="$task_pg_host" --port="$task_pg_port" --username="$task_db_user" "$task_db"
task_db_created=1
# Make every subsequently opened application connection prove the timestamp
# contract under a non-UTC PostgreSQL session. The database name is generated
# above and constrained to the task-owned identifier pattern before use.
psql --host="$task_pg_host" --port="$task_pg_port" --username="$task_db_user" --dbname="$task_db" \
  -Xv ON_ERROR_STOP=1 -c "ALTER DATABASE \"${task_db}\" SET timezone TO 'Europe/Bucharest'" >/dev/null
TODOS_INCIDENT_PUBLISHER_TEST_ALLOW_TEMP_DATABASE=1 \
TODOS_INCIDENT_PUBLISHER_TEST_DATABASE_URL="postgresql://${task_db_user}@127.0.0.1:5432/${task_db}" \
TODOS_INCIDENT_CONVERSATIONS_CONTRACT_DIR="$task_conversations_dir" \
  "$task_bun" --no-env-file test src/incidents/outbox-publisher.integration.test.ts

trap - EXIT
cleanup_task_db
residual_databases="$(psql --host="$task_pg_host" --port="$task_pg_port" --username="$task_db_user" --dbname=postgres -XAtqc \
  "select count(*) from pg_database where datname = '${task_db}'")"
if [[ "$residual_databases" != "0" ]]; then
  echo "incident publisher PostgreSQL cleanup left ${residual_databases} task databases" >&2
  exit 1
fi
echo "incident publisher dual-HTTP PostgreSQL verification passed; residual databases=0"
