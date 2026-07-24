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

  test("marks the image as containment-only and disables operational startup", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
    const compose = readFileSync(join(root, "docker-compose.yml"), "utf8");
    const runner = dockerfile.split("FROM base AS runner")[1]!;

    expect(dockerfile).toMatch(/Stage A containment-only/i);
    expect(dockerfile).toContain('CMD ["bun", "dist/server/index.js", "--help"]');
    expect(dockerfile).toContain("HEALTHCHECK NONE");
    expect(dockerfile).not.toContain("PURE REMOTE");
    expect(dockerfile).not.toMatch(/\bRDS\b/);
    expect(dockerfile).not.toContain("migrate");
    expect(dockerfile).not.toContain("contracts-cli");
    expect(compose).toMatch(/Stage A containment-only/i);
    expect(compose).not.toContain("postgres:");
    expect(compose).not.toContain("todos-migrate");
    expect(compose).not.toContain("DATABASE_URL");
    expect(compose).not.toContain("SIGNING_KEY");
    expect(compose).not.toContain("ports:");
    expect(runner).not.toContain("COPY --from=deps /app/node_modules ./node_modules");
    expect(runner).not.toContain("COPY package.json bun.lock ./");
  });

  test("quarantines the prior hosted container workflow as Stage B deferred", () => {
    const buildspec = readFileSync(join(root, "buildspec.container-candidate.yml"), "utf8");
    const docs = [
      readFileSync(join(root, "docs/CUTOVER-RUNBOOK.md"), "utf8"),
      readFileSync(join(root, "docs/native-storage.md"), "utf8"),
    ].join("\n");

    expect(buildspec).toMatch(/Stage B deferred/i);
    expect(buildspec).not.toContain("docker build");
    expect(buildspec).not.toContain("docker push");
    expect(buildspec).not.toMatch(/\bRDS\b/);
    expect(buildspec).not.toContain("migrate");
    expect(buildspec).not.toContain("DATABASE_URL");
    expect(buildspec).not.toContain("CRUD");
    expect(docs).toMatch(/containment-only/i);
    expect(docs).toMatch(/\/health[^\n]*liveness/i);
    expect(docs).toMatch(/\/ready[^\n]*(?:unavailable|503)/i);
    expect(docs).toMatch(/Stage B[^\n]*(?:RDS|migration|hosted)/i);
  });
});
