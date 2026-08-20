import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/db.js";
import { manifestInit } from "../src/commands/manifest.js";
import { getAgentStatus, markOffline, sanitizePublicString, writeHeartbeat, writeHeartbeatTick } from "../src/agent/runtime.js";

afterEach(() => {
  closeDb();
  delete process.env["HASNA_STATIONS_DB_PATH"];
  delete process.env["HASNA_STATIONS_MANIFEST_PATH"];
  delete process.env["HASNA_STATIONS_MACHINE_ID"];
  delete process.env["HASNA_STATIONS_DATABASE_URL"];
  delete process.env["STATIONS_DATABASE_URL"];
  delete process.env["HASNA_STATIONS_PRIVATE_METADATA"];
});

describe("agent runtime", () => {
  test("writes and reads heartbeat state", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-agent-"));
    process.env["HASNA_STATIONS_DB_PATH"] = join(dir, "stations.db");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "demo-node-01";

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

  test("keeps the running daemon version after an in-place upgrade", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-agent-version-"));
    process.env["HASNA_STATIONS_DB_PATH"] = join(dir, "stations.db");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "demo-node-version";
    const packageUrl = new URL("../package.json", import.meta.url);
    const packageJson = readFileSync(packageUrl, "utf8");
    const parsedPackage = JSON.parse(packageJson) as Record<string, unknown> & { version: string };
    const runningVersion = parsedPackage.version;
    const upgradedVersion = `${runningVersion}-upgraded`;

    try {
      writeFileSync(packageUrl, `${JSON.stringify({ ...parsedPackage, version: upgradedVersion }, null, 2)}\n`);
      expect(writeHeartbeat("online").daemonVersion).toBe(runningVersion);
    } finally {
      writeFileSync(packageUrl, packageJson);
    }
  });

  test("marks current process offline", () => {
    const offline = markOffline();
    expect(offline.status).toBe("offline");
  });

  test("collects doctor summary only when requested", () => {
    const dir = mkdtempSync(join(tmpdir(), "stations-agent-doctor-"));
    process.env["HASNA_STATIONS_DB_PATH"] = join(dir, "stations.db");
    process.env["HASNA_STATIONS_MANIFEST_PATH"] = join(dir, "stations.json");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "demo-node-doctor";
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
    const dir = mkdtempSync(join(tmpdir(), "stations-agent-redacted-"));
    process.env["HASNA_STATIONS_DB_PATH"] = join(dir, "stations.db");
    process.env["HASNA_STATIONS_MACHINE_ID"] = "demo-node-redacted";

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
