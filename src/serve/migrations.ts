// Migration runner for projects-serve (Amendment A1 pure-remote Postgres).
//
// Source of truth is the SQL files in the repo `migrations/` directory, applied
// in filename order through the vendored storage kit's MigrationLedger (which
// records a sha256 checksum per migration and refuses to run on drift). The
// api-keys table migrations from @hasna/contracts/auth are appended so the auth
// middleware's ApiKeyStore has its schema.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiKeyMigrations } from "@hasna/contracts/auth";
import type { QueryResultRow } from "pg";
import {
  type AppliedMigration,
  DEFAULT_MIGRATION_LEDGER_TABLE,
  MigrationLedger,
  defineMigration,
  type Migration,
  type MigrationResult,
} from "../generated/storage-kit/index.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";

export const MIGRATIONS_DIR_ENV = "PROJECTS_MIGRATIONS_DIR";

export interface AppliedMigrationCompatibility {
  readonly id: string;
  readonly checksum: string;
}

/**
 * Applied-only ledger rows from the pre-rename production schema.
 *
 * This is deliberately not an executable migration: fresh databases must not
 * record it, and no legacy SQL is reconstructed or replayed. The checksum was
 * emitted by deploy run 31171363160 from the production migration ledger.
 */
export const PROJECTS_APPLIED_MIGRATION_COMPATIBILITY = [
  {
    id: "projects:0002_tenants",
    checksum: "sha256:0a93c3c87fa9159545f270a053835f28e3b0eed5d8d13ec886c3aa549287bcd2",
  },
] as const satisfies readonly AppliedMigrationCompatibility[];

/** Resolve the on-disk migrations directory across dev, dist, and Docker layouts. */
export function resolveMigrationsDir(): string {
  const override = process.env[MIGRATIONS_DIR_ENV];
  if (override && existsSync(override)) return resolve(override);

  const here = (() => {
    try {
      return dirname(fileURLToPath(import.meta.url));
    } catch {
      return process.cwd();
    }
  })();

  const candidates = [
    join(process.cwd(), "migrations"),
    join(here, "migrations"),
    join(here, "..", "migrations"),
    join(here, "..", "..", "migrations"),
    join(here, "..", "..", "..", "migrations"),
    "/app/migrations",
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "0001_baseline.sql"))) return dir;
  }
  throw new Error(
    `projects-serve: migrations directory not found (looked in: ${candidates.join(", ")}). ` +
      `Set ${MIGRATIONS_DIR_ENV} to the directory containing the *.sql files.`,
  );
}

/** Load the ordered baseline SQL migrations from disk plus the api-keys migrations. */
export function loadMigrations(): Migration[] {
  const dir = resolveMigrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
  const schema = files.map((file) =>
    defineMigration(`projects:${file.replace(/\.sql$/, "")}`, readFileSync(join(dir, file), "utf-8")),
  );
  const apiKeys = apiKeyMigrations().map((m) => defineMigration(m.id, m.sql));
  return [...schema, ...apiKeys];
}

/**
 * Add checksum evidence to the storage kit's drift/downgrade guard without
 * accepting unknown migrations or changing the ledger.
 */
export function assertMigrationCompatibility(
  migrations: readonly Migration[],
  applied: readonly AppliedMigration[],
  compatibility: readonly AppliedMigrationCompatibility[] = [],
): void {
  const knownById = new Map(migrations.map((migration) => [migration.id, migration]));
  const compatibleById = new Map<string, AppliedMigrationCompatibility>();

  for (const entry of compatibility) {
    if (knownById.has(entry.id)) {
      throw new Error(
        `Applied-only migration compatibility '${entry.id}' conflicts with an executable migration.`,
      );
    }
    if (compatibleById.has(entry.id)) {
      throw new Error(`Duplicate applied-only migration compatibility id: ${entry.id}`);
    }
    compatibleById.set(entry.id, entry);
  }

  for (const row of applied) {
    const expected = knownById.get(row.id)?.checksum ?? compatibleById.get(row.id)?.checksum;
    if (!expected) {
      throw new Error(
        `Applied migration '${row.id}' (checksum '${row.checksum}') is not recognized by this build (downgrade?).`,
      );
    }
    if (expected !== row.checksum) {
      throw new Error(
        `Migration checksum mismatch for '${row.id}': applied '${row.checksum}', expected '${expected}'.`,
      );
    }
  }
}

function appliedMigrationKey(row: AppliedMigrationCompatibility): string {
  return `${row.id}\u0000${row.checksum}`;
}

/**
 * Give the unchanged generated ledger a view without exact applied-only rows.
 *
 * The complete ledger is validated immediately before and after migration.
 * This adapter filters only rows matching both the allowlisted id and checksum,
 * so concurrent unknown rows, checksum drift, and downgrade evidence remain
 * visible to the generated ledger and continue to fail closed.
 */
function createAppliedMigrationCompatibilityClient(
  client: TypedQueryClient,
  compatibility: readonly AppliedMigrationCompatibility[],
): TypedQueryClient {
  const compatibleRows = new Set(compatibility.map(appliedMigrationKey));

  return {
    query<T extends QueryResultRow>(sql: string, params?: readonly unknown[]) {
      return client.query<T>(sql, params);
    },
    async many<T extends QueryResultRow>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<T[]> {
      if (!sql.includes(`FROM ${DEFAULT_MIGRATION_LEDGER_TABLE}`)) {
        throw new Error(
          "Applied migration compatibility client received an unexpected ledger query.",
        );
      }
      const rows = await client.many<T>(sql, params);
      return rows.filter((row) => {
        const candidate = row as Partial<AppliedMigrationCompatibility>;
        return !(
          typeof candidate.id === "string" &&
          typeof candidate.checksum === "string" &&
          compatibleRows.has(appliedMigrationKey({
            id: candidate.id,
            checksum: candidate.checksum,
          }))
        );
      });
    },
    get<T extends QueryResultRow>(sql: string, params?: readonly unknown[]) {
      return client.get<T>(sql, params);
    },
    one<T extends QueryResultRow>(sql: string, params?: readonly unknown[]) {
      return client.one<T>(sql, params);
    },
    execute(sql: string, params?: readonly unknown[]) {
      return client.execute(sql, params);
    },
  };
}

export async function runMigrationLedgerWithCompatibility(
  client: TypedQueryClient,
  migrations: readonly Migration[],
  compatibility: readonly AppliedMigrationCompatibility[],
  opts: { dryRun?: boolean } = {},
): Promise<MigrationResult> {
  const completeLedger = new MigrationLedger(client, migrations);
  assertMigrationCompatibility(migrations, await completeLedger.listApplied(), compatibility);

  const migrationClient = createAppliedMigrationCompatibilityClient(client, compatibility);
  const result = await new MigrationLedger(migrationClient, migrations).migrate(opts);

  const applied = await completeLedger.listApplied();
  assertMigrationCompatibility(migrations, applied, compatibility);
  return { ...result, applied };
}

/** Apply all pending migrations against the given cloud client. */
export async function runProjectsMigrations(
  client: TypedQueryClient,
  opts: { dryRun?: boolean } = {},
): Promise<MigrationResult> {
  const migrations = loadMigrations();
  return runMigrationLedgerWithCompatibility(
    client,
    migrations,
    PROJECTS_APPLIED_MIGRATION_COMPATIBILITY,
    opts,
  );
}
