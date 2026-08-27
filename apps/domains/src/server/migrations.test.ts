/**
 * Regression tests for O15-00671, O15-00758, O15-00762, O15-00766, todos
 * 2b474505 and O15-01822: the prod `schema_migrations` ledger carries
 * out-of-band rows (`domains_apikeys_tenancy_0001`,
 * `domains_apikeys_tenancy_0002`, `domains_tenancy_0001`..`domains_tenancy_0010`)
 * that no build in this repo's history generates (verified across every
 * published tarball 0.0.30-0.0.46 and all git history — the rows date from the
 * 2026-07 self-hosted cutover). The storage kit's downgrade guard refused them,
 * so `domains db migrate` failed and the domains deploy lane was blocked. The
 * app acknowledges the rows via `ACKNOWLEDGED_LEGACY_MIGRATION_IDS`, which the
 * kit's `acknowledgedLegacyIds` option honors.
 *
 * Deploy evidence, 2026-08-25: the 02:00Z pass failed on `..._0001`; the 16:44Z
 * pass (image carrying the 0.14.1 kit with `_0001` acknowledged, hasna/apps#1176)
 * advanced to `..._0002` — both rows are present in the prod ledger. A later
 * pass then hit the third out-of-band row `domains_tenancy_0001` (O15-00758),
 * and the 2026-08-25 PASS-18 pass then failed on the fourth row
 * `domains_tenancy_0002` at `domains-prod-migrate:42` (O15-00762). A 2026-08-25
 * PASS pass then hit the fifth out-of-band row `domains_tenancy_0003` at
 * `domains-prod-migrate:42` (O15-00766). Deploy evidence 2026-08-26: passes
 * 48-96 then failed on the sixth out-of-band row `domains_tenancy_0004` at
 * `domains-prod-migrate:44` through `:49` (todos 2b474505). Deploy evidence
 * 2026-08-26/27: the 2026-08-27 06:47Z pass failed on the seventh row
 * `domains_tenancy_0005` at `domains-prod-migrate:50` (O15-01822); the ledger
 * census (inspection task oss-fleet-prod/4b7c37626965439e96d5386c8e8a73d4)
 * shows the full out-of-band set is `domains_apikeys_tenancy_0001-0002` plus
 * `domains_tenancy_0001..0010` (12 rows total), so the acknowledgment set below
 * covers the complete measured prod ledger rather than one row per deploy pass.
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

const PROD_LEGACY_ROWS: readonly string[] = [
  "domains_apikeys_tenancy_0001",
  "domains_apikeys_tenancy_0002",
  "domains_tenancy_0001",
  "domains_tenancy_0002",
  "domains_tenancy_0003",
  "domains_tenancy_0004",
  "domains_tenancy_0005",
  "domains_tenancy_0006",
  "domains_tenancy_0007",
  "domains_tenancy_0008",
  "domains_tenancy_0009",
  "domains_tenancy_0010",
];

async function seedProdShape(client: ReturnType<typeof inMemoryLedgerClient>): Promise<void> {
  // Apply the full declared migration set exactly as `domains db migrate` does.
  await new MigrationLedger(client, buildMigrations()).migrate();
  // Then record the out-of-band legacy rows exactly as the prod ledger holds them.
  for (const id of PROD_LEGACY_ROWS) {
    await client.execute(
      `INSERT INTO schema_migrations (id, checksum, applied_at) VALUES ($1, $2, now())`,
      [id, "sha256:not-reproducible-from-source"],
    );
  }
}

describe("domains migration ledger legacy acknowledgment (O15-00671 / O15-00758 / O15-00762 / O15-00766 / 2b474505 / O15-01822)", () => {
  test("the acknowledgment set names exactly the prod legacy rows", () => {
    expect(ACKNOWLEDGED_LEGACY_MIGRATION_IDS).toEqual(PROD_LEGACY_ROWS);
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
    expect(result.applied.map((m) => m.id)).toEqual(expect.arrayContaining([...PROD_LEGACY_ROWS]));
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
