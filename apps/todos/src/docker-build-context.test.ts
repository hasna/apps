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
    expect(dockerfile).toContain("COPY package.json bun.lock ./");
    expect(dockerfile).toContain("RUN bun install --frozen-lockfile --ignore-scripts");
    expect(dockerfile).not.toMatch(/^COPY\s+vendor(?:\/|\s)/m);
    expect(dockerfile).not.toContain("vendored tarball");
  });

  test("pins and patches the runner base above the Debian OpenSSL security floor", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

    expect(dockerfile).toContain(
      "ARG BUN_IMAGE=oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4",
    );
    expect(dockerfile).toContain("ARG OPENSSL_VERSION=3.5.6-1~deb13u2");
    expect(dockerfile).toContain('"openssl=${OPENSSL_VERSION}"');
    expect(dockerfile).toContain('"libssl3t64=${OPENSSL_VERSION}"');
    expect(dockerfile).toContain('"openssl-provider-legacy=${OPENSSL_VERSION}"');
    expect(dockerfile).toContain("dpkg-query -W openssl libssl3t64 openssl-provider-legacy");
    expect(dockerfile).not.toMatch(/^FROM(?:\s+--platform=\S+)?\s+oven\/bun:(?:1|latest)(?:\s|$)/m);
  });

  test("publishes a readiness-based container healthcheck", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

    expect(dockerfile).toMatch(
      /^HEALTHCHECK\s+--interval=30s\s+--timeout=5s\s+--start-period=20s\s+--retries=3\s+CMD\s+\["bun",\s*"-e",/m,
    );
    expect(dockerfile).toContain("http://127.0.0.1:19427/ready");
  });
});
