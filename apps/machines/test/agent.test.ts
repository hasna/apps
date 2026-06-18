import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/db.js";
import { manifestInit } from "../src/commands/manifest.js";
import { getAgentStatus, markOffline, sanitizePublicString, writeHeartbeat, writeHeartbeatTick } from "../src/agent/runtime.js";

afterEach(() => {
  closeDb();
  delete process.env["HASNA_MACHINES_DB_PATH"];
  delete process.env["HASNA_MACHINES_MANIFEST_PATH"];
  delete process.env["HASNA_MACHINES_MACHINE_ID"];
  delete process.env["HASNA_MACHINES_DATABASE_URL"];
  delete process.env["MACHINES_DATABASE_URL"];
  delete process.env["HASNA_MACHINES_PRIVATE_METADATA"];
});

describe("agent runtime", () => {
  test("writes and reads heartbeat state", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-agent-"));
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-01";

    const heartbeat = writeHeartbeat("online");
    expect(heartbeat.machineId).toBe("demo-node-01");
    expect(heartbeat.daemonVersion).toEqual(expect.any(String));
    expect(heartbeat.agentMode).toBe("daemon");
    expect(heartbeat.platform).toEqual(expect.any(String));
    expect(heartbeat.arch).toEqual(expect.any(String));
    expect(heartbeat.uptimeSeconds).toEqual(expect.any(Number));
    expect(heartbeat.privateMetadata).toBe(false);

    const statuses = getAgentStatus("demo-node-01");
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses[0]?.status).toBe("online");
    expect(statuses[0]?.toolVersions).toEqual(expect.objectContaining({ bun: expect.any(String) }));
  });

  test("marks current process offline", () => {
    const offline = markOffline();
    expect(offline.status).toBe("offline");
  });

  test("collects doctor summary only when requested", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-agent-doctor-"));
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MANIFEST_PATH"] = join(dir, "machines.json");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-doctor";
    manifestInit();

    const plain = writeHeartbeat("online", { doctorSummary: false });
    expect(plain.doctorSummary).toBeNull();

    const withDoctor = writeHeartbeat("online", { doctorSummary: true });
    expect(withDoctor.doctorSummary).toMatchObject({
      summary: expect.any(Object),
      blockers: expect.any(Array),
    });
  });

  test("redacts public heartbeat metadata and storage errors by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-agent-redacted-"));
    process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
    process.env["HASNA_MACHINES_MACHINE_ID"] = "demo-node-redacted";

    const heartbeat = await writeHeartbeatTick("online", {
      mode: "service",
      storagePush: true,
      storagePushRetries: 0,
      privateMetadata: false,
    });

    expect(heartbeat.storageSyncStatus).toBe("error");
    expect(heartbeat.storageSyncLastError).toContain("Missing");
    expect(heartbeat.agentMode).toBe("service");
  });

  test("allows private metadata only when explicitly enabled", () => {
    expect(sanitizePublicString("host 192.168.1.10 postgres://user:pass@example/db?token=secret", false))
      .toBe("host [redacted-ip] postgres://[redacted]");
    expect(sanitizePublicString("host 192.168.1.10", true)).toBe("host 192.168.1.10");
  });
});
