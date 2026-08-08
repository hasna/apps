import {
  MigrationLedger,
  type AppliedMigration,
  type Migration,
} from "../generated/storage-kit/migrations.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import { SECRETS_MIGRATIONS } from "./cloud-migrations.js";

const TENANT_COLUMNS_MIGRATION_ID = "secrets_0010_tenant_columns";

const EXPECTED_TENANT_COLUMNS = [
  ["secrets", "tenant_id", "uuid"],
  ["vault_items", "tenant_id", "uuid"],
  ["users", "tenant_id", "uuid"],
  ["feedback", "tenant_id", "uuid"],
  ["audit_log", "tenant_id", "uuid"],
  ["audit_log", "user_id", "text"],
] as const;

interface SchemaColumn {
  table_name: string;
  column_name: string;
  udt_name: string;
}

function migrationWithAppliedChecksum(migration: Migration, applied: AppliedMigration): Migration {
  return Object.freeze({ ...migration, checksum: applied.checksum });
}

function hasTenantColumnSchema(rows: readonly SchemaColumn[]): boolean {
  const actual = new Set(rows.map((row) => `${row.table_name}.${row.column_name}.${row.udt_name}`));
  return (
    actual.size === EXPECTED_TENANT_COLUMNS.length &&
    EXPECTED_TENANT_COLUMNS.every(([table, column, type]) => actual.has(`${table}.${column}.${type}`))
  );
}

/**
 * Preserve the drift guard while recognizing the production tenant-column
 * lineage whose original checksum is not present in this source tree.
 *
 * The compatibility path is intentionally narrow: it only applies to the
 * tenant-column migration, and only after the database proves all six columns
 * with their expected Postgres types already exist. All other checksum drift
 * remains fatal in the generated ledger.
 */
export async function createSecretsMigrationLedger(client: TypedQueryClient): Promise<MigrationLedger> {
  const applied = await new MigrationLedger(client, SECRETS_MIGRATIONS).listApplied();
  const migration = SECRETS_MIGRATIONS.find((item) => item.id === TENANT_COLUMNS_MIGRATION_ID);
  const existing = applied.find((row) => row.id === TENANT_COLUMNS_MIGRATION_ID);

  if (!migration || !existing || existing.checksum === migration.checksum) {
    return new MigrationLedger(client, SECRETS_MIGRATIONS);
  }

  const schemaRows = await client.many<SchemaColumn>(
    `SELECT columns.table_name, columns.column_name, columns.udt_name
       FROM information_schema.columns AS columns
       JOIN unnest($1::text[], $2::text[]) AS expected(table_name, column_name)
         ON expected.table_name = columns.table_name
        AND expected.column_name = columns.column_name
      WHERE columns.table_schema = current_schema()`,
    [
      EXPECTED_TENANT_COLUMNS.map(([table]) => table),
      EXPECTED_TENANT_COLUMNS.map(([, column]) => column),
    ],
  );

  if (!hasTenantColumnSchema(schemaRows)) {
    return new MigrationLedger(client, SECRETS_MIGRATIONS);
  }

  const migrations = SECRETS_MIGRATIONS.map((item) =>
    item.id === TENANT_COLUMNS_MIGRATION_ID ? migrationWithAppliedChecksum(item, existing) : item,
  );
  return new MigrationLedger(client, migrations);
}
