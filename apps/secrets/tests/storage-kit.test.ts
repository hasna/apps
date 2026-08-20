import { afterEach, describe, expect, it } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  envToken,
  serverDataBackendEnvKeys,
  assertNoLegacyStorageMode,
  resolveServerDataBackend,
  resolveDatabaseUrl,
} from "../src/generated/storage-kit/backend.js";
import {
  sslModeFromConnectionString,
  resolveTlsConfig,
} from "../src/generated/storage-kit/tls.js";
import {
  createQueryClient,
  wrapExecutor,
  type PgExecutor,
  type TypedQueryClient,
} from "../src/generated/storage-kit/query.js";
import {
  checksumSql,
  createMigrationLedger,
  defineMigration,
  MigrationLedger,
} from "../src/generated/storage-kit/migrations.js";
import { checkHealth, checkReady } from "../src/generated/storage-kit/health.js";
import { createServerPoolFromEnv, createPgPool } from "../src/generated/storage-kit/pool.js";

const tempFiles: string[] = [];

afterEach(() => {
  for (const file of tempFiles.splice(0)) rmSync(file, { force: true });
});

describe("generated server data-backend contract", () => {
  it("resolves sqlite by default and postgresql when a DATABASE_URL is set", () => {
    expect(envToken("my-app")).toBe("MY_APP");
    expect(serverDataBackendEnvKeys("my-app")).toEqual({
      databaseUrlKeys: ["HASNA_MY_APP_DATABASE_URL", "MY_APP_DATABASE_URL"],
    });

    expect(resolveServerDataBackend("my-app", {})).toEqual({
      backend: "sqlite",
      source: "default",
      databaseUrlPresent: false,
      databaseUrlSource: null,
    });

    const withUrl = resolveServerDataBackend("my-app", {
      HASNA_MY_APP_DATABASE_URL: " postgres://canonical ",
    });
    expect(withUrl.backend).toBe("postgresql");
    expect(withUrl.databaseUrlSource).toBe("HASNA_MY_APP_DATABASE_URL");

    expect(
      resolveDatabaseUrl("my-app", { MY_APP_DATABASE_URL: " postgres://canonical " }),
    ).toBe("postgres://canonical");
    expect(resolveDatabaseUrl("my-app", {})).toBeNull();
  });

  it("rejects legacy storage-mode variables instead of interpreting them", () => {
    expect(() =>
      assertNoLegacyStorageMode("my-app", { HASNA_MY_APP_STORAGE_MODE: "cloud" }),
    ).toThrow(/HASNA_MY_APP_STORAGE_MODE was removed/);
    expect(() =>
      resolveServerDataBackend("my-app", { MY_APP_STORAGE_MODE: "self_hosted" }),
    ).toThrow(/was removed/);
    expect(resolveServerDataBackend("my-app", { HASNA_MY_APP_DATABASE_URL: "postgres://x/db" }).backend).toBe(
      "postgresql",
    );
  });
});

describe("generated TLS contract", () => {
  it("parses every accepted ssl mode and rejects unknown modes", () => {
    expect(sslModeFromConnectionString("postgres://x/db")).toBe("disable");
    for (const mode of ["disable", "prefer", "require", "verify-ca", "verify-full"] as const) {
      expect(sslModeFromConnectionString(`postgres://x/db?sslmode=${mode}`)).toBe(mode);
    }
    expect(sslModeFromConnectionString("postgres://x/db?sslmode=ALLOW")).toBe("prefer");
    expect(sslModeFromConnectionString("postgres://x/db?ssl=yes")).toBe("require");
    expect(sslModeFromConnectionString("postgres://x/db?ssl=no")).toBe("disable");
    expect(() => sslModeFromConnectionString("postgres://x/db?sslmode=bogus")).toThrow("Unknown sslmode");
  });

  it("resolves disabled, relaxed, and verified TLS with every CA source", () => {
    // `env: {}` (or an env with the CA vars stripped) is load-bearing on every
    // TLS-selecting row: loadCaBundle() falls back to process.env, so on a host
    // that sets NODE_EXTRA_CA_CERTS or PGSSLROOTCERT the resolution picks up a
    // real CA bundle and the assertion asserts a property of the machine rather
    // than of the code.
    const noCaEnv = {};
    expect(resolveTlsConfig("postgres://x/db", { env: noCaEnv })).toBeUndefined();
    expect(resolveTlsConfig("postgres://x/db?sslmode=disable", { env: noCaEnv })).toBe(false);
    expect(resolveTlsConfig("postgres://x/db?sslmode=require", { env: noCaEnv })).toEqual({
      rejectUnauthorized: true,
    });
    // `prefer` matches `require`: pg has always treated it as an alias for
    // verify-full, so the resolved config says so.
    expect(resolveTlsConfig("postgres://x/db?sslmode=prefer", { env: noCaEnv })).toEqual({
      rejectUnauthorized: true,
    });
    expect(resolveTlsConfig("postgres://x/db?sslmode=require", { ca: " INLINE " })).toEqual({
      rejectUnauthorized: true,
      ca: " INLINE ",
    });
    expect(resolveTlsConfig("postgres://x/db?sslmode=verify-full", { ca: "cert" })).toEqual({
      rejectUnauthorized: true,
      ca: "cert",
    });
    expect(() => resolveTlsConfig("postgres://x/db?sslmode=verify-ca", { env: noCaEnv })).toThrow(
      "requires a CA bundle",
    );

    const file = join(tmpdir(), `storage-kit-ca-${process.pid}-${Date.now()}.pem`);
    tempFiles.push(file);
    writeFileSync(file, "file-cert");
    expect(resolveTlsConfig("postgres://x/db?sslmode=verify-ca", { caCertPath: file })).toEqual({
      rejectUnauthorized: true,
      ca: "file-cert",
    });
    expect(resolveTlsConfig("postgres://x/db?sslmode=verify-full", { env: { PGSSLROOTCERT: file } })).toEqual({
      rejectUnauthorized: true,
      ca: "file-cert",
    });
    expect(resolveTlsConfig("postgres://x/db?sslmode=verify-full", { env: { NODE_EXTRA_CA_CERTS: file } })).toEqual({
      rejectUnauthorized: true,
      ca: "file-cert",
    });
  });
});

