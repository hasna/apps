import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dockerfile = readFileSync(join(import.meta.dir, "..", "Dockerfile"), "utf8");
const bunImage =
  "oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0";

describe("instructions production image contract", () => {
  test("pins every stage to the repository Bun toolchain and immutable image index", () => {
    const fromLines = dockerfile.split("\n").filter((line) => line.startsWith("FROM "));
    expect(fromLines).toHaveLength(3);
    for (const line of fromLines) expect(line).toContain(bunImage);
    expect(dockerfile).not.toMatch(/oven\/bun:1(?:\s|$)/);
  });

  test("pins the patched Alpine OpenSSL runtime packages", () => {
    expect(dockerfile).toContain(
      'RUN apk add --no-cache "libcrypto3=3.5.8-r0" "libssl3=3.5.8-r0"',
    );
  });

  test("keeps an explicit non-root runtime user and the server entrypoint", () => {
    expect(dockerfile).toContain("USER bun");
    expect(dockerfile).toContain('CMD ["bun", "dist/server/index.js"]');
  });
});
