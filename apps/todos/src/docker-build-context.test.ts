import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import packageJson from "../package.json";

const root = join(import.meta.dir, "..");

describe("server image build context", () => {
  test("installs the public contracts package without a local vendor tree", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    const lockfile = readFileSync(join(root, "bun.lock"), "utf8");

    // The build context is exactly `COPY package.json bun.lock` +
    // `bun install --frozen-lockfile`, so the contracts version the image
    // installs is whatever this manifest declares and this lockfile resolves.
    // Derive the expectation from the manifest rather than restating a version
    // number here: a hardcoded pin goes stale on the next contracts bump and
    // then fails as a false defect about the build context (measured — this
    // assertion still named 0.5.2 while the manifest declared 0.13.4).
    expect(packageJson.dependencies).toHaveProperty("@hasna/contracts");
    const contractsVersion = packageJson.dependencies["@hasna/contracts"];
    // An exact pin, never a range: the runner copies the contracts CLI out of
    // the deps stage, so the installed version must be the declared one.
    expect(contractsVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lockfile).toContain(`"@hasna/contracts": ["@hasna/contracts@${contractsVersion}"`);
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
    expect(dockerfile).toContain("ARG OPENSSL_VERSION=3.5.8-r0");
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

  // Regression guard for O15-04975 (2026-08-29): the exact apk pins in the
  // base stage became unsatisfiable when the alpine v3.22 main repo dropped
  // libcrypto3/libssl3 3.5.7-r0 in favour of 3.5.8-r0, blocking every todos
  // deploy at `docker build` (apk exit 4). The static assertions above only
  // check that the pins EXIST in the Dockerfile — they cannot see a pin going
  // stale. This check resolves the live v3.22 index for both supported arches
  // (linux/arm64, the platform the buildspec builds, and linux/amd64, the
  // oss-fleet-prod ECS platform) and fails in CI the moment a pinned revision
  // is no longer served, before a deploy can block on it. A fetch failure
  // fails the test deliberately: an unresolvable index is exactly the
  // condition that broke deploys. Same precedent as the emails base-stage
  // satisfiability test landed in hasna/apps#1450.
  test("pins OpenSSL revisions the alpine v3.22 repos still serve on both supported arches", async () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    const opensslVersion = dockerfile.match(/ARG OPENSSL_VERSION=([0-9][^ \r\n]*)/)?.[1];
    expect(opensslVersion, "Dockerfile must declare an exact OPENSSL_VERSION ARG").toBeTruthy();

    const baseStage = dockerfile.split("FROM ${BUN_IMAGE} AS base")[1]!;
    expect(baseStage).toContain('"libcrypto3=${OPENSSL_VERSION}"');
    expect(baseStage).toContain('"libssl3=${OPENSSL_VERSION}"');

    for (const pkg of ["libcrypto3", "libssl3"] as const) {
      for (const arch of ["aarch64", "x86_64"] as const) {
        const url = `https://dl-cdn.alpinelinux.org/alpine/v3.22/main/${arch}/APKINDEX.tar.gz`;
        const response = await fetch(url);
        expect(
          response.ok,
          `could not resolve ${url} (HTTP ${response.status}) — the pinned ${pkg} cannot be verified satisfiable`,
        ).toBeTrue();
        const indexText = gunzipSync(
          new Uint8Array(await response.arrayBuffer()),
        ).toString("utf8");
        const servedVersions = new Set<string>();
        for (const block of indexText.split(/\n\n+/)) {
          let name: string | null = null;
          let version: string | null = null;
          for (const line of block.split("\n")) {
            if (line.startsWith("P:")) name = line.slice(2);
            else if (line.startsWith("V:")) version = line.slice(2);
          }
          if (name === pkg && version) servedVersions.add(version);
        }
        expect(
          servedVersions.has(opensslVersion!),
          `${pkg}=${opensslVersion} is not served by alpine v3.22/${arch} (served: ${[...servedVersions].join(", ")}) — apk add will be unsatisfiable and deploys will block`,
        ).toBeTrue();
      }
    }
  }, 60_000);

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
      'docker run --rm --entrypoint bun "${IMAGE}" dist/server/index.js --version)" = "${TODOS_PACKAGE_VERSION}"',
    );
    expect(buildspec).toContain('export TODOS_PACKAGE_VERSION="$(jq -er \'.version | strings\' package.json)"');
    expect(buildspec).toContain('-v "$PWD/scripts/semver.ts:/tmp/semver.ts:ro" --entrypoint bun "${BUN_IMAGE_OVERRIDE}" /tmp/semver.ts "${TODOS_PACKAGE_VERSION}"');
    expect(buildspec).toContain('org.opencontainers.image.version=${TODOS_PACKAGE_VERSION}');
    expect(buildspec).toContain('-e TODOS_EXPECTED_VERSION="${TODOS_PACKAGE_VERSION}"');
    expect(buildspec).toContain('-v "$PWD/scripts/semver.ts:/tmp/semver.ts:ro" --entrypoint bun "${IMAGE}" /tmp/container-http-smoke.ts');
    expect(buildspec).toContain('--build-arg "BUN_IMAGE=${BUN_IMAGE_OVERRIDE}"');
    expect(buildspec).toContain('BASE_IMAGE_ARCHIVE_VERSION');
    expect(buildspec).toContain('BASE_IMAGE_ARCHIVE_SHA256');
    expect(buildspec).toContain('test -n "${SOURCE_ARCHIVE_SHA256:-}"');
    expect(buildspec).toContain('[[ "${SOURCE_SHA}" =~ ^[0-9a-f]{40}$ ]]');
    expect(buildspec).toContain('[[ "${SOURCE_ARCHIVE_SHA256}" =~ ^[0-9a-f]{64}$ ]]');
    expect(buildspec).toContain('[[ "${EXPECTED_SOURCE_TREE_SHA256}" =~ ^[0-9a-f]{64}$ ]]');
    expect(buildspec).toContain('--arg archive_sha256 "${SOURCE_ARCHIVE_SHA256}"');
    expect(buildspec).not.toContain('SOURCE_ARCHIVE_SHA256:-unknown');
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
    expect(buildspec).toContain("^libcrypto3-3.5.8-r0 - ");
    expect(buildspec).toContain("^libssl3-3.5.8-r0 - ");
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
    const containerSmoke = readFileSync(join(root, "scripts/container-http-smoke.ts"), "utf8");
    expect(containerSmoke).toContain('const expectedVersion = process.env.TODOS_EXPECTED_VERSION;');
    expect(containerSmoke).toContain('import { isStrictSemver } from "./semver.ts";');
    expect(containerSmoke).toContain('TODOS_EXPECTED_VERSION must be a valid semver version');
    expect(containerSmoke).toContain('versionPayload.version !== expectedVersion');
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
