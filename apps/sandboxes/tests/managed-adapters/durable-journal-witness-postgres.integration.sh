#!/usr/bin/env bash
set -euo pipefail
umask 077

repo=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
postgres_bin=/usr/lib/postgresql/16/bin
bun_bin=$(command -v bun || true)
openssl_bin=$(command -v openssl || true)

for executable in initdb pg_ctl psql; do
  if [[ ! -x "$postgres_bin/$executable" ]]; then
    echo "Postgres 16 prerequisite is missing: $postgres_bin/$executable" >&2
    exit 1
  fi
done
if [[ -z "$bun_bin" || ! -x "$bun_bin" || -z "$openssl_bin" || ! -x "$openssl_bin" ]]; then
  echo "Bun and OpenSSL are required for the durable witness integration corpus" >&2
  exit 1
fi
if [[ $(id -u) -eq 0 ]]; then
  echo "The isolated durable witness fixture refuses to run as root" >&2
  exit 1
fi

fixture_root=$(mktemp -d /dev/shm/sandboxes-durable-witness.XXXXXX)
journal_data=$fixture_root/journal-data
witness_data=$fixture_root/witness-data
journal_socket=$fixture_root/journal-socket
witness_socket=$fixture_root/witness-socket
cert_dir=$fixture_root/certs
runtime_home=$fixture_root/home
runtime_tmp=$fixture_root/tmp
journal_log=$fixture_root/journal.log
witness_log=$fixture_root/witness.log
journal_started=0
witness_started=0

