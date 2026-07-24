#!/usr/bin/env bash
set -euo pipefail
umask 077

repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
postgres_bin=/usr/lib/postgresql/16/bin
bun_bin=$(command -v bun || true)
openssl_bin=$(command -v openssl || true)

required=(initdb pg_ctl postgres psql)
for command_name in "${required[@]}"; do
  if [[ ! -x "$postgres_bin/$command_name" ]]; then
    echo "Postgres 16 prerequisite is missing: $postgres_bin/$command_name" >&2
    exit 1
  fi
done
if [[ -z "$bun_bin" || ! -x "$bun_bin" ]]; then
  echo "Bun is required for the live Postgres integration corpus" >&2
  exit 1
fi
if [[ -z "$openssl_bin" || ! -x "$openssl_bin" ]]; then
  echo "OpenSSL is required for the live Postgres TLS fixture" >&2
  exit 1
fi
if [[ $(id -u) -eq 0 ]]; then
  echo "The isolated Postgres fixture refuses to run as root" >&2
  exit 1
fi

fixture_root=$(mktemp -d /dev/shm/sandboxes-postgres-v1.XXXXXX)
data_dir=$fixture_root/data
socket_dir=$fixture_root/socket
cert_dir=$fixture_root/certs
runtime_home=$fixture_root/home
runtime_tmp=$fixture_root/tmp
server_log=$fixture_root/postgres.log
server_started=0

