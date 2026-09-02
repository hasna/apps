// Application-owned server storage, derived from @hasna/contracts 0.8.2.
// See README.md for provenance; this is not an unmodified generated registry kit.

// Migration-ledger helper for the vendored Hasna storage kit.
//
// A `schema_migrations` ledger with per-migration sha256 checksums, modeled on
// open-loops' storage ledger. Guarantees:
//   - each migration runs at most once (idempotent by id),
//   - a migration whose SQL changed after being applied is detected as a
//     checksum mismatch and refuses to proceed (no silent drift),
//   - an applied migration unknown to this binary is detected (downgrade
//     guard),
//   - `dryRun` reports the plan without mutating anything.
//
// PURE REMOTE (Amendment A1): migrations run against the cloud Postgres. There
// is no local schema and no sync of ledger rows between machines.

import { createHash } from "node:crypto";
import type { TypedQueryClient } from "./query.js";

/** Default ledger table name. Override per app if a legacy name exists. */
export const DEFAULT_MIGRATION_LEDGER_TABLE = "schema_migrations";

export interface Migration {
  readonly id: string;
  readonly sql: string;
  readonly checksum: string;
}

export type MigrationState = "already_applied" | "pending";

export interface MigrationPlanItem {
  readonly migration: Migration;
  readonly state: MigrationState;
}

export interface AppliedMigration {
  readonly id: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface MigrationResult {
  readonly dryRun: boolean;
  readonly applied: AppliedMigration[];
  readonly plan: MigrationPlanItem[];
}

/** Stable sha256 checksum for a migration's SQL text. */
export function checksumSql(sql: string): string {
  const normalized = sql.trim().replace(/\r\n/g, "\n");
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}

/** Freeze a migration definition, computing its checksum from the SQL. */
export function defineMigration(id: string, sql: string): Migration {
  return Object.freeze({ id, sql: sql.trim(), checksum: checksumSql(sql) });
}

/** Restrict this app's migration vocabulary to transaction-safe schema DDL.
 * Lex strings/identifiers/comments first so a hidden COMMIT cannot end our lock.
 * Procedures, dollar quoting and arbitrary SQL require a separately reviewed runner.
 */
export function validateTransactionalSql(sql: string): void {
  let plain = "";
  for (let i = 0; i < sql.length;) {
    const c = sql[i]!;
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i); i = end < 0 ? sql.length : end; plain += " "; continue;
    }
    if (sql.startsWith("/*", i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) { depth++; i += 2; }
        else if (sql.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error("Unterminated migration comment.");
      plain += " "; continue;
    }
    if (c === "'" || c === '"') {
      const quote = c; i++; let closed = false;
      while (i < sql.length) {
        if (sql[i] === "\\") throw new Error("Migration escape strings require review.");
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { i += 2; continue; }
          i++; closed = true; break;
        }
        i++;
      }
      if (!closed) throw new Error("Unterminated migration quote.");
      plain += " identifier "; continue;
    }
    if (c === "$") throw new Error("Migration dollar quoting requires review.");
    plain += c; i++;
  }
  const statements = plain.split(";").map(s => s.trim()).filter(Boolean);
  if (!statements.length || statements.some(s =>
    !/^(CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX|EXTENSION)|ALTER\s+TABLE|DROP\s+(TABLE|INDEX))\b/i.test(s) ||
    /\b(CONCURRENTLY|COMMIT|ROLLBACK|BEGIN|ABORT|SAVEPOINT|TRANSACTION)\b/i.test(s)
  )) throw new Error("Migration must contain only supported transactional schema DDL.");
}

interface LedgerRow {
  id: string;
  checksum: string;
  applied_at: string | Date;
}

export interface MigrationRunnerOptions {
  ledgerTable?: string;
}

export class MigrationLedger {
  private readonly ledgerTable: string;