cleanup() {
  status=$?
  if [[ $witness_started -eq 1 ]]; then
    "$postgres_bin/pg_ctl" -D "$witness_data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  if [[ $journal_started -eq 1 ]]; then
    "$postgres_bin/pg_ctl" -D "$journal_data" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  if [[ $status -ne 0 ]]; then
    [[ -f "$journal_log" ]] && tail -n 80 "$journal_log" >&2 || true
    [[ -f "$witness_log" ]] && tail -n 80 "$witness_log" >&2 || true
  fi
  rm -rf -- "$fixture_root"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -m 700 "$journal_socket" "$witness_socket" "$cert_dir" "$runtime_home" "$runtime_tmp"

"$openssl_bin" req -x509 -newkey rsa:2048 -sha256 -nodes -days 1 \
  -subj "/CN=sandboxes-durable-witness-test-ca" \
  -keyout "$cert_dir/ca.key" -out "$cert_dir/ca.crt" >/dev/null 2>&1
"$openssl_bin" req -new -newkey rsa:2048 -sha256 -nodes \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout "$cert_dir/server.key" -out "$cert_dir/server.csr" >/dev/null 2>&1
"$openssl_bin" x509 -req -sha256 -days 1 -in "$cert_dir/server.csr" \
  -CA "$cert_dir/ca.crt" -CAkey "$cert_dir/ca.key" -CAcreateserial \
  -copy_extensions copy -out "$cert_dir/server.crt" >/dev/null 2>&1
chmod 600 "$cert_dir/ca.key" "$cert_dir/server.key"
chmod 644 "$cert_dir/ca.crt" "$cert_dir/server.crt"

LC_ALL=C "$postgres_bin/initdb" -D "$journal_data" -U witness_bootstrap \
  --encoding=UTF8 --no-locale --auth-local=trust --auth-host=reject \
  >"$fixture_root/journal-initdb.log" 2>&1
LC_ALL=C "$postgres_bin/initdb" -D "$witness_data" -U witness_bootstrap \
  --encoding=UTF8 --no-locale --auth-local=trust --auth-host=reject \
  >"$fixture_root/witness-initdb.log" 2>&1

reserve_port() {
  "$bun_bin" -e 'const server = Bun.listen({hostname:"127.0.0.1",port:0,socket:{data(){}}}); console.log(server.port); server.stop(true)'
}
journal_port=$(reserve_port)
witness_port=$(reserve_port)
while [[ "$witness_port" == "$journal_port" ]]; do witness_port=$(reserve_port); done

for tuple in \
  "$journal_data|$journal_socket|$journal_port" \
  "$witness_data|$witness_socket|$witness_port"; do
  IFS='|' read -r data socket port <<<"$tuple"
  {
    printf "listen_addresses = '127.0.0.1'\n"
    printf "port = %s\n" "$port"
    printf "unix_socket_directories = '%s'\n" "$socket"
    printf "ssl = on\n"
    printf "ssl_cert_file = '%s'\n" "$cert_dir/server.crt"
    printf "ssl_key_file = '%s'\n" "$cert_dir/server.key"
    printf "ssl_ca_file = '%s'\n" "$cert_dir/ca.crt"
  } >>"$data/postgresql.conf"
done

{
  printf "local all witness_bootstrap trust\n"
  printf "hostssl journal_v1_test journal_migration 127.0.0.1/32 trust\n"
  printf "hostssl journal_v1_test journal_runtime 127.0.0.1/32 trust\n"
  printf "hostssl journal_v1_test journal_witness_ack 127.0.0.1/32 trust\n"
  printf "hostnossl all all 127.0.0.1/32 reject\n"
  printf "local all all reject\n"
  printf "host all all 0.0.0.0/0 reject\n"
  printf "host all all ::0/0 reject\n"
} >"$journal_data/pg_hba.conf"

{
  printf "local all witness_bootstrap trust\n"
  printf "local all all reject\n"
  printf "hostssl witness_v1_test witness_migration 127.0.0.1/32 trust\n"
  printf "hostssl witness_v1_test witness_reader 127.0.0.1/32 trust\n"
  printf "hostssl witness_v1_test witness_ack 127.0.0.1/32 trust\n"
  printf "hostssl witness_v1_test witness_privileged_member 127.0.0.1/32 trust\n"
  printf "hostnossl all all 127.0.0.1/32 reject\n"
  printf "host all all 0.0.0.0/0 reject\n"
  printf "host all all ::0/0 reject\n"
} >"$witness_data/pg_hba.conf"

"$postgres_bin/pg_ctl" -D "$journal_data" -w -l "$journal_log" start >/dev/null
journal_started=1
"$postgres_bin/pg_ctl" -D "$witness_data" -w -l "$witness_log" start >/dev/null
witness_started=1

"$postgres_bin/psql" -X -h "$journal_socket" -p "$journal_port" \
  -U witness_bootstrap -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE journal_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \
  -c "CREATE ROLE journal_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \
  -c "CREATE ROLE journal_witness_ack LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \
  -c "CREATE DATABASE journal_v1_test OWNER journal_migration" \
  -c "REVOKE ALL ON DATABASE journal_v1_test FROM PUBLIC" \
  -c "GRANT CONNECT ON DATABASE journal_v1_test TO journal_migration, journal_runtime, journal_witness_ack" \
  >/dev/null

"$postgres_bin/psql" -X -h "$witness_socket" -p "$witness_port" \
  -U witness_bootstrap -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE witness_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \
  -c "CREATE ROLE witness_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \
  -c "CREATE ROLE witness_ack LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \
  -c "CREATE ROLE witness_reader_delegate NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \
  -c "CREATE ROLE witness_ack_delegate NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \
  -c "CREATE ROLE witness_unrelated_database_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" \
  -c "CREATE ROLE witness_privileged_member LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT" \
  -c "GRANT witness_migration, witness_reader, witness_ack TO witness_privileged_member" \
  -c "CREATE DATABASE witness_v1_test OWNER witness_migration" \
  -c "REVOKE ALL ON DATABASE witness_v1_test FROM PUBLIC" \
  -c "GRANT CONNECT ON DATABASE witness_v1_test TO witness_migration, witness_reader, witness_ack" \
  >/dev/null

journal_cluster=$("$postgres_bin/psql" -XAt -h "$journal_socket" -p "$journal_port" \
  -U witness_bootstrap -d postgres -c "SELECT system_identifier FROM pg_control_system()")
witness_cluster=$("$postgres_bin/psql" -XAt -h "$witness_socket" -p "$witness_port" \
  -U witness_bootstrap -d postgres -c "SELECT system_identifier FROM pg_control_system()")
if [[ ! "$journal_cluster" =~ ^[1-9][0-9]+$ || ! "$witness_cluster" =~ ^[1-9][0-9]+$ || \
      "$journal_cluster" == "$witness_cluster" ]]; then
  echo "The fixture failed to create distinct PostgreSQL clusters" >&2
  exit 1
fi

migration_url="postgresql://witness_migration@localhost:$witness_port/witness_v1_test?sslmode=verify-full"
reader_url="postgresql://witness_reader@localhost:$witness_port/witness_v1_test?sslmode=verify-full"
ack_url="postgresql://witness_ack@localhost:$witness_port/witness_v1_test?sslmode=verify-full"
privileged_member_url="postgresql://witness_privileged_member@localhost:$witness_port/witness_v1_test?sslmode=verify-full"
main_migration_url="postgresql://journal_migration@localhost:$journal_port/journal_v1_test?sslmode=verify-full"
main_runtime_url="postgresql://journal_runtime@localhost:$journal_port/journal_v1_test?sslmode=verify-full"
main_ack_url="postgresql://journal_witness_ack@localhost:$journal_port/journal_v1_test?sslmode=verify-full"

cd "$runtime_home"
env -i \
  HOME="$runtime_home" TMPDIR="$runtime_tmp" PATH="$(dirname "$bun_bin"):/usr/bin:/bin" \
  LC_ALL=C NODE_ENV=test \
  SANDBOXES_WITNESS_MIGRATION_URL="$migration_url" \
  SANDBOXES_WITNESS_READER_URL="$reader_url" \
  SANDBOXES_WITNESS_ACK_URL="$ack_url" \
  SANDBOXES_WITNESS_PRIVILEGED_MEMBER_URL="$privileged_member_url" \
  SANDBOXES_WITNESS_DATABASE=witness_v1_test \
  SANDBOXES_WITNESS_MIGRATION_ROLE=witness_migration \
  SANDBOXES_WITNESS_READER_ROLE=witness_reader \
  SANDBOXES_WITNESS_ACK_ROLE=witness_ack \
  SANDBOXES_WITNESS_READER_DELEGATE_ROLE=witness_reader_delegate \
  SANDBOXES_WITNESS_ACK_DELEGATE_ROLE=witness_ack_delegate \
  SANDBOXES_WITNESS_UNRELATED_DATABASE_ROLE=witness_unrelated_database_role \
  SANDBOXES_WITNESS_TLS_CA_FILE="$cert_dir/ca.crt" \
  SANDBOXES_JOURNAL_CLUSTER_SYSTEM_IDENTIFIER="$journal_cluster" \
  SANDBOXES_WITNESS_CLUSTER_SYSTEM_IDENTIFIER="$witness_cluster" \
  SANDBOXES_MAIN_MIGRATION_URL="$main_migration_url" \
  SANDBOXES_MAIN_RUNTIME_URL="$main_runtime_url" \
  SANDBOXES_MAIN_ACK_URL="$main_ack_url" \
  SANDBOXES_MAIN_DATABASE=journal_v1_test \
  SANDBOXES_MAIN_MIGRATION_ROLE=journal_migration \
  SANDBOXES_MAIN_RUNTIME_ROLE=journal_runtime \
  SANDBOXES_MAIN_ACK_ROLE=journal_witness_ack \
  "$bun_bin" test --timeout 120000 \
    "$repo/tests/managed-adapters/durable-journal-witness-postgres.integration.test.ts"
