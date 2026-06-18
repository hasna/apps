import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { getStatus } from "../src/commands/status.js";
import { writeHeartbeat } from "../src/agent/runtime.js";
import { closeDb, getDb, upsertHeartbeat } from "../src/db.js";

const ENV_KEYS = [
  "HASNA_MACHINES_DB_PATH",
  "HASNA_MACHINES_MANIFEST_PATH",
  "HASNA_MACHINES_MACHINE_ID",
] as const;

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("fleet status", () => {
  test("combines manifest machines and heartbeats", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-status-"));
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
    });

    writeHeartbeat("online");
    const status = getStatus();
    expect(status.manifestMachineCount).toBe(1);
    expect(status.heartbeatCount).toBeGreaterThan(0);
    expect(status.machines.some((machine) => machine.machineId === "demo-node-01")).toBe(true);
  });

  test("uses the latest heartbeat row for status summaries", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-status-latest-"));
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
    });

    upsertHeartbeat("demo-node-01", 100, "online", { daemonVersion: "0.0.39", storageSyncStatus: "disabled" });
    upsertHeartbeat("demo-node-01", 101, "offline", { daemonVersion: "0.0.37" });
    getDb().query("UPDATE agent_heartbeats SET updated_at = ? WHERE machine_id = ? AND pid = ?").run("2026-06-18T11:37:29.713Z", "demo-node-01", 100);
    getDb().query("UPDATE agent_heartbeats SET updated_at = ? WHERE machine_id = ? AND pid = ?").run("2026-06-18T11:01:38.986Z", "demo-node-01", 101);

    const machine = getStatus().machines.find((entry) => entry.machineId === "demo-node-01");
    expect(machine?.heartbeatStatus).toBe("online");
    expect(machine?.daemonVersion).toBe("0.0.39");
    expect(machine?.storageSyncStatus).toBe("disabled");
  });
});
