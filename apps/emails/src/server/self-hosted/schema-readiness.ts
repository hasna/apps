import { migrationAcceptsChecksum, type TypedQueryClient, type Migration } from "../../storage-kit/index.js";

export interface SchemaReadiness {
  ok: boolean;
  latencyMs: number;
  pendingMigrations: string[];
  migrationIssues: string[];
}

/**
 * SELECT-only readiness: reachable AND every defined migration is recorded in
 * `schema_migrations`. Unlike the kit's `checkReady`, this never issues DDL, so
 * it works under the least-privileged app role (which has no CREATE on public).
 */
export async function checkSchemaReadiness(deps: {
  client: Pick<TypedQueryClient, "many">;
  migrations: readonly Migration[];
}): Promise<SchemaReadiness> {
  const start = Date.now();
  try {
    const rows = await deps.client.many<{ id: string; checksum: string }>(`SELECT id, checksum FROM schema_migrations`);
    const expected = new Map(deps.migrations.map((migration) => [migration.id, migration.checksum]));
    const applied = new Map(rows.map((row) => [row.id, row.checksum]));
    const pending = deps.migrations.filter((migration) => !applied.has(migration.id)).map((migration) => migration.id);
    const drifted = rows
      .filter((row) => {
        const migration = deps.migrations.find((item) => item.id === row.id);
        return migration !== undefined && !migrationAcceptsChecksum(migration, row.checksum);
      })
      .map((row) => `checksum mismatch: ${row.id}`);
    const unknown = rows.filter((row) => !expected.has(row.id)).map((row) => `unknown migration: ${row.id}`);
    const migrationIssues = [...drifted, ...unknown];
    return {
      ok: pending.length === 0 && migrationIssues.length === 0,
      latencyMs: Date.now() - start,
      pendingMigrations: pending,
      migrationIssues,
    };
  } catch {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      pendingMigrations: [],
      migrationIssues: ["migration ledger unavailable"],
    };
  }
}
