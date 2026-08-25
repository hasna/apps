/**
 * Regression tests for O15-00671: the prod `schema_migrations` ledger carries
 * out-of-band rows (`domains_apikeys_tenancy_0001`, `domains_apikeys_tenancy_0002`)
 * that no build in this repo's history generates (verified across every published
 * tarball 0.0.30-0.0.46 and all git history — the rows date from the 2026-07
 * self-hosted cutover). The storage kit's downgrade guard refused them, so
 * `domains db migrate` failed and the domains deploy lane was blocked. The app
 * acknowledges the rows via `ACKNOWLEDGED_LEGACY_MIGRATION_IDS`, which the kit's
 * `acknowledgedLegacyIds` option honors.
 *
 * Deploy evidence, 2026-08-25: the 02:00Z pass failed on `..._0001`; the 16:44Z
 * pass (image carrying the 0.14.1 kit with `_0001` acknowledged, hasna/apps#1176)
 * advanced to `..._0002` — both rows are present in the prod ledger.
 *
 * These tests run the REAL ledger and the REAL buildMigrations() against an
 * in-memory TypedQueryClient that emulates the ledger SQL the kit emits
 * (the same pattern the contracts kit's own unit tests use).
 */

import { describe, expect, test } from "bun:test";
import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import { MigrationLedger } from "../generated/storage-kit/index.js";
import { ACKNOWLEDGED_LEGACY_MIGRATION_IDS, buildMigrations } from "./migrations.js";

function inMemoryLedgerClient(): TypedQueryClient & { appliedDdl: string[] } {
  const ledger = new Map<string, { id: string; checksum: string; applied_at: string }>();
  const appliedDdl: string[] = [];
  return {
    appliedDdl,
    async query<T>() {
      return { rows: [] as T[], rowCount: 0 };
    },
    async many<T>(sql: string): Promise<T[]> {
      if (/SELECT id, checksum, applied_at FROM/.test(sql)) {
        // SQL ORDER BY id ASC is byte order; localeCompare is locale-dependent.
        return [...ledger.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) as unknown as T[];
      }
      return [] as T[];
    },
    async get<T>() {
      return null as T | null;
    },
    async one<T>(): Promise<T> {
      throw new Error("not used");
    },
    async execute(sql: string, params?: readonly unknown[]) {
      if (/CREATE TABLE IF NOT EXISTS/.test(sql)) return;
      if (/^INSERT INTO/.test(sql.trim()) && params) {
        const [id, checksum] = params as [string, string];
        ledger.set(id, { id, checksum, applied_at: new Date().toISOString() });
        return;
      }
      appliedDdl.push(sql);
    },
  };
}

async function seedProdShape(client: ReturnType<typeof inMemoryLedgerClient>): Promise<void> {
  // Apply the full declared migration set exactly as `domains db migrate` does.
  await new MigrationLedger(client, buildMigrations()).migrate();
  // Then record the out-of-band legacy rows exactly as the prod ledger holds them.
  await client.execute(
    `INSERT INTO schema_migrations (id, checksum, applied_at) VALUES ($1, $2, now())`,
    ["domains_apikeys_tenancy_0001", "sha256:not-reproducible-from-source"],
  );
  await client.execute(
    `INSERT INTO schema_migrations (id, checksum, applied_at) VALUES ($1, $2, now())`,
    ["domains_apikeys_tenancy_0002", "sha256:not-reproducible-from-source"],
  );
}

describe("domains migration ledger legacy acknowledgment (O15-00671)", () => {
  test("the acknowledgment set names exactly the prod legacy rows", () => {
    expect(ACKNOWLEDGED_LEGACY_MIGRATION_IDS).toEqual([
      "domains_apikeys_tenancy_0001",
      "domains_apikeys_tenancy_0002",
    ]);
  });

  test("REGRESSION: without the acknowledgment the prod ledger shape is refused (downgrade guard)", async () => {
    const client = inMemoryLedgerClient();
    await seedProdShape(client);
    await expect(new MigrationLedger(client, buildMigrations()).migrate()).rejects.toThrow(
      /domains_apikeys_tenancy_0001.*not recognized/,
    );
  });

  test("with the acknowledgment, migrate passes and never re-applies the legacy rows", async () => {
    const client = inMemoryLedgerClient();
    await seedProdShape(client);
    const ddlBefore = client.appliedDdl.length; // declared set applied once by the seed
    const ledger = new MigrationLedger(client, buildMigrations(), {
      acknowledgedLegacyIds: ACKNOWLEDGED_LEGACY_MIGRATION_IDS,
    });
    const result = await ledger.migrate();
    expect(result.applied.map((m) => m.id)).toEqual(
      expect.arrayContaining([
        "domains_apikeys_tenancy_0001",
        "domains_apikeys_tenancy_0002",
      ]),
    );
    // Nothing re-applied: the acknowledged run applies zero migrations.
    expect(client.appliedDdl.length).toBe(ddlBefore);
  });

  test("an UNacknowledged unknown row still fails the downgrade guard", async () => {
    const client = inMemoryLedgerClient();
    await seedProdShape(client);
    await client.execute(`INSERT INTO schema_migrations (id, checksum, applied_at) VALUES ($1, $2, now())`, [
      "rogue_unknown_0001",
      "sha256:x",
    ]);
    const ledger = new MigrationLedger(client, buildMigrations(), {
      acknowledgedLegacyIds: ACKNOWLEDGED_LEGACY_MIGRATION_IDS,
    });
    await expect(ledger.migrate()).rejects.toThrow(/rogue_unknown_0001.*not recognized/);
  });
});
