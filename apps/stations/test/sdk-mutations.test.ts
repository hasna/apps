import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as stations from "../src/index.js";
import * as storage from "../src/storage.js";
import { closeDb } from "../src/db.js";
import { createTrustedSdkMutationApproval } from "../src/commands/mutation-approval.js";
import type { SetupResult } from "../src/types.js";

const ENV_KEYS = [
  "HASNA_STATIONS_DIR",
  "HASNA_STATIONS_MANIFEST_PATH",
  "HASNA_STATIONS_DB_PATH",
  "HASNA_STATIONS_DATABASE_URL",
  "HASNA_STATIONS_MUTATION_TOKEN",
] as const;

function withTempEnv(prefix: string): { dir: string; manifestPath: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const manifestPath = join(dir, "stations.json");
  const dbPath = join(dir, "stations.db");
  process.env.HASNA_STATIONS_DIR = dir;
  process.env.HASNA_STATIONS_MANIFEST_PATH = manifestPath;
  process.env.HASNA_STATIONS_DB_PATH = dbPath;
  writeFileSync(manifestPath, JSON.stringify({ version: 1, stations: [] }, null, 2), "utf8");
  return { dir, manifestPath, dbPath };
}

function readManifestIds(path: string): string[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { stations: Array<{ id: string }> }).stations.map((machine) => machine.id);
}

