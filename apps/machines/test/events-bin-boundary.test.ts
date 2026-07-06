import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import packageJson from "../package.json" assert { type: "json" };

const MACHINES_BINS = ["machines", "machines-agent", "machines-mcp", "machines-serve"];
const EVENT_BINS = ["events", "hasna-events"];

describe("dependency event bin boundary", () => {
  test("package exposes only machines-owned bins", () => {
    expect(Object.keys(packageJson.bin).sort()).toEqual(MACHINES_BINS.sort());
    for (const name of EVENT_BINS) {
      expect(name in packageJson.bin).toBe(false);
    }
  });

  test("package scripts do not invoke direct @hasna/events bins", () => {
    const scripts = Object.values(packageJson.scripts).join("\n");
    expect(scripts).not.toContain("node_modules/.bin/events");
    expect(scripts).not.toContain("node_modules/.bin/hasna-events");
    expect(scripts).not.toMatch(/(^|[\s;&|])events\s+(?:events|webhooks)\b/);
    expect(scripts).not.toMatch(/(^|[\s;&|])hasna-events\s+(?:events|webhooks)\b/);
    expect(scripts).not.toMatch(/(^|[\s;&|])hasna-events(?:\s|$)/);
  });

  test("release verifier and README document dependency-owned event bins as out of scope", () => {
    const verifier = readFileSync("scripts/verify-release.ts", "utf8");
    const readme = readFileSync("README.md", "utf8");
    expect(verifier).toContain("assertMachinesOwnedBinBoundary");
    expect(verifier).toContain("assertInstalledDependencyBinBoundary");
    expect(verifier).toContain("dependency-owned");
    expect(readme).toContain("Direct @hasna/events bins");
    expect(readme).toContain("dependency-owned");
    expect(readme).toContain("Use `machines events` and");
    expect(readme).toContain("`machines webhooks`");
  });
});
