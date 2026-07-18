import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../package.json";

const root = join(import.meta.dir, "..");

describe("server image build context", () => {
  test("installs the public contracts package without a local vendor tree", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    const lockfile = readFileSync(join(root, "bun.lock"), "utf8");

    expect(packageJson.dependencies["@hasna/contracts"]).toBe("0.5.2");
    expect(lockfile).toContain('"@hasna/contracts": ["@hasna/contracts@0.5.2"');
    expect(packageJson.overrides?.["fast-uri"]).toBe("3.1.2");
    expect(lockfile).toContain('"fast-uri": ["fast-uri@3.1.2"');
    expect(lockfile).not.toContain('"fast-uri": ["fast-uri@3.1.0"');
    expect(dockerfile).toContain("COPY package.json bun.lock ./");
    expect(dockerfile).toContain("RUN bun install --frozen-lockfile --ignore-scripts");
    expect(dockerfile).not.toMatch(/^COPY\s+vendor(?:\/|\s)/m);
    expect(dockerfile).not.toContain("vendored tarball");
  });

  test("pins the native ARM64 runner to the reviewed Bun musl manifest", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

    expect(dockerfile).toContain(
      "ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:3c9ab1a521c82144dff537125695017a0480d3a13088fba7e012cfae0f63146f",
    );
    expect(dockerfile).toContain("FROM ${BUN_IMAGE} AS base");
    expect(dockerfile).not.toContain("FROM --platform=linux/arm64");
    expect(dockerfile).not.toContain("# syntax=docker/dockerfile:");
    expect(dockerfile).toContain('test "$(bun --version)" = "1.3.14"');
    expect(dockerfile).toContain("apk info -vv | grep -q '^musl-1.2.5-r12 - '");
    expect(dockerfile).toContain("ARG OPENSSL_VERSION=3.5.7-r0");
    expect(dockerfile).toContain('"libcrypto3=${OPENSSL_VERSION}"');
    expect(dockerfile).toContain('"libssl3=${OPENSSL_VERSION}"');
    expect(dockerfile).toContain('^libcrypto3-${OPENSSL_VERSION} - ');
    expect(dockerfile).toContain('^libssl3-${OPENSSL_VERSION} - ');
    expect(dockerfile).toContain("! apk info -e openssl");
    expect(dockerfile).toContain("! apk info -e glibc");
    expect(dockerfile).not.toContain("apt-get");
    expect(dockerfile).not.toContain("dpkg-query");
    expect(dockerfile).not.toMatch(/^FROM(?:\s+--platform=\S+)?\s+oven\/bun:(?:1|latest)(?:\s|$)/m);
  });

  test("preserves bash-backed runtime behavior without adding absent host tools", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

    expect(dockerfile).toContain("ARG BASH_VERSION=5.2.37-r0");
    expect(dockerfile).toContain('apk add --no-cache "bash=${BASH_VERSION}"');
    expect(dockerfile).toContain('apk info -vv | grep -q "^bash-${BASH_VERSION} - "');
    expect(dockerfile).toContain("! command -v git");
    expect(dockerfile).toContain("! command -v tmux");
    expect(dockerfile).not.toMatch(/apk add[^\n]*(?:git|tmux)/);
  });

  test("keeps the default and migration command contracts explicit", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
    const runner = dockerfile.split("FROM base AS runner")[1]!;

    expect(dockerfile).toContain('CMD ["bun", "dist/server/index.js"]');
    expect(compose).toContain('command: ["bun", "dist/server/index.js", "migrate"]');
    expect(dockerfile).toContain(
      "COPY --from=deps /app/node_modules/@hasna/contracts/dist/cli/index.js ./bin/contracts-cli.js",
    );
    expect(runner).not.toContain("COPY --from=deps /app/node_modules ./node_modules");
    expect(runner).not.toContain("COPY package.json bun.lock ./");
  });

  test("ships a candidate build gate for architecture, TLS, API, and inventory", () => {
    const buildspec = readFileSync(join(root, "buildspec.container-candidate.yml"), "utf8");

    expect(buildspec).toContain("docker build --platform linux/arm64");
    expect(buildspec).toContain(
      'docker run --rm --entrypoint bun "${IMAGE}" dist/server/index.js --version)" = 0.11.92',
    );
    expect(buildspec).toContain('--build-arg "BUN_IMAGE=${BUN_IMAGE_OVERRIDE}"');
    expect(buildspec).toContain('BASE_IMAGE_ARCHIVE_VERSION');
    expect(buildspec).toContain('BASE_IMAGE_ARCHIVE_SHA256');
    expect(buildspec).toContain('EXPECTED_SOURCE_TREE_SHA256');
    expect(buildspec).toContain('sha256sum --zero > /tmp/source-tree.manifest');
    expect(buildspec).toContain('ECR_REPOSITORY_NAME');
    expect(buildspec).toContain('aws s3api get-object');
    expect(buildspec).toContain('docker load --input /tmp/bun-base.docker.tar');
    expect(buildspec).toContain('sha256:bb03dc9f0724a6decf34994aac876876d1ab5e07c72371a4ed7a8466944617b2');
    expect(buildspec).toContain('sha256:3c9ab1a521c82144dff537125695017a0480d3a13088fba7e012cfae0f63146f');
    expect(buildspec).toContain("candidate post-build evidence skipped: build did not reach push");
    expect(buildspec).toContain('docker logs "${TEST_APP}"');
    expect(buildspec).toContain("test -x /lib/ld-musl-aarch64.so.1");
    expect(buildspec).toContain("test ! -e /lib64/ld-linux-aarch64.so.1");
    expect(buildspec).toContain("openssl rand -hex 24");
    expect(buildspec).toContain("^libcrypto3-3.5.7-r0 - ");
    expect(buildspec).toContain("^libssl3-3.5.7-r0 - ");
    expect(buildspec).toContain("! command -v openssl");
    expect(buildspec).toContain("apk info -vv");
    expect(buildspec).toContain("container-sbom.cdx.json");
    expect(buildspec).toContain("GRYPE_VERSION=0.115.0");
    expect(buildspec).toContain("b8541b9ecc3e936e7db4ff14b71a9474b25f3898ccaad63ee0bfe3449fcd734d");
    expect(buildspec).toContain('GRYPE_CHECK_FOR_APP_UPDATE=false /tmp/grype "${IMAGE}" --fail-on high');
    expect(buildspec).toContain("container-vulnerability-report.json");
    expect(buildspec).toContain("container-grype-db-status.json");
    expect(buildspec).toContain("test ! -e /app/node_modules");
    expect(buildspec).toContain("bin/contracts-cli.js issue-key");
    expect(buildspec).toContain("container-provenance.json");
    expect(buildspec).toContain("ORAS_VERSION=1.3.3");
    expect(buildspec).toContain("ac7156f93a21e903f7ad606c792f3560f17e0cd0e36365634701b1e7cc4e4eca");
    expect(buildspec).toContain("oras attach --distribution-spec v1.1-referrers-api");
    expect(buildspec).toContain("oras discover --distribution-spec v1.1-referrers-api");
    expect(buildspec).toContain("container-source-tree.manifest");
    expect(buildspec).not.toMatch(/\b\d{12}\.dkr\.ecr\./);
    expect(buildspec).not.toContain("hasna-xyz-");
    expect(buildspec).toContain("sslmode=verify-full");
    expect(buildspec).toContain("NODE_EXTRA_CA_CERTS=/tls/ca.crt");
    expect(buildspec).toContain(
      "public.ecr.aws/docker/library/postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777",
    );
    expect(buildspec).not.toMatch(/\s+postgres:16-alpine@sha256:/);
    expect(buildspec).toContain("wrong-ca.crt");
    expect(buildspec).toContain("wrong-postgres");
    expect(buildspec).toContain("bun dist/server/index.js migrate");
    expect(buildspec).toContain("scripts/container-http-smoke.ts");
    expect(readFileSync(join(root, "scripts/container-http-smoke.ts"), "utf8")).toContain(
      'versionPayload.version !== "0.11.92"',
    );
    expect(buildspec).not.toContain("terraform");
    expect(buildspec).not.toContain("update-service");
  });

  test("publishes a readiness-based container healthcheck", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

    expect(dockerfile).toMatch(
      /^HEALTHCHECK\s+--interval=30s\s+--timeout=5s\s+--start-period=20s\s+--retries=3\s+CMD\s+\["bun",\s*"-e",/m,
    );
    expect(dockerfile).toContain("http://127.0.0.1:19427/ready");
  });
});
