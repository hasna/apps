import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));

function sourceFilesUnder(relativeDir: string): string[] {
  const root = join(sourceRoot, relativeDir);
  const files: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && extname(path) === ".ts" && !path.endsWith(".test.ts")) files.push(path);
    }
  }

  walk(root);
  return files;
}

describe("public package cloud boundary", () => {
  test("does not ship private hosted implementation details or obvious secrets", () => {
    const result = spawnSync("bun", ["run", "scripts/no-private-cloud-boundary.mjs"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("boundary scan passed");
  });

  test("loops-api does not import local execution authority", () => {
    const combined = sourceFilesUnder("api")
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(combined).not.toContain("new Store");
    expect(combined).not.toContain("bun:sqlite");
    expect(combined).not.toContain("../lib/store");
    expect(combined).not.toContain("../lib/storage/index");
    expect(combined).not.toContain("../lib/storage/sqlite");
    expect(combined).not.toContain("../lib/scheduler");
    expect(combined).not.toContain("../lib/executor");
    expect(combined).not.toContain("../lib/workflow-runner");
    expect(combined).not.toContain("../daemon/");
    expect(combined).not.toContain("executeClaimedRun");
    expect(combined).not.toContain("runNow");
  });

  test("loops-runner does not import local storage or scheduler authority", () => {
    const combined = sourceFilesUnder("runner")
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(combined).not.toContain("new Store");
    expect(combined).not.toContain("bun:sqlite");
    expect(combined).not.toContain("../lib/store");
    expect(combined).not.toContain("../lib/storage/index");
    expect(combined).not.toContain("../lib/storage/sqlite");
    expect(combined).not.toContain("../lib/scheduler");
    expect(combined).not.toContain("../daemon/");
    expect(combined).not.toContain("runNow");
  });
});
