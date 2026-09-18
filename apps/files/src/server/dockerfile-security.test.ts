import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dockerfile = readFileSync(join(import.meta.dir, "..", "..", "Dockerfile"), "utf8");

describe("Files production image boundary", () => {
  test("pins the reviewed ARM64-capable Alpine base and patched runtime libraries", () => {
    expect(dockerfile).toContain(
      "ARG BUN_IMAGE=oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0",
    );
    expect(dockerfile).toContain("ARG BUN_VERSION=1.3.14");
    expect(dockerfile).toContain("ARG OPENSSL_VERSION=3.5.8-r0");
    expect(dockerfile).toContain('test "$(bun --version)" = "${BUN_VERSION}"');
    expect(dockerfile).toContain('"libcrypto3=${OPENSSL_VERSION}"');
    expect(dockerfile).toContain('"libssl3=${OPENSSL_VERSION}"');
  });

  test("derives every stage from the hardened base and refuses the rejected Debian package class", () => {
    expect(dockerfile).toContain("FROM ${BUN_IMAGE} AS base");
    expect(dockerfile).toContain("FROM base AS deps");
    expect(dockerfile).toContain("FROM base AS build");
    expect(dockerfile).toContain("FROM base AS runner");
    expect(dockerfile).not.toMatch(/FROM .*oven\/bun:1(?:\s|$)/);
    expect(dockerfile).toContain("! apk info -e glibc");
    expect(dockerfile).toContain("! apk info -e perl");
    expect(dockerfile).toContain("! apk info -e sqlite-libs");
    expect(dockerfile).not.toContain("apk upgrade");
  });

  test("preserves the server and migration runtime contract", () => {
    expect(dockerfile).toContain("COPY docker/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem");
    expect(dockerfile).toContain('CMD ["bun", "dist/server/index.js", "--port", "19432"]');
  });
});
