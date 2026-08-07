import { describe, expect, it } from "bun:test";
import {
  defineMigration,
  MigrationLedger,
  type Migration,
} from "../src/generated/storage-kit/migrations.js";
import { type TypedQueryClient } from "../src/generated/storage-kit/query.js";
import { SECRETS_MIGRATIONS } from "../src/server/cloud-migrations.js";

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

class MemoryMigrationClient implements TypedQueryClient {
  rows: Array<{ id: string; checksum: string; applied_at: string | Date }> = [];

  async query<T>(): Promise<{ rows: T[]; rowCount: number }> {
    return { rows: [], rowCount: 0 };
  }

  async get<T>(): Promise<T | null> {
    return null;
  }

  async one<T>(): Promise<T> {
    throw new Error("unused");
  }

  async many<T>(): Promise<T[]> {
    return this.rows as T[];
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<void> {
    if (sql.startsWith("INSERT INTO")) {
      this.rows.push({
        id: String(params![0]),
        checksum: String(params![1]),
        applied_at: new Date("2025-01-01"),
      });
    }
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
});
