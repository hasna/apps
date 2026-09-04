import { afterEach, describe, expect, it } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
import {
  assertNoRetiredStorageMode,
  createCloudPoolFromEnv,
  createPgPool,
  resolveDatabaseUrl,
} from "../src/generated/storage-kit/pool.js";

const tempFiles: string[] = [];

afterEach(() => {
  for (const file of tempFiles.splice(0)) rmSync(file, { force: true });
});

describe("generated storage kit — retired mode contract", () => {
  it("rejects every retired storage-mode variable as a hard error", () => {
    for (const key of [
      "HASNA_MY_APP_STORAGE_MODE",
      "HASNA_MY_APP_MODE",
      "MY_APP_STORAGE_MODE",
      "MY_APP_MODE",
    ] as const) {
      expect(() => assertNoRetiredStorageMode("my-app", { [key]: "cloud" })).toThrow(
        new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} was removed`),
      );
    }
    // No legacy key set: silent.
    expect(() => assertNoRetiredStorageMode("my-app", {})).not.toThrow();
    expect(() =>
      assertNoRetiredStorageMode("my-app", { HASNA_MY_APP_DATABASE_URL: "postgres://x/db" }),
    ).not.toThrow();
  });

  it("resolves the database URL from canonical, alias, and shared keys", () => {
    expect(resolveDatabaseUrl("my-app", {})).toEqual({ value: null, source: null });
    expect(resolveDatabaseUrl("my-app", { HASNA_MY_APP_DATABASE_URL: " postgres://canonical " })).toEqual({
      value: "postgres://canonical",
      source: "HASNA_MY_APP_DATABASE_URL",
    });
    expect(resolveDatabaseUrl("my-app", { MY_APP_DATABASE_URL: "postgres://alias" })).toEqual({
      value: "postgres://alias",
      source: "MY_APP_DATABASE_URL",
    });
    expect(resolveDatabaseUrl("my-app", { DATABASE_URL: "postgres://shared" })).toEqual({
      value: "postgres://shared",
      source: "DATABASE_URL",
    });
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
    expect(resolveTlsConfig("postgres://x/db")).toBeUndefined();
    expect(resolveTlsConfig("postgres://x/db?sslmode=prefer")).toBeUndefined();
    // `env: {}` is load-bearing. loadCaBundle() falls back to process.env, so on a
    // host that sets NODE_EXTRA_CA_CERTS or PGSSLROOTCERT this call picks up a real
    // CA bundle and returns { rejectUnauthorized: false, ca }. Without the explicit
    // env the assertion asserts a property of the machine rather than of the code —
    // it passes where those are unset and fails where they are set. Every other
    // assertion in this test already pins its CA source; this one was the omission.
    expect(resolveTlsConfig("postgres://x/db?sslmode=require", { env: {} })).toEqual({
      rejectUnauthorized: false,
    });
    expect(resolveTlsConfig("postgres://x/db?sslmode=require", { ca: " INLINE " })).toEqual({
      rejectUnauthorized: false,
      ca: " INLINE ",
    });
    expect(resolveTlsConfig("postgres://x/db?sslmode=verify-full", { ca: "cert" })).toEqual({
      rejectUnauthorized: true,
      ca: "cert",
    });
    expect(() => resolveTlsConfig("postgres://x/db?sslmode=verify-ca", { env: {} })).toThrow(
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
    const pool = createPgPool({
      connectionString: "postgres://user:pass@127.0.0.1/db?sslmode=require",
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
      ssl: { rejectUnauthorized: false },
    });
    await pool.end();

    const plain = createPgPool({ connectionString: "postgres://user:pass@127.0.0.1/db" });
    expect((plain as any).options.ssl).toBeUndefined();
    await plain.end();
  });

  it("requires a database URL, rejects retired mode variables, and returns a closable query client", async () => {
    expect(() => createCloudPoolFromEnv("demo", { env: {} })).toThrow("needs a database URL");
    expect(() =>
      createCloudPoolFromEnv("demo", { env: { HASNA_DEMO_STORAGE_MODE: "cloud" } }),
    ).toThrow("HASNA_DEMO_STORAGE_MODE was removed");

    const result = createCloudPoolFromEnv("demo", {
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
