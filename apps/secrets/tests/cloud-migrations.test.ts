import { describe, expect, it } from "bun:test";
import {
  defineMigration,
  MigrationLedger,
  type Migration,
} from "../src/generated/storage-kit/migrations.js";
import { type TypedQueryClient } from "../src/generated/storage-kit/query.js";
import { SECRETS_MIGRATIONS } from "../src/server/cloud-migrations.js";
import { createSecretsMigrationLedger } from "../src/server/migration-compat.js";

const APPLIED_TENANTS_SQL = `CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'org',
      status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO tenants (id, slug, name, kind)
      VALUES ('adfd95c7-ee8b-52cb-ae47-4ae65dae3313', 'hasna', 'Hasna Root', 'root')
      ON CONFLICT (id) DO NOTHING;`;

const EXACT_TENANT_COLUMN_SCHEMA = [
  { table_name: "secrets", column_name: "tenant_id", udt_name: "uuid" },
  { table_name: "vault_items", column_name: "tenant_id", udt_name: "uuid" },
  { table_name: "users", column_name: "tenant_id", udt_name: "uuid" },
  { table_name: "feedback", column_name: "tenant_id", udt_name: "uuid" },
  { table_name: "audit_log", column_name: "tenant_id", udt_name: "uuid" },
  { table_name: "audit_log", column_name: "user_id", udt_name: "text" },
] as const;

const EXACT_BACKFILL_TENANT_SCHEMA = [
  { table_name: "secrets", column_name: "tenant_id", udt_name: "uuid" },
  { table_name: "vault_items", column_name: "tenant_id", udt_name: "uuid" },
  { table_name: "users", column_name: "tenant_id", udt_name: "uuid" },
  { table_name: "feedback", column_name: "tenant_id", udt_name: "uuid" },
  { table_name: "audit_log", column_name: "tenant_id", udt_name: "uuid" },
  { table_name: "api_keys", column_name: "tenant_id", udt_name: "uuid" },
] as const;

class MemoryMigrationClient implements TypedQueryClient {
  rows: Array<{ id: string; checksum: string; applied_at: string | Date }> = [];
  schemaRows: Array<{ table_name: string; column_name: string; udt_name: string }> = [];
  schemaError: Error | undefined;
  executedSql: string[] = [];

  async query<T>(): Promise<{ rows: T[]; rowCount: number }> {
    return { rows: [], rowCount: 0 };
  }

  async get<T>(): Promise<T | null> {
    return null;
  }

  async one<T>(): Promise<T> {
    throw new Error("unused");
  }

  async many<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    if (sql.includes("information_schema.columns")) {
      if (this.schemaError) throw this.schemaError;
      if (sql.includes("JOIN unnest")) {
        const tables = params?.[0] as readonly string[];
        const columns = params?.[1] as readonly string[];
        const expected = new Set(tables.map((table, index) => `${table}.${columns[index]}`));
        return this.schemaRows.filter((row) => expected.has(`${row.table_name}.${row.column_name}`)) as T[];
      }
      return this.schemaRows as T[];
    }
    return this.rows as T[];
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<void> {
    if (sql.startsWith("INSERT INTO")) {
      this.rows.push({
        id: String(params![0]),
        checksum: String(params![1]),
        applied_at: new Date("2025-01-01"),
      });
      return;
    }
    this.executedSql.push(sql);
  }
}