  constructor(
    private readonly client: TypedQueryClient,
    private readonly migrations: readonly Migration[],
    options: MigrationRunnerOptions = {},
  ) {
    this.ledgerTable = options.ledgerTable ?? DEFAULT_MIGRATION_LEDGER_TABLE;
    if (!/^[a-z_][a-z0-9_]*$/i.test(this.ledgerTable)) throw new Error("Invalid migration ledger identifier.");
    this.migrations = Object.freeze(migrations.map(m => Object.freeze({ id: m.id, sql: m.sql, checksum: m.checksum })));
    const seen = new Set<string>();
    for (const migration of this.migrations) {
      if (seen.has(migration.id)) throw new Error(`Duplicate migration id: ${migration.id}`);
      seen.add(migration.id);
      validateTransactionalSql(migration.sql);
      if (migration.checksum !== checksumSql(migration.sql)) throw new Error("Invalid migration checksum.");
    }
  }

  private async ensureLedger(client: TypedQueryClient): Promise<void> {
    await client.execute(
      `CREATE TABLE IF NOT EXISTS ${this.ledgerTable} (
         id TEXT PRIMARY KEY,
         checksum TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
  }

  async listApplied(): Promise<AppliedMigration[]> {
    const existing = await this.client.get<{ relation: string | null }>("SELECT to_regclass($1) AS relation", [this.ledgerTable]);
    if (!existing?.relation) return [];
    return this.readApplied();
  }

  private async readApplied(client: TypedQueryClient = this.client): Promise<AppliedMigration[]> {
    const rows = await client.many<LedgerRow>(
      `SELECT id, checksum, applied_at FROM ${this.ledgerTable} ORDER BY id ASC`,
    );
    return rows.map((row) => ({
      id: row.id,
      checksum: row.checksum,
      appliedAt: row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at),
    }));
  }

  /** Compute the migration plan and guard against drift/downgrade. */
  private buildPlan(applied: AppliedMigration[]): MigrationPlanItem[] {
    const known = new Set(this.migrations.map((m) => m.id));
    for (const row of applied) {
      if (!known.has(row.id)) {
        throw new Error(`Applied migration '${row.id}' is not recognized by this build (downgrade?).`);
      }
    }
    const appliedById = new Map(applied.map((row) => [row.id, row]));
    for (const migration of this.migrations) {
      const existing = appliedById.get(migration.id);
      if (existing && existing.checksum !== migration.checksum) {
        throw new Error(
          `Migration checksum mismatch for '${migration.id}': the SQL changed after it was applied.`,
        );
      }
    }
    return this.migrations.map((migration) => ({
      migration,
      state: appliedById.has(migration.id) ? "already_applied" : "pending",
    }));
  }

  /** Apply all pending migrations. With `dryRun`, report the plan only. */
  async migrate(opts: { dryRun?: boolean } = {}): Promise<MigrationResult> {
    const dryRun = opts.dryRun === true;
    if (dryRun) {
      const applied = await this.listApplied();
      return { dryRun, applied, plan: this.buildPlan(applied) };
    }
    if (!this.client.transaction) throw new Error("Migrations require a dedicated transactional client.");
    return this.client.transaction(async client => {
      // Planning must see the preceding holder's commit, even if the database
      // default isolation is REPEATABLE READ and the lock acquisition waited.
      await client.execute("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      // One database-wide, transaction-scoped app lock, acquired before ledger DDL
      // and planning. It covers first startup and concurrent callers in all schemas.
      await client.execute("SELECT pg_advisory_xact_lock(1096045635, 1)");
      await this.ensureLedger(client);
      const plan = this.buildPlan(await this.readApplied(client));
      for (const item of plan) {
        if (item.state === "already_applied") continue;
        await client.execute(item.migration.sql);
        await client.execute(
          `INSERT INTO ${this.ledgerTable} (id, checksum, applied_at) VALUES ($1, $2, now())`,
          [item.migration.id, item.migration.checksum],
        );
      }
      return { dryRun, applied: await this.readApplied(client), plan };
    });
  }
}

/** Convenience: build a ledger and run all pending migrations. */
export function createMigrationLedger(
  client: TypedQueryClient,
  migrations: readonly Migration[],
  options: MigrationRunnerOptions = {},
): MigrationLedger {
  return new MigrationLedger(client, migrations, options);
}
