import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ACKNOWLEDGED_LEGACY_MIGRATION_IDS, buildMigrations } from "./migrations.js";
import { buildMigrationCatalog } from "./migration-catalog.js";

describe("Domains migration catalog", () => {
  test("binds exact checksums and acknowledged historical IDs to the source SHA", () => {
    const source = "a".repeat(40);
    const catalog = buildMigrationCatalog(source);
    expect(catalog.schema).toBe("hasna.domains.migration_catalog.v1");
    expect(catalog.source_sha).toBe(source);
    expect(catalog.migrations).toEqual(buildMigrations().map(({ id, checksum }) => ({ id, checksum })));
    expect(catalog.acknowledged_legacy_ids).toEqual([...ACKNOWLEDGED_LEGACY_MIGRATION_IDS]);
    expect(catalog.migrations.every((migration) => /^sha256:[0-9a-f]{64}$/.test(migration.checksum))).toBe(true);
    const shape = { migrations: catalog.migrations, acknowledged_legacy_ids: catalog.acknowledged_legacy_ids };
    expect(catalog.catalog_digest).toBe(`sha256:${createHash("sha256").update(JSON.stringify(shape)).digest("hex")}`);
  });

  test("refuses abbreviated, uppercase and non-commit source identities", () => {
    for (const value of ["a".repeat(39), "A".repeat(40), "main", ""]) {
      expect(() => buildMigrationCatalog(value)).toThrow("full lowercase source SHA");
    }
  });
});
