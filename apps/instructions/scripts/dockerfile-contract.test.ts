import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dockerfile = readFileSync(join(import.meta.dir, "..", "Dockerfile"), "utf8");

describe("instructions production image contract", () => {
  test("pins every stage to the repository Bun toolchain", () => {
    const fromLines = dockerfile.split("\n").filter((line) => line.startsWith("FROM "));
    expect(fromLines).toHaveLength(3);
    for (const line of fromLines) expect(line).toContain("oven/bun:1.3.14-alpine");
    expect(dockerfile).not.toMatch(/oven\/bun:1(?:\s|$)/);
  });

  test("keeps an explicit non-root runtime user and the server entrypoint", () => {
    expect(dockerfile).toContain("USER bun");
    expect(dockerfile).toContain('CMD ["bun", "dist/server/index.js"]');
  });
});
