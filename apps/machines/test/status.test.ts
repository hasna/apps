import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { getStatus } from "../src/commands/status.js";
import { writeHeartbeat } from "../src/agent/runtime.js";
import { closeDb, getDb, upsertHeartbeat } from "../src/db.js";
import { REDACTED_VALUE } from "../src/redaction.js";

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
    const status = getStatus({ privateMetadata: true });
    expect(status.manifestMachineCount).toBe(1);
    expect(status.heartbeatCount).toBeGreaterThan(0);
    expect(status.machines.some((machine) => machine.machineId === "demo-node-01")).toBe(true);
  });

  test("merges alias-keyed heartbeats into the canonical manifest machine", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-status-alias-"));
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "apple03";
    manifestInit();
    manifestAdd({
      id: "station03",
      aliases: ["apple03"],
      platform: "linux",
      workspacePath: "/home/operator/workspace",
    });

    upsertHeartbeat("apple03", 103, "online", { daemonVersion: "0.0.103" });

    const status = getStatus({ privateMetadata: true, heartbeatTtlMs: null });
    expect(status.machineId).toBe("station03");
    expect(status.machines).toHaveLength(1);
    expect(status.machines[0]).toMatchObject({
      machineId: "station03",
      manifestDeclared: true,
      heartbeatStatus: "online",
      daemonVersion: "0.0.103",
    });
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

    const machine = getStatus({ privateMetadata: true, heartbeatTtlMs: null }).machines.find((entry) => entry.machineId === "demo-node-01");
    expect(machine?.heartbeatStatus).toBe("online");
    expect(machine?.daemonVersion).toBe("0.0.39");
    expect(machine?.storageSyncStatus).toBe("disabled");
  });

  test("marks stale online heartbeats offline in status summaries", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-status-stale-"));
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
    });

    upsertHeartbeat("demo-node-01", 100, "online");
    getDb().query("UPDATE agent_heartbeats SET updated_at = ?, observed_at = ? WHERE machine_id = ? AND pid = ?")
      .run("2026-06-18T11:37:29.713Z", "2026-06-18T11:37:29.713Z", "demo-node-01", 100);

    const machine = getStatus({
      privateMetadata: true,
      now: new Date("2026-06-18T11:40:30.000Z"),
    }).machines.find((entry) => entry.machineId === "demo-node-01");

    expect(machine?.heartbeatStatus).toBe("offline");
  });

  test("redacts local paths and machine identifiers by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-status-redacted-"));
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";
    manifestInit();
    manifestAdd({
      id: "demo-node-01",
      platform: "linux",
      workspacePath: "/home/operator/workspace",
    });
    upsertHeartbeat("demo-node-01", 100, "online", {
      doctorSummary: { blockers: [{ detail: "operator@demo-node-01.private.example 100.64.0.7" }] },
      privateMetadata: true,
    });

    const status = getStatus();

    expect(status.machineId).toBe(REDACTED_VALUE);
    expect(status.manifestPath).toBe(REDACTED_VALUE);
    expect(status.dbPath).toBe(REDACTED_VALUE);
    expect(status.notificationsPath).toBe(REDACTED_VALUE);
    expect(status.machines[0]?.machineId).toBe(REDACTED_VALUE);
    expect(status.machines[0]?.doctorSummary).toBeNull();
    expect(JSON.stringify(status)).not.toContain("demo-node-01");
    expect(JSON.stringify(status)).not.toContain("operator@demo-node-01.private.example");
  });
});
