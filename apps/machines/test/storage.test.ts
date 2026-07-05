import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeDb,
  listMachineRegistry,
  listRuntimeEvents,
} from "../src/db.js";
import { manifestAdd, manifestInit, manifestRemove } from "../src/commands/manifest.js";
import { createTrustedSdkMutationApproval } from "../src/commands/mutation-approval.js";
import {
  MACHINES_STORAGE_ENV,
  MACHINES_STORAGE_FALLBACK_ENV,
  MACHINES_STORAGE_MODE_ENV,
  MACHINES_STORAGE_MODE_FALLBACK_ENV,
  STORAGE_TABLES,
  getStorageDatabaseEnv,
  getStorageDatabaseUrl,
  getStorageMode,
  getStorageStatus,
  parseStorageTables,
  resolveTables,
  PG_MIGRATIONS,
  recordRuntimeEvent,
  syncMachineRegistryFromManifest,
} from "../src/storage.js";
import {
  MACHINES_DATABASE_ALLOW_INSECURE_TLS_ENV,
  MACHINES_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV,
  sslConfigFor,
} from "../src/remote-storage.js";

const ENV_KEYS = [
  MACHINES_STORAGE_ENV,
  MACHINES_STORAGE_FALLBACK_ENV,
  MACHINES_STORAGE_MODE_ENV,
  MACHINES_STORAGE_MODE_FALLBACK_ENV,
  MACHINES_DATABASE_ALLOW_INSECURE_TLS_ENV,
  MACHINES_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV,
  "HASNA_MACHINES_DB_PATH",
  "HASNA_MACHINES_MANIFEST_PATH",
] as const;

