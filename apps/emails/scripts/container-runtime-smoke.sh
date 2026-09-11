#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

revision="$(git rev-parse HEAD)"
version="$(jq -er '.version' package.json)"
upstream_image="${BUN_UPSTREAM_IMAGE:-oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0}"
patched_base_image="${CONTAINER_RUNTIME_PATCHED_BASE_IMAGE:-hasna-emails-patched-bun-base:${revision:0:12}}"
image="${CONTAINER_RUNTIME_IMAGE:-hasna-emails-runtime-contract:${revision:0:12}}"
container="hasna-emails-runtime-contract-${revision:0:12}-$$"
network="${container}-network"
postgres_container="${container}-postgres"
# Existing package fixture pin; isolated network, no published ports or provider access.
postgres_image="postgres:16.4-alpine3.20@sha256:5660c2cbfea50c7a9127d17dc4e48543eedd3d7a41a595a2dfa572471e37e64c"
fixture_database_url="postgresql://emails_smoke@${postgres_container}:5432/emails_smoke?sslmode=disable"


if test "${CONTAINER_RUNTIME_PLATFORM+x}" = "x"; then
  case "$CONTAINER_RUNTIME_PLATFORM" in
    linux/arm64 | linux/amd64)
      platform="$CONTAINER_RUNTIME_PLATFORM"
      ;;
    *)
      printf 'unsupported CONTAINER_RUNTIME_PLATFORM: %s (expected linux/arm64 or linux/amd64)\n' \
        "$CONTAINER_RUNTIME_PLATFORM" >&2
      exit 1
      ;;
  esac
else
  docker_server_arch="$(docker info --format '{{.Architecture}}')"
  case "$docker_server_arch" in
    aarch64 | arm64)
      platform="linux/arm64"
      ;;
    x86_64 | amd64)
      platform="linux/amd64"
      ;;
    *)
      printf 'unsupported Docker server architecture: %s\n' "$docker_server_arch" >&2
      exit 1
      ;;
  esac
fi

case "$platform" in
  linux/arm64)
    expected_bun_arch="arm64"
    ;;
  linux/amd64)
    expected_bun_arch="x64"
    ;;
  *)
    printf 'unsupported resolved container platform: %s\n' "$platform" >&2
    exit 1
    ;;
esac