describe("generated query client", () => {
  it("wraps query, many, get, one, and execute semantics", async () => {
    const calls: Array<[string, readonly unknown[] | undefined]> = [];
    const executor: PgExecutor = {
      async query(sql, params) {
        calls.push([sql, params]);
        if (sql === "none") return { rows: [], rowCount: null };
        if (sql === "many") return { rows: [{ id: 1 }, { id: 2 }], rowCount: null };
        return { rows: [{ id: 1 }], rowCount: 1 };
      },
    };
    const client = wrapExecutor(executor);
    expect(await client.query("many", [1])).toEqual({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 });
    expect(await client.many("many")).toEqual([{ id: 1 }, { id: 2 }]);
    expect(await client.get("none")).toBeNull();
    expect(await client.get("one")).toEqual({ id: 1 });
    expect(await client.one("one")).toEqual({ id: 1 });
    await expect(client.one("none")).rejects.toThrow("got 0");
    await expect(client.one("many")).rejects.toThrow("got 2");
    await client.execute("write", [2]);
    expect(calls.at(-1)).toEqual(["write", [2]]);
  });

  it("commits, rolls back, preserves the original error, releases, and closes", async () => {
    const statements: string[] = [];
    let released = 0;
    let ended = 0;
    let failRollback = false;
    const dedicated = {
      async query(sql: string) {
        statements.push(sql);
        if (sql === "ROLLBACK" && failRollback) throw new Error("rollback failed");
        return { rows: [], rowCount: 0 };
      },
      release() { released++; },
    };
    const pool = {
      async query() { return { rows: [], rowCount: 0 }; },
      async connect() { return dedicated; },
      async end() { ended++; },
    } as any;
    const client = createQueryClient(pool);
    expect(client.pool).toBe(pool);
    expect(await client.transaction(async (tx) => {
      await tx.execute("inside");
      return 42;
    })).toBe(42);
    expect(statements).toEqual(["BEGIN", "inside", "COMMIT"]);

    failRollback = true;
    await expect(client.transaction(async () => { throw new Error("original"); })).rejects.toThrow("original");
    expect(statements).toContain("ROLLBACK");
    expect(released).toBe(2);
    await client.close();
    expect(ended).toBe(1);
  });
});

class MemoryMigrationClient implements TypedQueryClient {
  rows: Array<{ id: string; checksum: string; applied_at: string | Date }> = [];
  statements: Array<{ sql: string; params?: readonly unknown[] }> = [];

  async query<T>(): Promise<{ rows: T[]; rowCount: number }> { return { rows: [], rowCount: 0 }; }
  async get<T>(): Promise<T | null> { return null; }
  async one<T>(): Promise<T> { throw new Error("unused"); }
  async many<T>(): Promise<T[]> { return this.rows as T[]; }
  async execute(sql: string, params?: readonly unknown[]): Promise<void> {
    this.statements.push({ sql, params });
    if (sql.startsWith("INSERT INTO")) {
      this.rows.push({ id: String(params![0]), checksum: String(params![1]), applied_at: new Date("2025-01-01") });
    }
  }
}

