import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { runSelfTest } from "../src/commands/self-test.js";

describe("self-test", () => {
  afterEach(() => {
    delete process.env["HASNA_STATIONS_MACHINE_ID"];
    delete process.env["HASNA_STATIONS_MANIFEST_PATH"];
    delete process.env["HASNA_STATIONS_DB_PATH"];
    delete process.env["HASNA_STATIONS_NOTIFICATIONS_PATH"];
  });

  test("returns a suite of smoke checks", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-self-test-"));
    process.env["HASNA_STATIONS_MACHINE_ID"] = "demo-node-01";
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    process.env["HASNA_STATIONS_DB_PATH"] = join(dir, "stations.db");
    process.env["HASNA_STATIONS_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
    manifestInit();
    manifestAdd({ id: "demo-node-01", platform: "linux", workspacePath: "/home/operator/workspace" });

    const result = runSelfTest();
    expect(result.machineId).toBe("demo-node-01");
    expect(result.overall).toBe(result.counts.fail > 0 ? "fail" : result.counts.warn > 0 ? "warn" : "ok");
    expect(result.counts.ok + result.counts.warn + result.counts.fail).toBe(result.checks.length);
    expect(result.checks.length).toBeGreaterThanOrEqual(8);
    expect(result.checks.some((check) => check.id === "doctor")).toBe(true);
  });
});
