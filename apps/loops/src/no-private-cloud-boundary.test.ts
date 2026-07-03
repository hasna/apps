import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

describe("public package cloud boundary", () => {
  test("does not ship private hosted implementation details or obvious secrets", () => {
    const result = spawnSync("bun", ["run", "scripts/no-private-cloud-boundary.mjs"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("boundary scan passed");
  });

  test("control-plane foundation does not import local execution authority", () => {
    const api = readFileSync(new URL("./api/index.ts", import.meta.url), "utf8");
    const runner = readFileSync(new URL("./runner/index.ts", import.meta.url), "utf8");
    const combined = `${api}\n${runner}`;

    expect(combined).not.toContain("new Store");
    expect(combined).not.toContain("../lib/store");
    expect(combined).not.toContain("../lib/scheduler");
    expect(combined).not.toContain("../daemon/");
    expect(combined).not.toContain("executeClaimedRun");
    expect(combined).not.toContain("runNow");
  });
});