function trustedSdkMutation() {
  return { trustedLocalMutation: createTrustedSdkMutationApproval() };
}

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("published SDK mutation boundary", () => {
  test("does not expose raw writer primitives from root or storage entrypoints", () => {
    expect("writeManifest" in stations).toBe(false);
    expect("getDb" in stations).toBe(false);
    expect("upsertHeartbeat" in stations).toBe(false);
    expect("writeHeartbeat" in stations).toBe(false);
    expect("watchTmuxPane" in stations).toBe(false);
    expect("getStoragePg" in stations).toBe(false);
    expect("PgAdapterAsync" in stations).toBe(false);
    expect("createTrustedSdkMutationApproval" in stations).toBe(false);

    expect("getStoragePg" in storage).toBe(false);
    expect("PgAdapterAsync" in storage).toBe(false);
  });

  test("root manifest mutators require SDK-scoped approval", () => {
    const { dir, manifestPath } = withTempEnv("stations-sdk-manifest-");
    try {
      const machine = { id: "sdk-node-01", platform: "linux" as const, workspacePath: "/workspace" };

      expect(() => stations.manifestAdd(machine)).toThrow("sdk.stations_manifest_add requires");
      expect(readManifestIds(manifestPath)).toEqual([]);

      expect(() => stations.manifestAdd(machine, { trustedLocalMutation: true as never })).toThrow("sdk.stations_manifest_add requires");
      expect(readManifestIds(manifestPath)).toEqual([]);

      stations.manifestAdd(machine, trustedSdkMutation());
      expect(readManifestIds(manifestPath)).toEqual(["sdk-node-01"]);

      expect(() => stations.manifestRemove("sdk-node-01")).toThrow("sdk.stations_manifest_remove requires");
      expect(readManifestIds(manifestPath)).toEqual(["sdk-node-01"]);

      stations.manifestRemove("sdk-node-01", trustedSdkMutation());
      expect(readManifestIds(manifestPath)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("heartbeat collection exposes public SDK approval helpers", () => {
    const { dir } = withTempEnv("stations-sdk-heartbeat-collect-");
    try {
      process.env.HASNA_STATIONS_MUTATION_TOKEN = "sdk-mutation-test-token-not-a-credential";
      const options = { stations: ["unknown"] };

      expect("HEARTBEAT_COLLECT_MUTATION_OPERATION" in stations).toBe(true);
      expect("heartbeatCollectMutationArgs" in stations).toBe(true);
      expect("heartbeatCollectResourceId" in stations).toBe(true);
      expect(() => stations.collectHeartbeats(options)).toThrow("sdk.stations_heartbeat_collect requires");

      const token = stations.createMutationApprovalToken({
        surface: "sdk",
        operation: stations.HEARTBEAT_COLLECT_MUTATION_OPERATION,
        transport: "sdk",
        callerId: "sdk-test",
        runId: "sdk-test",
        resourceId: stations.heartbeatCollectResourceId(options),
        args: stations.heartbeatCollectMutationArgs(options),
      }, { env: process.env, now: Date.now(), nonce: "sdk-heartbeat-collect" });
      const result = stations.collectHeartbeats({
        ...options,
        approvalToken: token,
        callerId: "sdk-test",
        runId: "sdk-test",
      });

      expect(result[0]).toMatchObject({
        machineId: "unknown",
        status: "failed",
        error: "heartbeat collection requires a canonical manifest machine id",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("friendly-name SDK mutators require scoped approval and preserve machine slug", () => {
    const { dir, manifestPath } = withTempEnv("stations-sdk-friendly-name-");
    try {
      const machine = { id: "sdk-friendly-node", platform: "linux" as const, workspacePath: "/workspace" };
      stations.manifestAdd(machine, trustedSdkMutation());

      expect(() => stations.manifestSetFriendlyName({
        machineId: "sdk-friendly-node",
        friendlyName: "SDK Studio",
      })).toThrow("sdk.stations_friendly_name_set requires");
      expect(JSON.parse(readFileSync(manifestPath, "utf8")).stations[0].friendlyName).toBeUndefined();

      const set = stations.manifestSetFriendlyName({
        machineId: "sdk-friendly-node",
        friendlyName: "SDK Studio",
      }, trustedSdkMutation());
      expect(set).toMatchObject({
        machine_id: "sdk-friendly-node",
        friendly_name: "SDK Studio",
        display_name: "SDK Studio",
      });
      expect(readManifestIds(manifestPath)).toEqual(["sdk-friendly-node"]);

      expect(() => stations.manifestClearFriendlyName({ machineId: "sdk-friendly-node" })).toThrow("sdk.stations_friendly_name_clear requires");
      const cleared = stations.manifestClearFriendlyName({ machineId: "sdk-friendly-node" }, trustedSdkMutation());
      expect(cleared).toMatchObject({
        machine_id: "sdk-friendly-node",
        friendly_name: null,
        display_name: "sdk-friendly-node",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("SDK scoped token authorizes only the bound manifest mutation", () => {
    const { dir, manifestPath } = withTempEnv("stations-sdk-token-");
    try {
      process.env.HASNA_STATIONS_MUTATION_TOKEN = "sdk-mutation-test-token-not-a-credential";
      const now = Date.now();
      const machine = { id: "sdk-token-node", platform: "linux" as const, workspacePath: "/workspace" };
      const token = stations.createMutationApprovalToken({
        surface: "sdk",
        operation: "stations_manifest_add",
        machineId: machine.id,
        resourceId: `manifest:machine:${machine.id}`,
        callerId: "sdk-test",
        runId: "run-sdk-token",
        transport: "sdk",
        args: machine,
      }, { env: process.env, now, nonce: "sdk-token-001" });
      const wrongMachine = { ...machine, id: "other-node" };

      expect(() => stations.manifestAdd(wrongMachine, {
        approvalToken: token,
        callerId: "sdk-test",
        runId: "run-sdk-token",
      })).toThrow("requires a scoped SDK approval token");
      expect(readManifestIds(manifestPath)).toEqual([]);

      stations.manifestAdd(machine, {
        approvalToken: token,
        callerId: "sdk-test",
        runId: "run-sdk-token",
      });
      expect(readManifestIds(manifestPath)).toEqual(["sdk-token-node"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("project assignment SDK mutators require scoped approval", () => {
    const { dir } = withTempEnv("stations-sdk-project-assignments-");
    try {
      const machine = { id: "sdk-project-node", platform: "linux" as const, workspacePath: "/workspace" };
      stations.manifestAdd(machine, trustedSdkMutation());

      const input = {
        machineId: "sdk-project-node",
        projectId: "stations",
        path: "/workspace/stations",
        label: "sdk-project-node",
        kind: "machine-local",
        primary: true,
      };
      expect(() => stations.assignMachineProject(input)).toThrow("sdk.stations_projects_assign requires");
      expect(stations.listMachineProjectAssignments().assignments).toEqual([]);

      const assigned = stations.assignMachineProject(input, trustedSdkMutation());
      expect(assigned.assignments[0]).toMatchObject({
        machine_id: "sdk-project-node",
        project_id: "stations",
        path: "/workspace/stations",
      });

      expect(() => stations.removeMachineProjectAssignment({
        machineId: "sdk-project-node",
        projectId: "stations",
      })).toThrow("sdk.stations_projects_unassign requires");
      expect(stations.listMachineProjectAssignments().assignments).toHaveLength(1);

      stations.removeMachineProjectAssignment({
        machineId: "sdk-project-node",
        projectId: "stations",
      }, trustedSdkMutation());
      expect(stations.listMachineProjectAssignments().assignments).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("SDK approval ignores caller-supplied env and now values", () => {
    const { dir, manifestPath } = withTempEnv("stations-sdk-forged-env-");
    try {
      const forgedEnv = { HASNA_STATIONS_MUTATION_TOKEN: "caller-controlled-secret" };
      const now = Date.now();
      const machine = { id: "sdk-forged-node", platform: "linux" as const, workspacePath: "/workspace" };
      const token = stations.createMutationApprovalToken({
        surface: "sdk",
        operation: "stations_manifest_add",
        machineId: machine.id,
        resourceId: `manifest:machine:${machine.id}`,
        callerId: "sdk-test",
        runId: "run-sdk-forged",
        transport: "sdk",
        args: machine,
      }, { env: forgedEnv, now, nonce: "sdk-forged-env" });

      expect(() => stations.manifestAdd(machine, {
        approvalToken: token,
        env: forgedEnv,
        now,
        callerId: "sdk-test",
        runId: "run-sdk-forged",
      } as unknown as stations.SdkMutationApprovalOptions)).toThrow("requires a scoped SDK approval token");
      expect(readManifestIds(manifestPath)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("SDK approval ignores caller-supplied time for expired tokens", () => {
    const { dir, manifestPath } = withTempEnv("stations-sdk-expired-token-");
    try {
      process.env.HASNA_STATIONS_MUTATION_TOKEN = "sdk-mutation-test-token-not-a-credential";
      const issuedAt = Date.now() - 10 * 60 * 1000;
      const machine = { id: "sdk-expired-node", platform: "linux" as const, workspacePath: "/workspace" };
      const token = stations.createMutationApprovalToken({
        surface: "sdk",
        operation: "stations_manifest_add",
        machineId: machine.id,
        resourceId: `manifest:machine:${machine.id}`,
        callerId: "sdk-test",
        runId: "run-sdk-expired",
        transport: "sdk",
        args: machine,
      }, { env: process.env, now: issuedAt, nonce: "sdk-expired-token" });

      expect(() => stations.manifestAdd(machine, {
        approvalToken: token,
        now: issuedAt,
        callerId: "sdk-test",
        runId: "run-sdk-expired",
      } as unknown as stations.SdkMutationApprovalOptions)).toThrow("requires a scoped SDK approval token");
      expect(readManifestIds(manifestPath)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("apply plan helpers deny import-based execution before runners or file writes", () => {
    const plan: SetupResult = {
      machineId: "sdk-apply-node",
      mode: "plan",
      steps: [{ id: "marker", title: "marker", command: "touch /tmp/should-not-run", manager: "shell" }],
      executed: 0,
    };
    const calls: string[] = [];
    const runner = (_machineId: string, command: string) => {
      calls.push(command);
      return { machineId: "sdk-apply-node", command, source: "local" as const, exitCode: 0, stdout: "", stderr: "" };
    };

    expect(() => stations.runSetupPlan(plan, { apply: true, yes: true }, runner)).toThrow("sdk.stations_setup_apply requires");
    expect(calls).toEqual([]);

    const applied = stations.runSetupPlan(plan, { apply: true, yes: true, ...trustedSdkMutation() }, runner);
    expect(applied.mode).toBe("apply");
    expect(calls).toEqual(["touch /tmp/should-not-run"]);
  });

  test("daemon, DNS, cert, and backup mutators require SDK approval before side effects", () => {
    const { dir } = withTempEnv("stations-sdk-local-mutators-");
    const daemonPath = join(dir, "service.plist");
    const daemonPlan: stations.DaemonServicePlan = {
      platform: "linux",
      mode: "user",
      action: "install",
      serviceName: "stations-test",
      serviceId: "stations-test",
      executable: "/bin/true",
      intervalMs: 1000,
      commands: [],
      files: [{ id: "unit", description: "unit", path: daemonPath, mode: "0644", content: "unit" }],
      warnings: [],
      manualSteps: [],
    };

    try {
      expect(() => stations.runDaemonServicePlan(daemonPlan, { apply: true, yes: true })).toThrow("sdk.stations_daemon_apply requires");
      expect(existsSync(daemonPath)).toBe(false);

      const daemon = stations.runDaemonServicePlan(daemonPlan, { apply: true, yes: true, ...trustedSdkMutation() });
      expect(daemon.applied).toBe(true);
      expect(existsSync(daemonPath)).toBe(true);

      expect(() => stations.addDomainMapping("sdk.localhost", 8821)).toThrow("sdk.stations_dns_add_domain_mapping requires");
      expect(existsSync(join(dir, "dns.json"))).toBe(false);
      stations.addDomainMapping("sdk.localhost", 8821, "127.0.0.1", trustedSdkMutation());
      expect(existsSync(join(dir, "dns.json"))).toBe(true);

      expect(() => stations.runCertPlan(["sdk.localhost"], { apply: true, yes: true })).toThrow("sdk.stations_cert_apply requires");
      expect(() => stations.runBackup("bucket", "prefix", { apply: true, yes: true })).toThrow("sdk.stations_backup_apply requires");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("notification SDK writes and deliveries require approval", async () => {
    const { dir } = withTempEnv("stations-sdk-notifications-");
    const notificationsPath = join(dir, "notifications.json");
    process.env.HASNA_STATIONS_NOTIFICATIONS_PATH = notificationsPath;

    try {
      const config = {
        version: 1 as const,
        channels: [{ id: "webhook", type: "webhook" as const, target: "https://example.com/hook", events: ["manual.test"], enabled: true }],
      };
      expect(() => stations.writeNotificationConfig(config)).toThrow("sdk.stations_notifications_write_config requires");
      expect(existsSync(notificationsPath)).toBe(false);

      stations.writeNotificationConfig(config, trustedSdkMutation());
      expect(existsSync(notificationsPath)).toBe(true);

      await expect(stations.testNotificationChannel("webhook", "manual.test", "hello", { apply: true, yes: true }))
        .rejects.toThrow("sdk.stations_notifications_test_channel requires");
      await expect(stations.dispatchNotificationEvent("manual.test", "hello", { channelId: "webhook" }))
        .rejects.toThrow("sdk.stations_notifications_dispatch requires");
      expect(() => stations.removeNotificationChannel("webhook")).toThrow("sdk.stations_notifications_remove_channel requires");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("storage mutators deny before database or adapter I/O", async () => {
    const { dir } = withTempEnv("stations-sdk-storage-");
    process.env.HASNA_STATIONS_DATABASE_URL = "postgres://user:pass@127.0.0.1:1/stations";
    const calls: string[] = [];
    const adapter: storage.StorageMigrationAdapter = {
      async run(sql: string) {
        calls.push(sql);
      },
    };

    try {
      await expect(storage.storagePush({ tables: ["agent_heartbeats"] })).rejects.toThrow("sdk.stations_storage_push requires");
      await expect(storage.storagePull({ tables: ["agent_heartbeats"] })).rejects.toThrow("sdk.stations_storage_pull requires");
      await expect(storage.storageSync({ tables: ["agent_heartbeats"] })).rejects.toThrow("sdk.stations_storage_sync requires");
      await expect(storage.runStorageMigrations(adapter)).rejects.toThrow("sdk.stations_storage_migrate requires");
      expect(calls).toEqual([]);

      await storage.runStorageMigrations(adapter, trustedSdkMutation());
      expect(calls.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