describe("generated migration and health helpers", () => {
  it("checksums, freezes, lists, plans, applies, and uses a custom ledger", async () => {
    expect(checksumSql(" SELECT 1\r\n ")).toBe(checksumSql("SELECT 1"));
    const one = defineMigration("001", " SELECT 1 ");
    const two = defineMigration("002", "SELECT 2");
    expect(Object.isFrozen(one)).toBe(true);
    expect(one.sql).toBe("SELECT 1");
    expect(() => new MigrationLedger(new MemoryMigrationClient(), [one, one])).toThrow("Duplicate migration id");

    const client = new MemoryMigrationClient();
    const ledger = createMigrationLedger(client, [one, two], { ledgerTable: "app_migrations" });
    expect(await ledger.listApplied()).toEqual([]);
    const dry = await ledger.migrate({ dryRun: true });
    expect(dry.plan.map((p) => p.state)).toEqual(["pending", "pending"]);
    expect(client.statements.some((s) => s.sql.includes("app_migrations"))).toBe(true);

    const result = await ledger.migrate();
    expect(result.applied.map((m) => m.id)).toEqual(["001", "002"]);
    expect(result.applied[0]!.appliedAt).toBe("2025-01-01T00:00:00.000Z");
    const again = await ledger.migrate();
    expect(again.plan.every((p) => p.state === "already_applied")).toBe(true);
  });

  it("rejects migration drift and downgrade rows", async () => {
    const migration = defineMigration("001", "SELECT 1");
    const unknown = new MemoryMigrationClient();
    unknown.rows.push({ id: "old", checksum: "sha256:x", applied_at: "yesterday" });
    await expect(new MigrationLedger(unknown, [migration]).migrate({ dryRun: true })).rejects.toThrow("downgrade");

    const drift = new MemoryMigrationClient();
    drift.rows.push({ id: "001", checksum: "sha256:changed", applied_at: "yesterday" });
    await expect(new MigrationLedger(drift, [migration]).migrate({ dryRun: true })).rejects.toThrow("checksum mismatch");
  });

  it("reports healthy, unhealthy, ready, pending, and failed readiness", async () => {
    const healthy = { async get() { return { ok: 1 }; } } as TypedQueryClient;
    expect((await checkHealth(healthy)).ok).toBe(true);
    expect(await checkHealth({ async get() { throw "offline"; } } as TypedQueryClient)).toMatchObject({
      ok: false,
      error: "offline",
    });

    const migration = defineMigration("001", "SELECT 1");
    const readyClient = new MemoryMigrationClient();
    readyClient.rows.push({ id: migration.id, checksum: migration.checksum, applied_at: "now" });
    expect(await checkReady(readyClient, [migration])).toMatchObject({ ok: true, pendingMigrations: [] });
    expect(await checkReady(new MemoryMigrationClient(), [migration])).toMatchObject({
      ok: false,
      pendingMigrations: ["001"],
    });
    const broken = new MemoryMigrationClient();
    broken.execute = async () => { throw new Error("db down"); };
    expect(await checkReady(broken, [migration])).toMatchObject({
      ok: false,
      pendingMigrations: [],
      error: "db down",
    });
  });
});

describe("generated Postgres pool factory", () => {
  it("constructs configured pools without opening a connection", async () => {
    // `env: {}` strips ambient PGSSLROOTCERT / NODE_EXTRA_CA_CERTS so the
    // assertion pins the kit, not the host's shell profile.
    const pool = createPgPool({
      connectionString: "postgres://user:pass@127.0.0.1/db?sslmode=require",
      env: {},
      max: 3,
      idleTimeoutMillis: 10,
      connectionTimeoutMillis: 20,
      applicationName: "tests",
    });
    expect((pool as any).options).toMatchObject({
      max: 3,
      idleTimeoutMillis: 10,
      connectionTimeoutMillis: 20,
      application_name: "tests",
      ssl: { rejectUnauthorized: true },
    });
    await pool.end();

    const plain = createPgPool({ connectionString: "postgres://user:pass@127.0.0.1/db", env: {} });
    expect((plain as any).options.ssl).toBeUndefined();
    await plain.end();
  });

  it("requires a DATABASE_URL and rejects legacy storage-mode variables", async () => {
    expect(() => createServerPoolFromEnv("demo", { env: {} })).toThrow("needs a database URL");
    expect(() =>
      createServerPoolFromEnv("demo", { env: { HASNA_DEMO_STORAGE_MODE: "cloud" } }),
    ).toThrow(/was removed/);

    const result = createServerPoolFromEnv("demo", {
      env: {
        DEMO_DATABASE_URL: "postgres://user:pass@127.0.0.1/db",
      },
      max: 2,
      idleTimeoutMillis: 10,
      connectionTimeoutMillis: 20,
      applicationName: "demo-tests",
    });
    expect(result.connectionSource).toBe("DEMO_DATABASE_URL");
    expect((result.client.pool as any).options).toMatchObject({ max: 2, application_name: "demo-tests" });
    await result.client.close();
  });
});
