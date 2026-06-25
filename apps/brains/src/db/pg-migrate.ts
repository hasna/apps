import { PG_MIGRATIONS } from "./pg-migrations.js";
import { PgAdapterAsync } from "./remote-storage.js";

export interface PgMigrationResult {
  applied: number[];
  alreadyApplied: number[];
  errors: string[];
}

export async function applyPgMigrations(connectionString: string): Promise<PgMigrationResult> {
  const remote = new PgAdapterAsync(connectionString);
  const result: PgMigrationResult = { applied: [], alreadyApplied: [], errors: [] };

  try {
    await remote.exec(`
      CREATE TABLE IF NOT EXISTS migrations_log (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const rows = await remote.all("SELECT version FROM migrations_log") as Array<{ version: number }>;
    const applied = new Set(rows.map((row) => row.version));

    for (let index = 0; index < PG_MIGRATIONS.length; index++) {
      const version = index + 1;
      if (applied.has(version)) {
        result.alreadyApplied.push(version);
        continue;
      }

      try {
        await remote.exec(PG_MIGRATIONS[index]!);
        await remote.run("INSERT INTO migrations_log (version) VALUES (?) ON CONFLICT DO NOTHING", version);
        result.applied.push(version);
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    await remote.close();
  }

  return result;
}
