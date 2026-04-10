import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { getStatus } from "../src/commands/status.js";
import { writeHeartbeat } from "../src/agent/runtime.js";

describe("fleet status", () => {
  test("combines manifest machines and heartbeats", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-status-"));
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "spark01";
    manifestInit();
    manifestAdd({
      id: "spark01",
      platform: "linux",
      workspacePath: "/home/hasna/workspace",
    });

    writeHeartbeat("online");
    const status = getStatus();
    expect(status.manifestMachineCount).toBe(1);
    expect(status.heartbeatCount).toBeGreaterThan(0);
    expect(status.machines.some((machine) => machine.machineId === "spark01")).toBe(true);
  });
});