describe("cloud migration lineage", () => {
  it("accepts the production ledger before continuing migration", async () => {
    const appliedTenants = defineMigration("secrets_0008_tenants", APPLIED_TENANTS_SQL);
    const client = new MemoryMigrationClient();
    client.rows.push({
      id: appliedTenants.id,
      checksum: appliedTenants.checksum,
      applied_at: "2026-08-07T21:00:00.000Z",
    });

    const ledger = new MigrationLedger(client, SECRETS_MIGRATIONS);
    const result = await ledger.migrate({ dryRun: true });

    expect(result.plan.find((item) => item.migration.id === appliedTenants.id)).toMatchObject({
      migration: { id: "secrets_0008_tenants", checksum: appliedTenants.checksum },
      state: "already_applied",
    });
  });

  it("keeps the compatibility migration checksum stable", () => {
    const appliedTenants = defineMigration("secrets_0008_tenants", APPLIED_TENANTS_SQL);
    const migration = SECRETS_MIGRATIONS.find((item: Migration) => item.id === appliedTenants.id);

    expect(migration).toMatchObject({
      id: appliedTenants.id,
      checksum: appliedTenants.checksum,
    });
  });

  it("keeps the exact ECS db migrate contract compatible with the applied tenant-column lineage", async () => {
    const migration = SECRETS_MIGRATIONS.find((item) => item.id === "secrets_0010_tenant_columns")!;
    const client = new MemoryMigrationClient();
    client.rows.push({
      id: migration.id,
      checksum: "sha256:legacy-production-lineage",
      applied_at: "2026-08-08T00:00:00.000Z",
    });
    client.schemaRows = [...EXACT_TENANT_COLUMN_SCHEMA];

    const ledger = await createSecretsMigrationLedger(client);
    const result = await ledger.migrate({ dryRun: true });

    expect(result.plan.find((item) => item.migration.id === migration.id)).toMatchObject({
      migration: { id: migration.id },
      state: "already_applied",
    });
  });

  it("accepts the tenant-column schema amid unrelated existing table columns", async () => {
    const migration = SECRETS_MIGRATIONS.find((item) => item.id === "secrets_0010_tenant_columns")!;
    const client = new MemoryMigrationClient();
    client.rows.push({
      id: migration.id,
      checksum: "sha256:legacy-production-lineage",
      applied_at: "2026-08-08T00:00:00.000Z",
    });
    client.schemaRows = [
      ...EXACT_TENANT_COLUMN_SCHEMA,
      { table_name: "secrets", column_name: "key", udt_name: "text" },
      { table_name: "audit_log", column_name: "action", udt_name: "text" },
    ];

    const ledger = await createSecretsMigrationLedger(client);
    const result = await ledger.migrate({ dryRun: true });
    expect(result.plan.find((item) => item.migration.id === migration.id)).toMatchObject({
      state: "already_applied",
    });
  });

  it("rejects a partial tenant-column schema", async () => {
    const migration = SECRETS_MIGRATIONS.find((item) => item.id === "secrets_0010_tenant_columns")!;
    const client = new MemoryMigrationClient();
    client.rows.push({
      id: migration.id,
      checksum: "sha256:legacy-production-lineage",
      applied_at: "2026-08-08T00:00:00.000Z",
    });
    client.schemaRows = [...EXACT_TENANT_COLUMN_SCHEMA.slice(0, -1)];

    const ledger = await createSecretsMigrationLedger(client);
    await expect(ledger.migrate({ dryRun: true })).rejects.toThrow("checksum mismatch");
  });

  it("rejects a wrong tenant-column type", async () => {
    const migration = SECRETS_MIGRATIONS.find((item) => item.id === "secrets_0010_tenant_columns")!;
    const client = new MemoryMigrationClient();
    client.rows.push({
      id: migration.id,
      checksum: "sha256:legacy-production-lineage",
      applied_at: "2026-08-08T00:00:00.000Z",
    });
    client.schemaRows = EXACT_TENANT_COLUMN_SCHEMA.map((row) =>
      row.column_name === "user_id" ? { ...row, udt_name: "uuid" } : row,
    );

    const ledger = await createSecretsMigrationLedger(client);
    await expect(ledger.migrate({ dryRun: true })).rejects.toThrow("checksum mismatch");
  });

  it("keeps other migration checksum mismatches fatal", async () => {
    const client = new MemoryMigrationClient();
    client.rows.push({
      id: "secrets_0009_memberships",
      checksum: "sha256:legacy-production-lineage",
      applied_at: "2026-08-08T00:00:00.000Z",
    });

    const ledger = await createSecretsMigrationLedger(client);
    await expect(ledger.migrate({ dryRun: true })).rejects.toThrow("checksum mismatch");
  });

  it("fails closed when the tenant-column schema query errors", async () => {
    const migration = SECRETS_MIGRATIONS.find((item) => item.id === "secrets_0010_tenant_columns")!;
    const client = new MemoryMigrationClient();
    client.rows.push({
      id: migration.id,
      checksum: "sha256:legacy-production-lineage",
      applied_at: "2026-08-08T00:00:00.000Z",
    });
    client.schemaError = new Error("schema unavailable");

    await expect(createSecretsMigrationLedger(client)).rejects.toThrow("schema unavailable");
  });

  it("leaves fresh installs and matching-checksum upgrades on the normal ledger path", async () => {
    const freshClient = new MemoryMigrationClient();
    const freshLedger = await createSecretsMigrationLedger(freshClient);
    const freshResult = await freshLedger.migrate({ dryRun: true });
    expect(freshResult.plan.find((item) => item.migration.id === "secrets_0010_tenant_columns")).toMatchObject({
      state: "pending",
    });

    const migration = SECRETS_MIGRATIONS.find((item) => item.id === "secrets_0010_tenant_columns")!;
    const upgradedClient = new MemoryMigrationClient();
    upgradedClient.rows.push({
      id: migration.id,
      checksum: migration.checksum,
      applied_at: "2026-08-08T00:00:00.000Z",
    });
    const upgradedLedger = await createSecretsMigrationLedger(upgradedClient);
    const upgradedResult = await upgradedLedger.migrate({ dryRun: true });
    expect(upgradedResult.plan.find((item) => item.migration.id === migration.id)).toMatchObject({
      state: "already_applied",
      migration: { checksum: migration.checksum },
    });
  });

  it("keeps an unproven tenant-column checksum mismatch fatal", async () => {
    const migration = SECRETS_MIGRATIONS.find((item) => item.id === "secrets_0010_tenant_columns")!;
    const client = new MemoryMigrationClient();
    client.rows.push({
      id: migration.id,
      checksum: "sha256:legacy-production-lineage",
      applied_at: "2026-08-08T00:00:00.000Z",
    });

    const ledger = await createSecretsMigrationLedger(client);
    await expect(ledger.migrate({ dryRun: true })).rejects.toThrow("checksum mismatch");
  });

  it("plans an idempotent repair for the proven production backfill lineage", async () => {
    const migration = SECRETS_MIGRATIONS.find((item) => item.id === "secrets_0012_backfill")!;
    const client = new MemoryMigrationClient();
    client.rows.push({
      id: migration.id,
      checksum: "sha256:e1d6a79fba95064f6060f28a751a016eb0194c865486ba39656df581419c6231",
      applied_at: "2026-08-08T01:59:02.030Z",
    });
    client.schemaRows = [...EXACT_BACKFILL_TENANT_SCHEMA];

    const ledger = await createSecretsMigrationLedger(client);
    const result = await ledger.migrate({ dryRun: true });

    expect(result.plan.find((item) => item.migration.id === migration.id)).toMatchObject({
      state: "already_applied",
    });
    expect(result.plan.find((item) => item.migration.id === "secrets_0012_backfill_reconcile")).toMatchObject({
      state: "pending",
    });
  });

  it("executes and records the checksummed reconciliation through the normal migration path", async () => {
    const migration = SECRETS_MIGRATIONS.find((item) => item.id === "secrets_0012_backfill")!;
    const client = new MemoryMigrationClient();
    client.rows.push({
      id: migration.id,
      checksum: "sha256:e1d6a79fba95064f6060f28a751a016eb0194c865486ba39656df581419c6231",
      applied_at: "2026-08-08T01:59:02.030Z",
    });
    client.schemaRows = [...EXACT_BACKFILL_TENANT_SCHEMA];

    const ledger = await createSecretsMigrationLedger(client);
    const result = await ledger.migrate();

    expect(client.executedSql).toContain(migration.sql);
    expect(result.applied.find((item) => item.id === "secrets_0012_backfill_reconcile")).toBeDefined();
  });

  it("keeps the backfill mismatch fatal when any required tenant column is absent", async () => {
    const migration = SECRETS_MIGRATIONS.find((item) => item.id === "secrets_0012_backfill")!;
    const client = new MemoryMigrationClient();
    client.rows.push({
      id: migration.id,
      checksum: "sha256:e1d6a79fba95064f6060f28a751a016eb0194c865486ba39656df581419c6231",
      applied_at: "2026-08-08T01:59:02.030Z",
    });
    client.schemaRows = [...EXACT_BACKFILL_TENANT_SCHEMA.slice(0, -1)];

    const ledger = await createSecretsMigrationLedger(client);
    await expect(ledger.migrate({ dryRun: true })).rejects.toThrow("checksum mismatch");
  });

  it("keeps an unknown backfill checksum fatal even when the schema matches", async () => {
    const migration = SECRETS_MIGRATIONS.find((item) => item.id === "secrets_0012_backfill")!;
    const client = new MemoryMigrationClient();
    client.rows.push({
      id: migration.id,
      checksum: "sha256:unknown-backfill-lineage",
      applied_at: "2026-08-08T01:59:02.030Z",
    });
    client.schemaRows = [...EXACT_BACKFILL_TENANT_SCHEMA];

    const ledger = await createSecretsMigrationLedger(client);
    await expect(ledger.migrate({ dryRun: true })).rejects.toThrow("checksum mismatch");
  });

  it("keeps later reconciliation SQL drift fatal", async () => {
    const migration = SECRETS_MIGRATIONS.find((item) => item.id === "secrets_0012_backfill")!;
    const client = new MemoryMigrationClient();
    client.rows.push(
      {
        id: migration.id,
        checksum: "sha256:e1d6a79fba95064f6060f28a751a016eb0194c865486ba39656df581419c6231",
        applied_at: "2026-08-08T01:59:02.030Z",
      },
      {
        id: "secrets_0012_backfill_reconcile",
        checksum: "sha256:changed-after-application",
        applied_at: "2026-08-08T02:00:00.000Z",
      },
    );
    client.schemaRows = [...EXACT_BACKFILL_TENANT_SCHEMA];

    const ledger = await createSecretsMigrationLedger(client);
    await expect(ledger.migrate({ dryRun: true })).rejects.toThrow("checksum mismatch");
  });
});
