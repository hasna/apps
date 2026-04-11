import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { runSelfTest } from "../src/commands/self-test.js";

describe("self-test", () => {
  afterEach(() => {
    delete process.env["HASNA_MACHINES_MACHINE_ID"];
    delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
    delete process.env["HASNA_MACHINES_DB_PATH"];
    delete process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"];
  });

  test("returns a suite of smoke checks", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-self-test-"));
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] = join(dir, "notifications.json");
    manifestInit();
    manifestAdd({ id: "spark01", platform: "linux", workspacePath: "/home/hasna/workspace" });

    const result = runSelfTest();
    expect(result.machineId).toBe("spark01");
    expect(result.checks.length).toBeGreaterThanOrEqual(8);
    expect(result.checks.some((check) => check.id === "doctor")).toBe(true);
  });
});
