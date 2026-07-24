// Generic, domain-agnostic PostgreSQL migration engine for Personal Notes.
//
// Ledgered DDL migrations with a transaction-scoped advisory lock and per-
// migration sha256 checksum verification (hasna-storage-standard, adapted from
// the open-loops reference). This class only knows how to APPLY migrations; the
// note CRUD lives in `postgres-note-storage.ts` and composes it.

import type {
  AppliedStorageMigration,
  SchemaMigrationStorage,
  StorageMigration,
  StorageMigrationPlanItem,
  StorageMigrationResult,
} from "./contract.js";
import {
  POSTGRES_MIGRATION_ADVISORY_LOCK_SQL,
  POSTGRES_MIGRATION_LEDGER_TABLE,
  POSTGRES_STORAGE_MIGRATIONS,
} from "./postgres-schema.js";

/** Minimal executor the migration engine (and CRUD layer) run SQL through. */
export interface PostgresQueryExecutor {
  query<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
  transaction?<T>(fn: (executor: PostgresQueryExecutor) => Promise<T>): Promise<T>;
  close?(): Promise<void> | void;
}

interface MigrationLedgerRow extends Record<string, unknown> {
  id: string;
  checksum: string;
  applied_at: string | Date;
}

export class PostgresStorage implements SchemaMigrationStorage {
  readonly backend = "postgres" as const;
  readonly migrations: readonly StorageMigration[];

  constructor(
    protected readonly executor: PostgresQueryExecutor,
    migrations: readonly StorageMigration[] = POSTGRES_STORAGE_MIGRATIONS,
  ) {
    this.migrations = migrations;
  }

  async listAppliedMigrations(): Promise<AppliedStorageMigration[]> {
    // Reading the applied set must NOT create the ledger — that would race with a
    // concurrent migrator's `CREATE TABLE`. Absent ledger simply means "nothing applied".
    return this.tryReadAppliedMigrations();
  }

  async migrate(opts: { dryRun?: boolean; through?: string } = {}): Promise<StorageMigrationResult> {
    const dryRun = opts.dryRun === true;
    const throughIndex =
      opts.through === undefined
        ? this.migrations.length - 1
        : this.migrations.findIndex((m) => m.id === opts.through);
    if (throughIndex < 0) throw new Error(`Unknown Postgres migration target ${opts.through}`);

    if (dryRun) {
      const applied = await this.tryReadAppliedMigrations();
      return { backend: this.backend, dryRun, applied, plan: this.buildPlan(applied) };
    }

    let plan: StorageMigrationPlanItem[] = [];

    const run = async (executor: PostgresQueryExecutor = this.executor) => {
      // Acquire the transaction-scoped advisory lock FIRST so the ledger's
      // `CREATE TABLE IF NOT EXISTS` (which is not concurrency-safe on its own)
      // and all migration DDL are serialized across competing migrators.
      await executor.query(POSTGRES_MIGRATION_ADVISORY_LOCK_SQL);
      await this.ensureLedger(executor);
      const lockedApplied = await this.readAppliedMigrations(executor);
      plan = this.buildPlan(lockedApplied);
      for (const [index, item] of plan.entries()) {
        if (index > throughIndex) break;
        if (item.state === "already_applied") continue;
        await executor.execute(item.migration.sql);
        await executor.execute(
          `INSERT INTO ${POSTGRES_MIGRATION_LEDGER_TABLE} (id, checksum, applied_at) VALUES ($1, $2, NOW())`,
          [item.migration.id, item.migration.checksum],
        );
      }
    };
    if (this.executor.transaction) await this.executor.transaction(run);
    else await run();

    return { backend: this.backend, dryRun, applied: await this.readAppliedMigrations(), plan };
  }

  async close(): Promise<void> {
    await this.executor.close?.();
  }

  protected async ensureLedger(executor: PostgresQueryExecutor = this.executor): Promise<void> {
    await executor.execute(`
CREATE TABLE IF NOT EXISTS ${POSTGRES_MIGRATION_LEDGER_TABLE} (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL
);
    `);
  }

  private async readAppliedMigrations(
    executor: PostgresQueryExecutor = this.executor,
  ): Promise<AppliedStorageMigration[]> {
    const rows = await executor.query<MigrationLedgerRow>(
      `SELECT id, checksum, applied_at FROM ${POSTGRES_MIGRATION_LEDGER_TABLE} ORDER BY id ASC`,
    );
    return rows.map((row) => ({
      id: row.id,
      checksum: row.checksum,
      appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at),
    }));
  }

  private async tryReadAppliedMigrations(): Promise<AppliedStorageMigration[]> {
    try {
      return await this.readAppliedMigrations();
    } catch (error) {
      if (isMissingLedgerError(error)) return [];
      throw error;
    }
  }

  private buildPlan(applied: AppliedStorageMigration[]): StorageMigrationPlanItem[] {
    const known = new Set(this.migrations.map((m) => m.id));
    for (const row of applied) {
      if (!known.has(row.id)) {
        throw new Error(`Postgres migration ${row.id} is not recognized by this binary`);
      }
    }
    const appliedById = new Map(applied.map((row) => [row.id, row]));
    for (const m of this.migrations) {
      const existing = appliedById.get(m.id);
      if (existing && existing.checksum !== m.checksum) {
        throw new Error(`Postgres migration checksum mismatch for ${m.id}`);
      }
    }
    return this.migrations.map((migration) => ({
      migration,
      state: appliedById.has(migration.id) ? "already_applied" : "pending",
    }));
  }
}

export function createPostgresStorage(executor: PostgresQueryExecutor): PostgresStorage {
  return new PostgresStorage(executor);
}

function isMissingLedgerError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes(POSTGRES_MIGRATION_LEDGER_TABLE.toLowerCase()) &&
    (message.includes("does not exist") ||
      message.includes("no such table") ||
      message.includes("undefined_table"))
  );
}
