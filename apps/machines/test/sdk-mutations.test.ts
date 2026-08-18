import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as machines from "../src/index.js";
import * as storage from "../src/storage.js";
import { closeDb } from "../src/db.js";
import { createTrustedSdkMutationApproval } from "../src/commands/mutation-approval.js";
import type { SetupResult } from "../src/types.js";

const ENV_KEYS = [
  "HASNA_MACHINES_DIR",
  "HASNA_MACHINES_MANIFEST_PATH",
  "HASNA_MACHINES_DB_PATH",
  "HASNA_MACHINES_DATABASE_URL",
  "HASNA_MACHINES_MUTATION_TOKEN",
] as const;

function withTempEnv(prefix: string): { dir: string; manifestPath: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const manifestPath = join(dir, "machines.json");
  const dbPath = join(dir, "machines.db");
  process.env.HASNA_MACHINES_DIR = dir;
  process.env.HASNA_MACHINES_MANIFEST_PATH = manifestPath;
  process.env.HASNA_MACHINES_DB_PATH = dbPath;
  writeFileSync(manifestPath, JSON.stringify({ version: 1, machines: [] }, null, 2), "utf8");
  return { dir, manifestPath, dbPath };
}

function readManifestIds(path: string): string[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { machines: Array<{ id: string }> }).machines.map((machine) => machine.id);
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
    expect("writeManifest" in machines).toBe(false);
    expect("getDb" in machines).toBe(false);
    expect("upsertHeartbeat" in machines).toBe(false);
    expect("writeHeartbeat" in machines).toBe(false);
    expect("watchTmuxPane" in machines).toBe(false);
    expect("getStoragePg" in machines).toBe(false);
    expect("PgAdapterAsync" in machines).toBe(false);
    expect("createTrustedSdkMutationApproval" in machines).toBe(false);

    expect("getStoragePg" in storage).toBe(false);
    expect("PgAdapterAsync" in storage).toBe(false);
  });

  test("root manifest mutators require SDK-scoped approval", () => {
    const { dir, manifestPath } = withTempEnv("machines-sdk-manifest-");
    try {
      const machine = { id: "sdk-node-01", platform: "linux" as const, workspacePath: "/workspace" };

      expect(() => machines.manifestAdd(machine)).toThrow("sdk.machines_manifest_add requires");
      expect(readManifestIds(manifestPath)).toEqual([]);

      expect(() => machines.manifestAdd(machine, { trustedLocalMutation: true as never })).toThrow("sdk.machines_manifest_add requires");
      expect(readManifestIds(manifestPath)).toEqual([]);

      machines.manifestAdd(machine, trustedSdkMutation());
      expect(readManifestIds(manifestPath)).toEqual(["sdk-node-01"]);

      expect(() => machines.manifestRemove("sdk-node-01")).toThrow("sdk.machines_manifest_remove requires");
      expect(readManifestIds(manifestPath)).toEqual(["sdk-node-01"]);

      machines.manifestRemove("sdk-node-01", trustedSdkMutation());
      expect(readManifestIds(manifestPath)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("heartbeat collection exposes public SDK approval helpers", () => {
    const { dir } = withTempEnv("machines-sdk-heartbeat-collect-");
    try {
      process.env.HASNA_MACHINES_MUTATION_TOKEN = "sdk-mutation-test-token-not-a-credential";
      const options = { machines: ["unknown"] };

      expect("HEARTBEAT_COLLECT_MUTATION_OPERATION" in machines).toBe(true);
      expect("heartbeatCollectMutationArgs" in machines).toBe(true);
      expect("heartbeatCollectResourceId" in machines).toBe(true);
      expect(() => machines.collectHeartbeats(options)).toThrow("sdk.machines_heartbeat_collect requires");

      const token = machines.createMutationApprovalToken({
        surface: "sdk",
        operation: machines.HEARTBEAT_COLLECT_MUTATION_OPERATION,
        transport: "sdk",
        callerId: "sdk-test",
        runId: "sdk-test",
        resourceId: machines.heartbeatCollectResourceId(options),
        args: machines.heartbeatCollectMutationArgs(options),
      }, { env: process.env, now: Date.now(), nonce: "sdk-heartbeat-collect" });
      const result = machines.collectHeartbeats({
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
    const { dir, manifestPath } = withTempEnv("machines-sdk-friendly-name-");
    try {
      const machine = { id: "sdk-friendly-node", platform: "linux" as const, workspacePath: "/workspace" };
      machines.manifestAdd(machine, trustedSdkMutation());

      expect(() => machines.manifestSetFriendlyName({
        machineId: "sdk-friendly-node",
        friendlyName: "SDK Studio",
      })).toThrow("sdk.machines_friendly_name_set requires");
      expect(JSON.parse(readFileSync(manifestPath, "utf8")).machines[0].friendlyName).toBeUndefined();

      const set = machines.manifestSetFriendlyName({
        machineId: "sdk-friendly-node",
        friendlyName: "SDK Studio",
      }, trustedSdkMutation());
      expect(set).toMatchObject({
        machine_id: "sdk-friendly-node",
        friendly_name: "SDK Studio",
        display_name: "SDK Studio",
      });
      expect(readManifestIds(manifestPath)).toEqual(["sdk-friendly-node"]);

      expect(() => machines.manifestClearFriendlyName({ machineId: "sdk-friendly-node" })).toThrow("sdk.machines_friendly_name_clear requires");
      const cleared = machines.manifestClearFriendlyName({ machineId: "sdk-friendly-node" }, trustedSdkMutation());
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
    const { dir, manifestPath } = withTempEnv("machines-sdk-token-");
    try {
      process.env.HASNA_MACHINES_MUTATION_TOKEN = "sdk-mutation-test-token-not-a-credential";
      const now = Date.now();
      const machine = { id: "sdk-token-node", platform: "linux" as const, workspacePath: "/workspace" };
      const token = machines.createMutationApprovalToken({
        surface: "sdk",
        operation: "machines_manifest_add",
        machineId: machine.id,
        resourceId: `manifest:machine:${machine.id}`,
        callerId: "sdk-test",
        runId: "run-sdk-token",
        transport: "sdk",
        args: machine,
      }, { env: process.env, now, nonce: "sdk-token-001" });
      const wrongMachine = { ...machine, id: "other-node" };

      expect(() => machines.manifestAdd(wrongMachine, {
        approvalToken: token,
        callerId: "sdk-test",
        runId: "run-sdk-token",
      })).toThrow("requires a scoped SDK approval token");
      expect(readManifestIds(manifestPath)).toEqual([]);

      machines.manifestAdd(machine, {
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
    const { dir } = withTempEnv("machines-sdk-project-assignments-");
    try {
      const machine = { id: "sdk-project-node", platform: "linux" as const, workspacePath: "/workspace" };
      machines.manifestAdd(machine, trustedSdkMutation());

      const input = {
        machineId: "sdk-project-node",
        projectId: "machines",
        path: "/workspace/machines",
        label: "sdk-project-node",
        kind: "machine-local",
        primary: true,
      };
      expect(() => machines.assignMachineProject(input)).toThrow("sdk.machines_projects_assign requires");
      expect(machines.listMachineProjectAssignments().assignments).toEqual([]);

      const assigned = machines.assignMachineProject(input, trustedSdkMutation());
      expect(assigned.assignments[0]).toMatchObject({
        machine_id: "sdk-project-node",
        project_id: "machines",
        path: "/workspace/machines",
      });

      expect(() => machines.removeMachineProjectAssignment({
        machineId: "sdk-project-node",
        projectId: "machines",
      })).toThrow("sdk.machines_projects_unassign requires");
      expect(machines.listMachineProjectAssignments().assignments).toHaveLength(1);

      machines.removeMachineProjectAssignment({
        machineId: "sdk-project-node",
        projectId: "machines",
      }, trustedSdkMutation());
      expect(machines.listMachineProjectAssignments().assignments).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("SDK approval ignores caller-supplied env and now values", () => {
    const { dir, manifestPath } = withTempEnv("machines-sdk-forged-env-");
    try {
      const forgedEnv = { HASNA_MACHINES_MUTATION_TOKEN: "caller-controlled-secret" };
      const now = Date.now();
      const machine = { id: "sdk-forged-node", platform: "linux" as const, workspacePath: "/workspace" };
      const token = machines.createMutationApprovalToken({
        surface: "sdk",
        operation: "machines_manifest_add",
        machineId: machine.id,
        resourceId: `manifest:machine:${machine.id}`,
        callerId: "sdk-test",
        runId: "run-sdk-forged",
        transport: "sdk",
        args: machine,
      }, { env: forgedEnv, now, nonce: "sdk-forged-env" });

      expect(() => machines.manifestAdd(machine, {
        approvalToken: token,
        env: forgedEnv,
        now,
        callerId: "sdk-test",
        runId: "run-sdk-forged",
      } as unknown as machines.SdkMutationApprovalOptions)).toThrow("requires a scoped SDK approval token");
      expect(readManifestIds(manifestPath)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("SDK approval ignores caller-supplied time for expired tokens", () => {
    const { dir, manifestPath } = withTempEnv("machines-sdk-expired-token-");
    try {
      process.env.HASNA_MACHINES_MUTATION_TOKEN = "sdk-mutation-test-token-not-a-credential";
      const issuedAt = Date.now() - 10 * 60 * 1000;
      const machine = { id: "sdk-expired-node", platform: "linux" as const, workspacePath: "/workspace" };
      const token = machines.createMutationApprovalToken({
        surface: "sdk",
        operation: "machines_manifest_add",
        machineId: machine.id,
        resourceId: `manifest:machine:${machine.id}`,
        callerId: "sdk-test",
        runId: "run-sdk-expired",
        transport: "sdk",
        args: machine,
      }, { env: process.env, now: issuedAt, nonce: "sdk-expired-token" });

      expect(() => machines.manifestAdd(machine, {
        approvalToken: token,
        now: issuedAt,
        callerId: "sdk-test",
        runId: "run-sdk-expired",
      } as unknown as machines.SdkMutationApprovalOptions)).toThrow("requires a scoped SDK approval token");
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

    expect(() => machines.runSetupPlan(plan, { apply: true, yes: true }, runner)).toThrow("sdk.machines_setup_apply requires");
    expect(calls).toEqual([]);

    const applied = machines.runSetupPlan(plan, { apply: true, yes: true, ...trustedSdkMutation() }, runner);
    expect(applied.mode).toBe("apply");
    expect(calls).toEqual(["touch /tmp/should-not-run"]);
  });

  test("daemon, DNS, cert, and backup mutators require SDK approval before side effects", () => {
    const { dir } = withTempEnv("machines-sdk-local-mutators-");
    const daemonPath = join(dir, "service.plist");
    const daemonPlan: machines.DaemonServicePlan = {
      platform: "linux",
      mode: "user",
      action: "install",
      serviceName: "machines-test",
      serviceId: "machines-test",
      executable: "/bin/true",
      intervalMs: 1000,
      commands: [],
      files: [{ id: "unit", description: "unit", path: daemonPath, mode: "0644", content: "unit" }],
      warnings: [],
      manualSteps: [],
    };

    try {
      expect(() => machines.runDaemonServicePlan(daemonPlan, { apply: true, yes: true })).toThrow("sdk.machines_daemon_apply requires");
      expect(existsSync(daemonPath)).toBe(false);

      const daemon = machines.runDaemonServicePlan(daemonPlan, { apply: true, yes: true, ...trustedSdkMutation() });
      expect(daemon.applied).toBe(true);
      expect(existsSync(daemonPath)).toBe(true);

      expect(() => machines.addDomainMapping("sdk.localhost", 8821)).toThrow("sdk.machines_dns_add_domain_mapping requires");
      expect(existsSync(join(dir, "dns.json"))).toBe(false);
      machines.addDomainMapping("sdk.localhost", 8821, "127.0.0.1", trustedSdkMutation());
      expect(existsSync(join(dir, "dns.json"))).toBe(true);

      expect(() => machines.runCertPlan(["sdk.localhost"], { apply: true, yes: true })).toThrow("sdk.machines_cert_apply requires");
      expect(() => machines.runBackup("bucket", "prefix", { apply: true, yes: true })).toThrow("sdk.machines_backup_apply requires");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("notification SDK writes and deliveries require approval", async () => {
    const { dir } = withTempEnv("machines-sdk-notifications-");
    const notificationsPath = join(dir, "notifications.json");
    process.env.HASNA_MACHINES_NOTIFICATIONS_PATH = notificationsPath;

    try {
      const config = {
        version: 1 as const,
        channels: [{ id: "webhook", type: "webhook" as const, target: "https://example.com/hook", events: ["manual.test"], enabled: true }],
      };
      expect(() => machines.writeNotificationConfig(config)).toThrow("sdk.machines_notifications_write_config requires");
      expect(existsSync(notificationsPath)).toBe(false);

      machines.writeNotificationConfig(config, trustedSdkMutation());
      expect(existsSync(notificationsPath)).toBe(true);

      await expect(machines.testNotificationChannel("webhook", "manual.test", "hello", { apply: true, yes: true }))
        .rejects.toThrow("sdk.machines_notifications_test_channel requires");
      await expect(machines.dispatchNotificationEvent("manual.test", "hello", { channelId: "webhook" }))
        .rejects.toThrow("sdk.machines_notifications_dispatch requires");
      expect(() => machines.removeNotificationChannel("webhook")).toThrow("sdk.machines_notifications_remove_channel requires");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("storage mutators deny before database or adapter I/O", async () => {
    const { dir } = withTempEnv("machines-sdk-storage-");
    process.env.HASNA_MACHINES_DATABASE_URL = "postgres://user:pass@127.0.0.1:1/machines";
    const calls: string[] = [];
    const adapter: storage.StorageMigrationAdapter = {
      async run(sql: string) {
        calls.push(sql);
      },
    };

    try {
      await expect(storage.storagePush({ tables: ["agent_heartbeats"] })).rejects.toThrow("sdk.machines_storage_push requires");
      await expect(storage.storagePull({ tables: ["agent_heartbeats"] })).rejects.toThrow("sdk.machines_storage_pull requires");
      await expect(storage.storageSync({ tables: ["agent_heartbeats"] })).rejects.toThrow("sdk.machines_storage_sync requires");
      await expect(storage.runStorageMigrations(adapter)).rejects.toThrow("sdk.machines_storage_migrate requires");
      expect(calls).toEqual([]);

      await storage.runStorageMigrations(adapter, trustedSdkMutation());
      expect(calls.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
