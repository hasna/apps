import { createHash } from "node:crypto";
import { ACKNOWLEDGED_LEGACY_MIGRATION_IDS, buildMigrations } from "./migrations.js";

export interface DomainsMigrationCatalog {
  schema: "hasna.domains.migration_catalog.v1";
  source_sha: string;
  catalog_digest: string;
  migrations: Array<{ id: string; checksum: string }>;
  acknowledged_legacy_ids: string[];
}

/** Exact public-source migration authority used by the production deploy lane. */
export function buildMigrationCatalog(sourceSha: string): DomainsMigrationCatalog {
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) throw new Error("migration catalog requires a full lowercase source SHA");
  const migrations = buildMigrations().map(({ id, checksum }) => ({ id, checksum }));
  const acknowledged_legacy_ids = [...ACKNOWLEDGED_LEGACY_MIGRATION_IDS];
  const ids = [...migrations.map((migration) => migration.id), ...acknowledged_legacy_ids];
  if (new Set(ids).size !== ids.length) throw new Error("migration catalog contains duplicate IDs");
  const catalogShape = { migrations, acknowledged_legacy_ids };
  const catalog_digest = `sha256:${createHash("sha256").update(JSON.stringify(catalogShape)).digest("hex")}`;
  return {
    schema: "hasna.domains.migration_catalog.v1",
    source_sha: sourceSha,
    catalog_digest,
    ...catalogShape,
  };
}
