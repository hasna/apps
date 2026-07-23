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
import {
  hasProtectedPostgresMigrationAuthority,
  isProtectedPostgresMigration,
} from "./postgres-protected-migration.js";

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
  readonly backend = "postgres";
  readonly migrations: readonly StorageMigration[];

  constructor(
    private readonly executor: PostgresQueryExecutor,
    migrations: readonly StorageMigration[] = POSTGRES_STORAGE_MIGRATIONS,
  ) {
    this.migrations = migrations;
  }

  async listAppliedMigrations(): Promise<AppliedStorageMigration[]> {
    await this.ensureLedger();
    return this.readAppliedMigrations();
  }

  async migrate(opts: { dryRun?: boolean; through?: string } = {}): Promise<StorageMigrationResult> {
    const dryRun = opts.dryRun === true;
    const throughIndex = opts.through === undefined
      ? this.migrations.length - 1
      : this.migrations.findIndex((migration) => migration.id === opts.through);
    if (throughIndex < 0) throw new Error(`Unknown Postgres migration target ${opts.through}`);
    const protectedMigration = this.migrations
      .slice(0, throughIndex + 1)
      .find(isProtectedPostgresMigration);
    if (
      !dryRun &&
      protectedMigration &&
      !hasProtectedPostgresMigrationAuthority(this)
    ) {
      throw new Error(
        `protected Postgres migration ${protectedMigration.id} requires the internal canonical identity cutover route`,
      );
    }

    if (dryRun) {
      const applied = await this.tryReadAppliedMigrations();
      const plan = this.buildPlan(applied);
      return { backend: this.backend, dryRun, applied, plan };
    }

    await this.ensureLedger();
    let plan: StorageMigrationPlanItem[] = [];

    const run = async (executor: PostgresQueryExecutor = this.executor) => {
      await executor.query(POSTGRES_MIGRATION_ADVISORY_LOCK_SQL);
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

    return {
      backend: this.backend,
      dryRun,
      applied: await this.readAppliedMigrations(),
      plan,
    };
  }

  async close(): Promise<void> {
    await this.executor.close?.();
  }

  private async ensureLedger(): Promise<void> {
    await this.executor.execute(`
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
      appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : row.applied_at,
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
    const knownMigrationIds = new Set(this.migrations.map((migration) => migration.id));
    for (const row of applied) {
      if (!knownMigrationIds.has(row.id)) {
        throw new Error(`Postgres migration ${row.id} is not recognized by this binary`);
      }
    }
    const appliedById = new Map(applied.map((row) => [row.id, row]));
    for (const migration of this.migrations) {
      const existing = appliedById.get(migration.id);
      if (existing && existing.checksum !== migration.checksum) {
        throw new Error(`Postgres migration checksum mismatch for ${migration.id}`);
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
  return message.includes(POSTGRES_MIGRATION_LEDGER_TABLE.toLowerCase())
    && (message.includes("does not exist") || message.includes("no such table") || message.includes("undefined_table"));
}
