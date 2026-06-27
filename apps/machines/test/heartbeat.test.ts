import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHeartbeats } from "../src/commands/heartbeat.js";
import { manifestAdd, manifestInit } from "../src/commands/manifest.js";
import { closeDb, listHeartbeats } from "../src/db.js";
import type { MachineCommandRunner } from "../src/remote.js";

const ENV_KEYS = [
  "HASNA_MACHINES_DB_PATH",
  "HASNA_MACHINES_MANIFEST_PATH",
  "HASNA_MACHINES_MACHINE_ID",
] as const;

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

function setupTemp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  process.env.HASNA_MACHINES_DB_PATH = join(dir, "machines.db");
  process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");
  process.env.HASNA_MACHINES_MACHINE_ID = "demo-node-02";
  manifestInit();
  manifestAdd({
    id: "demo-node-01",
    platform: "linux",
    workspacePath: "/home/operator/workspace",
  });
  return dir;
}

describe("heartbeat collection", () => {
  test("imports a public one-shot heartbeat from a routed machine command", () => {
    const dir = setupTemp("machines-heartbeat-collect-");
    try {
      const runner: MachineCommandRunner = (machineId, command) => {
        expect(machineId).toBe("demo-node-01");
        expect(command).not.toContain("HASNA_MACHINES_MACHINE_ID='demo-node-01'");
        expect(command).toContain("unset HASNA_MACHINES_MACHINE_ID");
        expect(command).toContain("machines-agent --once");
        return {
          machineId,
          source: "ssh",
          stdout: `${JSON.stringify({
            machineId: "demo-node-01",
            pid: 123,
            status: "online",
            updatedAt: "2026-06-21T10:31:00.000Z",
            daemonVersion: "0.0.49",
            agentMode: "daemon",
            platform: "linux",
            storageSyncStatus: "disabled",
            privateMetadata: false,
          })}\n`,
          stderr: "",
          exitCode: 0,
        };
      };

      const before = Date.now();
      const results = collectHeartbeats({ machines: ["demo-node-01"] }, runner);
      const after = Date.now();

      expect(results).toEqual([{
        machineId: "demo-node-01",
        status: "imported",
        source: "ssh",
        updatedAt: expect.any(String),
        daemonVersion: "0.0.49",
        storageSyncStatus: "disabled",
        error: null,
      }]);
      expect(listHeartbeats("demo-node-01")[0]).toMatchObject({
        machine_id: "demo-node-01",
        pid: 123,
        status: "online",
        daemon_version: "0.0.49",
      });
      const stored = listHeartbeats("demo-node-01")[0]!;
      expect(Date.parse(stored.updated_at)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(stored.updated_at)).toBeLessThanOrEqual(after);
      expect(Date.parse(stored.observed_at!)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(stored.observed_at!)).toBeLessThanOrEqual(after);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports a failed machine without importing a heartbeat", () => {
    const dir = setupTemp("machines-heartbeat-failed-");
    try {
      const runner: MachineCommandRunner = (machineId) => ({
        machineId,
        source: "ssh",
        stdout: "",
        stderr: "machines-agent not found",
        exitCode: 127,
      });

      const results = collectHeartbeats({ machines: ["demo-node-01"] }, runner);

      expect(results[0]).toMatchObject({
        machineId: "demo-node-01",
        status: "failed",
        source: "ssh",
        error: "machines-agent not found",
      });
      expect(listHeartbeats("demo-node-01")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects a heartbeat from the wrong remote identity", () => {
    const dir = setupTemp("machines-heartbeat-mismatch-");
    try {
      const runner: MachineCommandRunner = (machineId) => ({
        machineId,
        source: "ssh",
        stdout: `${JSON.stringify({
          machineId: "wrong-node",
          pid: 123,
          status: "online",
          updatedAt: "2026-06-21T10:31:00.000Z",
          privateMetadata: false,
        })}\n`,
        stderr: "",
        exitCode: 0,
      });

      const results = collectHeartbeats({ machines: ["demo-node-01"] }, runner);

      expect(results[0]).toMatchObject({
        machineId: "demo-node-01",
        status: "failed",
        source: "ssh",
        error: "heartbeat machine mismatch: expected demo-node-01, got wrong-node",
      });
      expect(listHeartbeats("demo-node-01")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not trust route-facing manifest hostnames as heartbeat identity", () => {
    const dir = setupTemp("machines-heartbeat-route-identity-");
    try {
      manifestAdd({
        id: "demo-node-03",
        hostname: "friendly-host",
        sshAddress: "operator@friendly-host",
        tailscaleName: "friendly-host",
        platform: "linux",
        workspacePath: "/home/operator/workspace",
      });
      const runner: MachineCommandRunner = (machineId) => ({
        machineId,
        source: "ssh",
        stdout: `${JSON.stringify({
          machineId: "friendly-host",
          pid: 123,
          status: "online",
          updatedAt: "2026-06-21T10:31:00.000Z",
          privateMetadata: false,
        })}\n`,
        stderr: "",
        exitCode: 0,
      });

      const results = collectHeartbeats({ machines: ["demo-node-03"] }, runner);

      expect(results[0]).toMatchObject({
        machineId: "demo-node-03",
        status: "failed",
        error: "heartbeat machine mismatch: expected demo-node-03, got friendly-host",
      });
      expect(listHeartbeats("demo-node-03")).toEqual([]);
      expect(listHeartbeats("friendly-host")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("accepts a declared heartbeat alias but stores the canonical machine id", () => {
    const dir = setupTemp("machines-heartbeat-metadata-alias-");
    try {
      manifestAdd({
        id: "demo-node-04",
        platform: "macos",
        workspacePath: "/Users/operator/Workspace",
        metadata: {
          heartbeatAliases: ["MacBook-Pro"],
        },
      });
      const runner: MachineCommandRunner = (machineId) => ({
        machineId,
        source: "ssh",
        stdout: `${JSON.stringify({
          machineId: "MacBook-Pro",
          pid: 321,
          status: "online",
          updatedAt: "2026-06-21T10:31:00.000Z",
          privateMetadata: false,
        })}\n`,
        stderr: "",
        exitCode: 0,
      });

      const results = collectHeartbeats({ machines: ["demo-node-04"] }, runner);

      expect(results[0]).toMatchObject({
        machineId: "demo-node-04",
        status: "imported",
      });
      expect(listHeartbeats("demo-node-04")[0]).toMatchObject({
        machine_id: "demo-node-04",
        pid: 321,
        status: "online",
      });
      expect(listHeartbeats("MacBook-Pro")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects explicit collection by heartbeat alias instead of canonical id", () => {
    const dir = setupTemp("machines-heartbeat-explicit-alias-");
    try {
      manifestAdd({
        id: "demo-node-04",
        platform: "macos",
        workspacePath: "/Users/operator/Workspace",
        metadata: {
          heartbeatAliases: ["MacBook-Pro"],
        },
      });
      const runner: MachineCommandRunner = () => {
        throw new Error("runner should not be called for non-canonical ids");
      };

      const results = collectHeartbeats({ machines: ["MacBook-Pro"] }, runner);

      expect(results[0]).toMatchObject({
        machineId: "MacBook-Pro",
        status: "failed",
        source: null,
        error: "heartbeat collection requires a canonical manifest machine id",
      });
      expect(listHeartbeats("demo-node-04")).toEqual([]);
      expect(listHeartbeats("MacBook-Pro")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("canonicalizes explicit local collection aliases to the local machine id", () => {
    const dir = setupTemp("machines-heartbeat-local-alias-");
    try {
      const runner: MachineCommandRunner = (machineId) => ({
        machineId,
        source: "local",
        stdout: `${JSON.stringify({
          machineId: "demo-node-02",
          pid: 456,
          status: "online",
          updatedAt: "2026-06-21T10:31:00.000Z",
          privateMetadata: false,
        })}\n`,
        stderr: "",
        exitCode: 0,
      });

      const results = collectHeartbeats({ machines: ["localhost"] }, runner);

      expect(results[0]).toMatchObject({
        machineId: "demo-node-02",
        status: "imported",
        source: "local",
      });
      expect(listHeartbeats("demo-node-02")[0]).toMatchObject({
        machine_id: "demo-node-02",
        pid: 456,
        status: "online",
      });
      expect(listHeartbeats("localhost")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects private heartbeat metadata", () => {
    const dir = setupTemp("machines-heartbeat-private-");
    try {
      const runner: MachineCommandRunner = (machineId) => ({
        machineId,
        source: "ssh",
        stdout: `${JSON.stringify({
          machineId: "demo-node-01",
          pid: 123,
          status: "online",
          updatedAt: "2026-06-21T10:31:00.000Z",
          privateMetadata: true,
        })}\n`,
        stderr: "",
        exitCode: 0,
      });

      const results = collectHeartbeats({ machines: ["demo-node-01"] }, runner);

      expect(results[0]).toMatchObject({
        machineId: "demo-node-01",
        status: "failed",
        error: "private heartbeat metadata refused for demo-node-01",
      });
      expect(listHeartbeats("demo-node-01")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("keeps collecting after a runner throws for one machine", () => {
    const dir = setupTemp("machines-heartbeat-throw-");
    try {
      const runner: MachineCommandRunner = (machineId) => {
        if (machineId === "demo-node-01") throw new Error("route failed for token=secret");
        return {
          machineId,
          source: "ssh",
          stdout: `${JSON.stringify({
            machineId,
            pid: 456,
            status: "online",
            updatedAt: "2026-06-21T10:31:00.000Z",
            privateMetadata: false,
          })}\n`,
          stderr: "",
          exitCode: 0,
        };
      };

      const results = collectHeartbeats({ machines: ["demo-node-01", "demo-node-02"] }, runner);

      expect(results[0]).toMatchObject({ machineId: "demo-node-01", status: "failed" });
      expect(results[0]?.error).toContain("[redacted]");
      expect(results[1]).toMatchObject({ machineId: "demo-node-02", status: "imported" });
      expect(listHeartbeats("demo-node-02")[0]?.pid).toBe(456);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
