import {
  defineMigration,
  MigrationLedger,
  type AppliedMigration,
  type Migration,
} from "../generated/storage-kit/migrations.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import { SECRETS_MIGRATIONS } from "./cloud-migrations.js";

const TENANT_COLUMNS_MIGRATION_ID = "secrets_0010_tenant_columns";
const BACKFILL_MIGRATION_ID = "secrets_0012_backfill";
const BACKFILL_RECONCILE_MIGRATION_ID = "secrets_0012_backfill_reconcile";
const BACKFILL_PRODUCTION_CHECKSUM =
  "sha256:e1d6a79fba95064f6060f28a751a016eb0194c865486ba39656df581419c6231";

const EXPECTED_TENANT_COLUMNS = [
  ["secrets", "tenant_id", "uuid"],
  ["vault_items", "tenant_id", "uuid"],
  ["users", "tenant_id", "uuid"],
  ["feedback", "tenant_id", "uuid"],
  ["audit_log", "tenant_id", "uuid"],
  ["audit_log", "user_id", "text"],
] as const;

const EXPECTED_BACKFILL_TENANT_COLUMNS = [
  ["secrets", "tenant_id", "uuid"],
  ["vault_items", "tenant_id", "uuid"],
  ["users", "tenant_id", "uuid"],
  ["feedback", "tenant_id", "uuid"],
  ["audit_log", "tenant_id", "uuid"],
  ["api_keys", "tenant_id", "uuid"],
] as const;

interface SchemaColumn {
  table_name: string;
  column_name: string;
  udt_name: string;
}

function migrationWithAppliedChecksum(migration: Migration, applied: AppliedMigration): Migration {
  return Object.freeze({ ...migration, checksum: applied.checksum });
}

function hasExpectedColumnSchema(
  rows: readonly SchemaColumn[],
  expectedColumns: readonly (readonly [string, string, string])[],
): boolean {
  const actual = new Set(rows.map((row) => `${row.table_name}.${row.column_name}.${row.udt_name}`));
  return (
    actual.size === expectedColumns.length &&
    expectedColumns.every(([table, column, type]) => actual.has(`${table}.${column}.${type}`))
  );
}

async function readExpectedColumns(
  client: TypedQueryClient,
  expectedColumns: readonly (readonly [string, string, string])[],
): Promise<SchemaColumn[]> {
  return client.many<SchemaColumn>(
    `SELECT columns.table_name, columns.column_name, columns.udt_name
       FROM information_schema.columns AS columns
       JOIN unnest($1::text[], $2::text[]) AS expected(table_name, column_name)
         ON expected.table_name = columns.table_name
        AND expected.column_name = columns.column_name
      WHERE columns.table_schema = current_schema()`,
    [
      expectedColumns.map(([table]) => table),
      expectedColumns.map(([, column]) => column),
    ],
  );
}

/**
 * Preserve the drift guard while recognizing two production migration
 * lineages whose original checksums are not present in this source tree.
 *
 * The compatibility path is intentionally narrow: it only applies to the
 * known tenant-column and backfill migrations, and only after the database
 * proves each migration's complete expected column set and Postgres types.
 * The backfill path adds a separately checksummed idempotent reconciliation so
 * rows written after the legacy migration are repaired through the normal
 * ledger. All other checksum drift remains fatal.
 */
export async function createSecretsMigrationLedger(client: TypedQueryClient): Promise<MigrationLedger> {
  const applied = await new MigrationLedger(client, SECRETS_MIGRATIONS).listApplied();
  let migrations: readonly Migration[] = SECRETS_MIGRATIONS;
  const tenantColumnsMigration = migrations.find((item) => item.id === TENANT_COLUMNS_MIGRATION_ID);
  const appliedTenantColumns = applied.find((row) => row.id === TENANT_COLUMNS_MIGRATION_ID);

  if (
    tenantColumnsMigration &&
    appliedTenantColumns &&
    appliedTenantColumns.checksum !== tenantColumnsMigration.checksum
  ) {
    const schemaRows = await readExpectedColumns(client, EXPECTED_TENANT_COLUMNS);
    if (hasExpectedColumnSchema(schemaRows, EXPECTED_TENANT_COLUMNS)) {
      migrations = migrations.map((item) =>
        item.id === TENANT_COLUMNS_MIGRATION_ID
          ? migrationWithAppliedChecksum(item, appliedTenantColumns)
          : item,
      );
    }
  }

  const backfillMigration = migrations.find((item) => item.id === BACKFILL_MIGRATION_ID);
  const appliedBackfill = applied.find((row) => row.id === BACKFILL_MIGRATION_ID);
  if (
    backfillMigration &&
    appliedBackfill?.checksum === BACKFILL_PRODUCTION_CHECKSUM &&
    appliedBackfill.checksum !== backfillMigration.checksum
  ) {
    const schemaRows = await readExpectedColumns(client, EXPECTED_BACKFILL_TENANT_COLUMNS);
    if (hasExpectedColumnSchema(schemaRows, EXPECTED_BACKFILL_TENANT_COLUMNS)) {
      const reconcileMigration = defineMigration(BACKFILL_RECONCILE_MIGRATION_ID, backfillMigration.sql);
      migrations = migrations.flatMap((item) =>
        item.id === BACKFILL_MIGRATION_ID
          ? [migrationWithAppliedChecksum(item, appliedBackfill), reconcileMigration]
          : [item],
      );
    }
  }

  return new MigrationLedger(client, migrations);
}