cleanup() {
  docker rm -f "$container" "$postgres_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  if test "${CONTAINER_RUNTIME_KEEP_IMAGE:-0}" != "1"; then
    docker image rm -f "$image" "$patched_base_image" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

assert_image_platform() {
  local candidate_image="$1"
  local actual_platform
  actual_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$candidate_image")"
  if test "$actual_platform" != "$platform"; then
    printf 'image platform mismatch for %s: requested %s, got %s\n' \
      "$candidate_image" "$platform" "$actual_platform" >&2
    return 1
  fi
}

docker build --platform "$platform" \
  --target base \
  --tag "$patched_base_image" \
  --build-arg "BUN_IMAGE=$upstream_image" .
assert_image_platform "$patched_base_image"

docker build --platform "$platform" \
  --build-arg "BUN_IMAGE=$upstream_image" \
  --build-arg "VERSION=$version" \
  --build-arg "REVISION=$revision" \
  --tag "$image" .
assert_image_platform "$image"

test "$(docker image inspect --format '{{.Config.User}}' "$image")" = "1000:1000"
test "$(docker image inspect --format '{{.Config.WorkingDir}}' "$image")" = "/app"
test "$(docker image inspect --format '{{json .Config.Entrypoint}}' "$image")" = '["/usr/local/bin/bun"]'
test "$(docker image inspect --format '{{json .Config.Cmd}}' "$image")" = '["src/server/index.ts"]'
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" = "$revision"
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' "$image")" = "$version"
test "$(docker image inspect --format '{{json (index .Config.Volumes "/tmp")}}' "$image")" = '{}'

docker run --rm --platform "$platform" --read-only \
  --env "CONTAINER_RUNTIME_EXPECTED_BUN_ARCH=$expected_bun_arch" \
  --entrypoint /usr/local/bin/bun "$image" -e '
    import { access, stat, writeFile } from "node:fs/promises";
    import { rootCertificates } from "node:tls";
    const expectedArch = process.env.CONTAINER_RUNTIME_EXPECTED_BUN_ARCH;
    if (expectedArch !== "arm64" && expectedArch !== "x64") {
      throw new Error(`unsupported expected runtime architecture: ${expectedArch ?? "unset"}`);
    }
    if (process.arch !== expectedArch) {
      throw new Error(`runtime architecture mismatch: expected ${expectedArch}, got ${process.arch}`);
    }
    if (process.cwd() !== "/app") throw new Error(`unexpected cwd: ${process.cwd()}`);
    if (process.getuid?.() !== 1000 || process.getgid?.() !== 1000) {
      throw new Error(`unexpected identity: ${process.getuid?.()}:${process.getgid?.()}`);
    }
    for (const path of [
      "/app/src/server/index.ts",
      "/app/src/server/self-hosted/migrate.ts",
      "/app/node_modules",
      "/opt/emails/certs/aws-rds-global-bundle.pem",
    ]) await access(path);
    const tmp = await stat("/tmp");
    if ((tmp.mode & 0o7777) !== 0o1777) throw new Error(`/tmp mode is ${(tmp.mode & 0o7777).toString(8)}`);
    await writeFile("/tmp/runtime-contract", "ok", { mode: 0o600 });
    if (rootCertificates.length < 100) throw new Error("public TLS root store is unavailable");
  '

test "$(docker run --rm --platform "$platform" --read-only "$image" src/cli/index.tsx --version)" = "$version"
docker run --rm --platform "$platform" --read-only "$image" src/server/index.ts --help \
  | grep -F 'ingest-worker' >/dev/null

docker network create --internal "$network" >/dev/null
docker run --detach --platform "$platform" --network "$network" --name "$postgres_container" \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev \
  --env POSTGRES_HOST_AUTH_METHOD=trust --env POSTGRES_DB=emails_smoke \
  "$postgres_image" >/dev/null
postgres_ready=0
for _ in $(seq 1 60); do
  if docker exec "$postgres_container" pg_isready --username postgres --dbname emails_smoke >/dev/null 2>&1; then postgres_ready=1; break; fi
  sleep 1
done
if test "$postgres_ready" != "1"; then
  printf 'isolated PostgreSQL fixture did not become ready\n' >&2
  exit 1
fi
docker exec "$postgres_container" psql --username postgres --dbname emails_smoke --set ON_ERROR_STOP=1 \
  --command 'CREATE ROLE emails_smoke LOGIN NOSUPERUSER NOBYPASSRLS; ALTER DATABASE emails_smoke OWNER TO emails_smoke; ALTER SCHEMA public OWNER TO emails_smoke;' >/dev/null
# Migrate as the same non-bypass owner used by the service. No production DSN is accepted.
docker run --rm --platform "$platform" --read-only --network "$network" \
  --env "EMAILS_DATABASE_URL=$fixture_database_url" --env AWS_EC2_METADATA_DISABLED=true \
  "$image" src/cli/index.tsx db migrate >/dev/null

docker run --detach --platform "$platform" --read-only --network "$network" --name "$container" \
  --env "EMAILS_DATABASE_URL=$fixture_database_url" \
  --env "EMAILS_API_SIGNING_KEY=synthetic-container-runtime-${revision}" \
  --env EMAILS_AUTH_FROM=auth@fixture.test \
  --env EMAILS_AUTH_ALLOWED_EMAIL_DOMAINS=fixture.test \
  --env EMAILS_SEND_PROVIDER=ses --env EMAILS_AWS_REGION=us-east-1 \
  --env AWS_EC2_METADATA_DISABLED=true \
  "$image" >/dev/null

# Keep these values in lockstep with the image HEALTHCHECK. The readiness
# budget covers its 20s cold-start period, two 30s health cadences, and two 5s
# probe timeouts. Once the explicit route is ready, reuse that 90s envelope so
# a transient unhealthy result can recover across at least two health cadences.
image_health_interval_seconds=30
image_health_timeout_seconds=5
image_health_start_period_seconds=20
readiness_poll_interval_seconds=1
health_poll_interval_seconds=1
readiness_wait_seconds=$((
  image_health_start_period_seconds
  + (2 * image_health_interval_seconds)
  + (2 * image_health_timeout_seconds)
))
health_wait_seconds="$readiness_wait_seconds"

ready=0
readiness_attempts=$((readiness_wait_seconds / readiness_poll_interval_seconds))
for _ in $(seq 1 "$readiness_attempts"); do
  if docker exec "$container" /usr/local/bin/bun -e '
      const response = await fetch("http://127.0.0.1:8080/ready");
      if (!response.ok) process.exit(1);
    ' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep "$readiness_poll_interval_seconds"
done

if test "$ready" != "1"; then
  docker exec "$container" /usr/local/bin/bun -e '
    try {
      const response = await fetch("http://127.0.0.1:8080/ready");
      console.error(`readiness probe status=${response.status}`);
    } catch (error) {
      console.error(`readiness probe error=${error instanceof Error ? error.name : "unknown"}`);
    }
  ' >&2 || true
  docker inspect --format '{{json .State.Health}}' "$container" >&2 || true
  docker logs "$container" >&2 || true
  exit 1
fi

docker exec "$container" /usr/local/bin/bun -e '
  const response = await fetch("http://127.0.0.1:8080/v1/messages");
  if (response.status !== 401) throw new Error("unauthenticated API read was not denied");
'

# Mint and register a tenant-bound read key through the shipped key implementation.
# Its token stays inside this process; neither host arguments nor logs receive it.
docker exec "$container" /usr/local/bin/bun -e '
  import { ApiKeyStore } from "@hasna/contracts/auth";
  import { getSelfHostedPool, closeSelfHostedPool, requireSigningSecret } from "./src/server/self-hosted/env.ts";
  import { issueSelfHostedApiKey, revokeSelfHostedApiKey } from "./src/server/self-hosted/keys.ts";
  import { DEFAULT_TENANT_ID } from "./src/server/self-hosted/migrations.ts";
  const { client } = getSelfHostedPool();
  const keys = new ApiKeyStore(client);
  let minted;
  try {
    minted = await issueSelfHostedApiKey(keys, requireSigningSecret(), { scopes: ["emails:read"], ttlDays: 1, createdBy: "container-smoke" });
    await client.execute("INSERT INTO api_key_tenants(kid,tenant_id) VALUES($1,$2)", [minted.kid, DEFAULT_TENANT_ID]);
    const request = () => fetch("http://127.0.0.1:8080/v1/messages?limit=1", { headers: { Authorization: "Bearer " + minted.token } });
    const response = await request();
    const body = await response.json();
    if (response.status !== 200 || !Array.isArray(body.messages)) throw new Error("authenticated PostgreSQL API read failed");
    const cli = Bun.spawnSync({
      cmd: [process.execPath, "src/cli/index.tsx", "--json", "inbox", "list", "--limit", "1"],
      env: { ...process.env, HASNA_EMAILS_API_URL: "http://127.0.0.1:8080", HASNA_EMAILS_API_KEY: minted.token, EMAILS_CLIENT_ENV_LOADED: "1" },
      stdout: "pipe", stderr: "pipe",
    });
    if (cli.exitCode !== 0 || !Array.isArray(JSON.parse(cli.stdout.toString()))) throw new Error("canonical API credential CLI read failed");
    await revokeSelfHostedApiKey(keys, minted.kid, "synthetic smoke complete");
    if ((await request()).status !== 401) throw new Error("revoked synthetic API key was not denied");
  } finally {
    if (minted) await revokeSelfHostedApiKey(keys, minted.kid, "synthetic smoke cleanup");
    await closeSelfHostedPool();
  }
'

health="starting"
health_attempts=$((health_wait_seconds / health_poll_interval_seconds))
for _ in $(seq 1 "$health_attempts"); do
  health="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
  if test "$health" = "healthy"; then
    break
  fi
  sleep "$health_poll_interval_seconds"
done

if test "$health" != "healthy"; then
  docker inspect --format '{{json .State.Health}}' "$container" >&2 || true
  docker logs "$container" >&2 || true
  exit 1
fi