afterEach(() => {
  closeDb();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("machines storage config", () => {
  test("resolves canonical database env, fallback env, and storage mode", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(getStorageDatabaseEnv()).toBeNull();
    expect(getStorageDatabaseUrl()).toBeNull();
    expect(getStorageMode()).toBe("local");

    process.env[MACHINES_STORAGE_FALLBACK_ENV] = "postgres://fallback/machines";
    expect(getStorageDatabaseEnv()?.name).toBe(MACHINES_STORAGE_FALLBACK_ENV);
    expect(getStorageDatabaseUrl()).toBe("postgres://fallback/machines");
    expect(getStorageMode()).toBe("hybrid");

    process.env[MACHINES_STORAGE_ENV] = "postgres://primary/machines";
    expect(getStorageDatabaseEnv()?.name).toBe(MACHINES_STORAGE_ENV);
    expect(getStorageDatabaseUrl()).toBe("postgres://primary/machines");

    process.env[MACHINES_STORAGE_MODE_ENV] = "remote";
    expect(getStorageMode()).toBe("remote");

    process.env[MACHINES_STORAGE_MODE_ENV] = "invalid";
    process.env[MACHINES_STORAGE_MODE_FALLBACK_ENV] = "local";
    expect(getStorageMode()).toBe("local");
  });

  test("exposes and validates storage tables", () => {
    expect(STORAGE_TABLES).toEqual(["machine_registry", "agent_heartbeats", "runtime_events", "setup_runs", "sync_runs"]);
    expect(resolveTables()).toEqual([...STORAGE_TABLES]);
    expect(parseStorageTables("machine_registry,runtime_events")).toEqual(["machine_registry", "runtime_events"]);
    expect(() => resolveTables(["missing"])).toThrow("Unknown machines storage table");
  });

  test("postgres migrations add cloud registry, heartbeat, and runtime event tables compatibly", () => {
    const migrationSql = PG_MIGRATIONS.join("\n");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS machine_registry");
    expect(migrationSql).toContain("machine_id TEXT PRIMARY KEY");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS runtime_events");
    expect(migrationSql).toContain("event_id TEXT PRIMARY KEY");
    expect(migrationSql).toContain("CREATE INDEX IF NOT EXISTS runtime_events_machine_updated_at_idx");
    expect(migrationSql).toContain("ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS daemon_version TEXT");
    expect(migrationSql).toContain("ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS tool_versions_json TEXT");
    expect(migrationSql).toContain("ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS tailscale_json TEXT");
    expect(migrationSql).toContain("ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS doctor_summary_json TEXT");
    expect(migrationSql).toContain("ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS private_metadata INTEGER NOT NULL DEFAULT 0");
    expect(migrationSql).toContain("ALTER TABLE agent_heartbeats ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ");
  });

  test("postgres remote storage verifies TLS by default", () => {
    expect(sslConfigFor("postgres://example/machines", {})).toEqual({ rejectUnauthorized: true });
    expect(sslConfigFor("postgres://example/machines?sslmode=require", {})).toEqual({ rejectUnauthorized: true });
    expect(sslConfigFor("postgres://example/machines?sslmode=verify-full", {})).toEqual({ rejectUnauthorized: true });
    expect(sslConfigFor("postgres://example/machines?ssl=true", {})).toEqual({ rejectUnauthorized: true });
  });

  test("postgres remote storage rejects insecure TLS modes", () => {
    expect(() => sslConfigFor("postgres://example/machines?sslmode=no-verify", {})).toThrow(
      "PostgreSQL TLS certificate verification cannot be disabled",
    );
    expect(() => sslConfigFor("postgres://example/machines?sslmode=disable", {})).toThrow(
      "Insecure PostgreSQL TLS mode is rejected",
    );
    expect(() => sslConfigFor("postgres://example/machines?ssl=false", {})).toThrow(
      "Insecure PostgreSQL TLS mode is rejected",
    );
    expect(() => sslConfigFor("postgres://example/machines", { [MACHINES_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV]: "0" })).toThrow(
      "PostgreSQL TLS certificate verification cannot be disabled",
    );
    expect(() =>
      sslConfigFor("postgres://example/machines?sslmode=no-verify", { [MACHINES_DATABASE_ALLOW_INSECURE_TLS_ENV]: "1" })
    ).toThrow("PostgreSQL TLS certificate verification cannot be disabled");
  });

  test("postgres loopback storage only permits insecure TLS with explicit local override", () => {
    expect(sslConfigFor("postgres://127.0.0.1/machines", {})).toBeUndefined();
    expect(sslConfigFor("postgres://localhost/machines", {})).toBeUndefined();
    expect(sslConfigFor("postgres://[::1]/machines", {})).toBeUndefined();

    expect(() => sslConfigFor("postgres://127.0.0.1/machines?sslmode=disable", {})).toThrow(
      "Insecure PostgreSQL TLS mode is rejected",
    );
    expect(() => sslConfigFor("postgres://localhost/machines?sslmode=no-verify", {})).toThrow(
      "PostgreSQL TLS certificate verification cannot be disabled",
    );

    const allowLocalInsecure = { [MACHINES_DATABASE_ALLOW_INSECURE_TLS_ENV]: "1" };
    expect(sslConfigFor("postgres://127.0.0.1/machines?sslmode=disable", allowLocalInsecure)).toBeUndefined();
    expect(sslConfigFor("postgres://localhost/machines?ssl=false", allowLocalInsecure)).toBeUndefined();
    expect(sslConfigFor("postgres://[::1]/machines?sslmode=no-verify", allowLocalInsecure)).toEqual({ rejectUnauthorized: false });
    expect(sslConfigFor("postgres://127.0.0.1/machines", {
      [MACHINES_DATABASE_ALLOW_INSECURE_TLS_ENV]: "true",
      [MACHINES_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV]: "0",
    })).toEqual({ rejectUnauthorized: false });
  });

  test("postgres ssl config ignores invalid database URLs", () => {
    expect(sslConfigFor("not a url", {})).toBeUndefined();
  });

  test("storage status initializes local sync metadata without remote config", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-storage-"));
    const dbPath = join(dir, "machines.db");
    process.env.HASNA_MACHINES_DB_PATH = dbPath;

    try {
      const status = getStorageStatus();
      expect(status).toMatchObject({
        configured: false,
        mode: "local",
        service: "machines",
        activeEnv: null,
        sync: [],
        runtimePath: {
          local: {
            adapter: "sqlite",
            role: "source-of-truth",
            pathEnv: "HASNA_MACHINES_DB_PATH",
            defaultDir: "~/.hasna/machines",
          },
          declarations: {
            adapter: "manifest-file-or-adapter",
            role: "desired-state-source",
          },
          remote: {
            adapter: "postgres",
            role: "runtime-mirror",
            configured: false,
            activeEnv: null,
            tls: "verified-for-non-loopback",
          },
          aws: {
            s3: "backup-only",
            provisionsRuntimeStorage: false,
            provisionsInfrastructure: false,
          },
        },
      });
      expect(status.tables).toEqual(STORAGE_TABLES);
      expect(status.runtimePath.local.tables).toEqual(STORAGE_TABLES);
      expect(status.runtimePath.remote.tables).toEqual(STORAGE_TABLES);
      expect(existsSync(dbPath)).toBe(true);

      process.env[MACHINES_STORAGE_ENV] = "postgres://example/machines";
      const configured = getStorageStatus();
      expect(configured).toMatchObject({
        configured: true,
        mode: "hybrid",
        activeEnv: MACHINES_STORAGE_ENV,
        runtimePath: {
          remote: {
            adapter: "postgres",
            role: "runtime-mirror",
            configured: true,
            activeEnv: MACHINES_STORAGE_ENV,
            tls: "verified-for-non-loopback",
          },
          aws: {
            s3: "backup-only",
            provisionsRuntimeStorage: false,
            provisionsInfrastructure: false,
          },
        },
      });
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("local storage prepares public machine registry and runtime alert rows for remote sync", () => {
    const dir = mkdtempSync(join(tmpdir(), "machines-cloud-runtime-storage-"));
    process.env.HASNA_MACHINES_DB_PATH = join(dir, "machines.db");
    process.env.HASNA_MACHINES_MANIFEST_PATH = join(dir, "machines.json");

    try {
      manifestInit();
      manifestAdd({
        id: "cloud-node-01",
        friendlyName: "Cloud Node",
        updatedAt: "2026-07-05T10:00:00.000Z",
        platform: "linux",
        connection: "ssh",
        workspacePath: "/home/operator/workspace",
        tags: ["role:worker"],
        metadata: {
          heartbeatAliases: ["cloud-node-host"],
          apiToken: "should-not-sync",
        },
        packages: [{ name: "bun", manager: "bun" }],
        apps: [{ name: "ghostty", manager: "cask" }],
      });

      expect(() => syncMachineRegistryFromManifest()).toThrow("sdk.machines_registry_sync requires");
      const registry = syncMachineRegistryFromManifest({ trustedLocalMutation: createTrustedSdkMutationApproval() });
      expect(registry).toHaveLength(1);
      expect(listMachineRegistry("cloud-node-01")[0]).toMatchObject({
        machine_id: "cloud-node-01",
        display_name: "Cloud Node",
        friendly_name: "Cloud Node",
        platform: "linux",
        connection: "ssh",
        declared: 1,
        source_kind: "manifest",
        private_metadata: 0,
      });
      const capabilities = JSON.parse(registry[0]!.capabilities_json);
      expect(capabilities).toMatchObject({
        packageNames: ["bun"],
        appNames: ["ghostty"],
        fileCount: 0,
        metadataKeys: ["heartbeatAliases"],
      });

      expect(() => recordRuntimeEvent({
        eventId: "event-denied",
        machineId: "cloud-node-01",
        eventType: "machines.test",
        message: "denied",
      })).toThrow("sdk.machines_runtime_event_record requires");
      const runtimeEvent = recordRuntimeEvent({
        eventId: "event-cloud-node-01",
        machineId: "cloud-node-01",
        eventType: "machines.tmux.pane_died",
        severity: "warning",
        subject: "tmux:%11",
        message: "postgres://example.internal/machines /home/operator/workspace failed",
        dedupeKey: "tmux:%11",
        data: {
          target: "%11",
          token: "fixture-value",
          path: "/home/operator/workspace",
          databaseUrl: "postgres://example.internal/machines",
          privateIp: "10.1.2.3",
          nested: {
            host: "worker.private.internal",
          },
        },
      }, { trustedLocalMutation: createTrustedSdkMutationApproval() });

      expect(runtimeEvent).toMatchObject({
        event_id: "event-cloud-node-01",
        machine_id: "cloud-node-01",
        severity: "warning",
        status: "open",
        private_metadata: 0,
      });
      expect(runtimeEvent.message).toContain("postgres://[redacted]");
      expect(runtimeEvent.message).toContain("/home/<user>/workspace");
      const eventData = JSON.parse(listRuntimeEvents({ machineId: "cloud-node-01" })[0]!.data_json);
      expect(eventData.token).toBe("[redacted]");
      expect(eventData.path).toBe("/home/<user>/workspace");
      expect(eventData.databaseUrl).toBe("postgres://[redacted]");
      expect(eventData.privateIp).toBe("[redacted]");
      expect(eventData.nested.host).toBe("[redacted]");

      manifestRemove("cloud-node-01");
      const afterRemove = syncMachineRegistryFromManifest({ trustedLocalMutation: createTrustedSdkMutationApproval() });
      expect(afterRemove).toHaveLength(1);
      expect(listMachineRegistry("cloud-node-01")[0]?.declared).toBe(0);
    } finally {
      closeDb();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
