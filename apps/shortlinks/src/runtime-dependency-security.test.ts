import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  overrides?: Record<string, string>;
};
const lock = readFileSync(join(packageRoot, "bun.lock"), "utf8");

describe("Shortlinks runtime dependency security floors", () => {
  test("pins patched URI and IP parsers used by the production MCP dependency graph", () => {
    expect(packageJson.overrides).toEqual({
      "fast-uri": "3.1.7",
      "ip-address": "10.7.0",
    });
  });

  test("the standalone production lock resolves only the reviewed patched versions", () => {
    expect(lock).toContain('"fast-uri": ["fast-uri@3.1.7"');
    expect(lock).toContain('"ip-address": ["ip-address@10.7.0"');
    expect(lock).not.toContain("fast-uri@3.1.3");
    expect(lock).not.toContain("ip-address@10.2.0");
  });
});