cleanup() {
  status=$?
  if [[ $server_started -eq 1 ]]; then
    "$postgres_bin/pg_ctl" -D "$data_dir" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  if [[ $status -ne 0 && -f "$server_log" ]]; then
    echo "Isolated Postgres fixture log (last 80 lines):" >&2
    tail -n 80 "$server_log" >&2 || true
  fi
  rm -rf -- "$fixture_root"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -m 700 "$socket_dir" "$cert_dir" "$runtime_home" "$runtime_tmp"

"$openssl_bin" req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 \
  -subj "/CN=sandboxes-v1-test-ca" \
  -keyout "$cert_dir/ca.key" \
  -out "$cert_dir/ca.crt" >/dev/null 2>&1
"$openssl_bin" req -new -newkey rsa:2048 -sha256 -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout "$cert_dir/server.key" \
  -out "$cert_dir/server.csr" >/dev/null 2>&1
"$openssl_bin" x509 -req -sha256 -days 1 \
  -in "$cert_dir/server.csr" \
  -CA "$cert_dir/ca.crt" \
  -CAkey "$cert_dir/ca.key" \
  -CAcreateserial \
  -copy_extensions copy \
  -out "$cert_dir/server.crt" >/dev/null 2>&1
chmod 600 "$cert_dir/ca.key" "$cert_dir/server.key"
chmod 644 "$cert_dir/ca.crt" "$cert_dir/server.crt"

LC_ALL=C "$postgres_bin/initdb" \
  -D "$data_dir" \
  -U sandboxes_bootstrap \
  --encoding=UTF8 \
  --no-locale \
  --auth-local=trust \
  --auth-host=reject >"$fixture_root/initdb.log" 2>&1

port=$("$bun_bin" -e \
  'const server = Bun.listen({hostname:"127.0.0.1", port:0, socket:{data(){}}}); console.log(server.port); server.stop(true);')
if [[ ! "$port" =~ ^[0-9]+$ || "$port" -lt 1024 || "$port" -gt 65535 ]]; then
  echo "Failed to reserve an isolated Postgres port" >&2
  exit 1
fi

{
  printf "listen_addresses = '127.0.0.1'\n"
  printf "port = %s\n" "$port"
  printf "unix_socket_directories = '%s'\n" "$socket_dir"
  printf "ssl = on\n"
  printf "ssl_cert_file = '%s'\n" "$cert_dir/server.crt"
  printf "ssl_key_file = '%s'\n" "$cert_dir/server.key"
  printf "ssl_ca_file = '%s'\n" "$cert_dir/ca.crt"
  printf "password_encryption = 'scram-sha-256'\n"
  printf "log_connections = on\n"
  printf "log_disconnections = on\n"
} >>"$data_dir/postgresql.conf"

{
  printf "local all sandboxes_bootstrap trust\n"
  printf "local all all reject\n"
  printf "hostssl sandboxes_v1_test sandboxes_migration 127.0.0.1/32 trust\n"
  printf "hostssl sandboxes_v1_test sandboxes_runtime 127.0.0.1/32 trust\n"
  printf "hostssl sandboxes_v1_test sandboxes_privileged_member 127.0.0.1/32 trust\n"
  printf "hostnossl all all 127.0.0.1/32 reject\n"
  printf "host all all 0.0.0.0/0 reject\n"
  printf "host all all ::0/0 reject\n"
} >"$data_dir/pg_hba.conf"

"$postgres_bin/pg_ctl" -D "$data_dir" -w -l "$server_log" start >/dev/null
server_started=1

"$postgres_bin/psql" \
  -X \
  -h "$socket_dir" \
  -p "$port" \
  -U sandboxes_bootstrap \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE sandboxes_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \
  -c "CREATE ROLE sandboxes_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \
  -c "CREATE ROLE sandboxes_privileged_member LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT" \
  -c "GRANT sandboxes_migration, sandboxes_runtime TO sandboxes_privileged_member" \
  -c "CREATE DATABASE sandboxes_v1_test OWNER sandboxes_migration" \
  -c "REVOKE ALL ON DATABASE sandboxes_v1_test FROM PUBLIC" \
  -c "GRANT CONNECT ON DATABASE sandboxes_v1_test TO sandboxes_migration, sandboxes_runtime" \
  >/dev/null

if PGSSLMODE=disable "$postgres_bin/psql" \
  -X \
  -h 127.0.0.1 \
  -p "$port" \
  -U sandboxes_runtime \
  -d sandboxes_v1_test \
  -c "SELECT 1" >/dev/null 2>&1; then
  echo "The isolated Postgres fixture unexpectedly accepted a plaintext connection" >&2
  exit 1
fi

cluster_system_identifier=$("$postgres_bin/psql" \
  -XAt \
  -h "$socket_dir" \
  -p "$port" \
  -U sandboxes_bootstrap \
  -d postgres \
  -c "SELECT system_identifier FROM pg_control_system()")
if [[ ! "$cluster_system_identifier" =~ ^[1-9][0-9]+$ ]]; then
  echo "The isolated Postgres fixture returned an invalid cluster system identifier" >&2
  exit 1
fi

migration_url="postgresql://sandboxes_migration@localhost:$port/sandboxes_v1_test?sslmode=verify-full"
runtime_url="postgresql://sandboxes_runtime@localhost:$port/sandboxes_v1_test?sslmode=verify-full"
privileged_member_url="postgresql://sandboxes_privileged_member@localhost:$port/sandboxes_v1_test?sslmode=verify-full"

cd "$runtime_home"
env -i \
  HOME="$runtime_home" \
  TMPDIR="$runtime_tmp" \
  PATH="$(dirname "$bun_bin"):/usr/bin:/bin" \
  LC_ALL=C \
  NODE_ENV=test \
  SANDBOXES_POSTGRES_MIGRATION_URL="$migration_url" \
  SANDBOXES_POSTGRES_RUNTIME_URL="$runtime_url" \
  SANDBOXES_POSTGRES_PRIVILEGED_MEMBER_URL="$privileged_member_url" \
  SANDBOXES_POSTGRES_CLUSTER_SYSTEM_IDENTIFIER="$cluster_system_identifier" \
  SANDBOXES_POSTGRES_DATABASE=sandboxes_v1_test \
  SANDBOXES_POSTGRES_MIGRATION_ROLE=sandboxes_migration \
  SANDBOXES_POSTGRES_RUNTIME_ROLE=sandboxes_runtime \
  SANDBOXES_POSTGRES_TLS_CA_FILE="$cert_dir/ca.crt" \
  "$bun_bin" test --timeout 120000 "$repo/tests/postgres-live.integration.ts"
