// Migration-ledger helper for the vendored Hasna storage kit.
//
// A `schema_migrations` ledger with per-migration sha256 checksums, modeled on
// loops' storage ledger. Guarantees:
//   - each migration runs at most once (idempotent by id),
//   - a migration whose SQL changed after being applied is detected as a
//     checksum mismatch and refuses to proceed (no silent drift),
//   - an applied migration unknown to this binary is detected (downgrade
//     guard),
//   - `dryRun` reports the plan without mutating anything.
//
// Migrations run against the server's PostgreSQL: there is no local schema
// and no sync of ledger rows between machines.

import { createHash } from "node:crypto";
import type { TypedQueryClient } from "./query.js";
import { ownProp, ownString } from "./own.js";

/**
 * A transaction-control statement, matched on the FIRST token of a statement
 * after comments and quoted bodies are stripped (see
 * {@link stripSqlBodies}). Each of these changes the transaction the migration
 * runs in, and any of them can close the ledger's outer transaction, commit
 * DDL outside it, and then leave the ledger empty when the later ledger write
 * fails. The ledger refuses them statically, before any SQL runs.
 */
const TRANSACTION_CONTROL_STATEMENT =
  /^(?:BEGIN|START\s+TRANSACTION|COMMIT(?:\s+PREPARED)?|END(?:\s+TRANSACTION)?|ROLLBACK(?:\s+TO\s+\S+)?(?:\s+PREPARED)?|ABORT|SAVEPOINT\s+\S+|RELEASE(?:\s+SAVEPOINT)?\s+\S+|PREPARE\s+TRANSACTION|SET\s+TRANSACTION)\b/i;

/**
 * Replace quoted bodies, comments, and quoted strings with spaces so that the
 * remaining text is statement structure only.
 *
 * A migration may legitimately contain `BEGIN`/`END` inside a plpgsql function
 * body (`$$ ... $$`) or a quoted string; those are body tokens, not statements,
 * and must not trip the guard. Everything left after stripping is the
 * statement skeleton, where a leading transaction-control word IS a statement.
 */
function stripSqlBodies(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      while (i < n - 1 && !(sql[i] === "*" && sql[i + 1] === "/")) {
        out += " ";
        i++;
      }
      if (i < n - 1) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    if (ch === "$") {
      // dollar-quoted body: $$ ... $$ or $tag$ ... $tag$
      const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (match) {
        const tag = match[0];
        out += " ".repeat(tag.length);
        i += tag.length;
        const end = sql.indexOf(tag, i);
        if (end === -1) {
          out += " ".repeat(n - i);
          i = n;
        } else {
          out += " ".repeat(end - i + tag.length);
          i = end + tag.length;
        }
        continue;
      }
    }
    if (ch === "'") {
      out += " ";
      i++;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            out += "  ";
            i += 2;
            continue;
          }
          out += " ";
          i++;
          break;
        }
        out += " ";
        i++;
      }
      continue;
    }
    if (ch === '"') {
      out += " ";
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            out += "  ";
            i += 2;
            continue;
          }
          out += " ";
          i++;
          break;
        }
        out += " ";
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Statically refuse a migration whose SQL issues transaction-control
 * statements. The diagnostic names the migration id ONLY — the SQL text is
 * never rendered (it can carry literals an operator would not want echoed).
 */
function assertNoTransactionControl(migration: Migration): void {
  const skeleton = stripSqlBodies(migration.sql);
  for (const statement of skeleton.split(";")) {
    if (TRANSACTION_CONTROL_STATEMENT.test(statement.trim())) {
      throw new Error(
        `Migration '${migration.id}' contains a transaction-control statement, which cannot run ` +
          `inside the migration ledger: it could commit DDL outside the ledger transaction and leave ` +
          `the ledger empty when the later ledger write fails. Rewrite it as plain DDL; the ledger ` +
          `applies and records each migration atomically.`,
      );
    }
  }
}

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
    // OWN-property read: `ledgerTable` is interpolated directly into DDL below,
    // so a prototype-supplied value is SQL injection rather than mere config
    // drift.
    this.ledgerTable = ownString(options, "ledgerTable") ?? DEFAULT_MIGRATION_LEDGER_TABLE;
    const seen = new Set<string>();
    for (const migration of migrations) {
      if (seen.has(migration.id)) throw new Error(`Duplicate migration id: ${migration.id}`);
      seen.add(migration.id);
    }
  }

  async ensureLedger(): Promise<void> {
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS ${this.ledgerTable} (
         id TEXT PRIMARY KEY,
         checksum TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
  }

  async listApplied(): Promise<AppliedMigration[]> {
    await this.ensureLedger();
    return this.readApplied();
  }

  private async readApplied(): Promise<AppliedMigration[]> {
    const rows = await this.client.many<LedgerRow>(
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
    // OWN-property read: a prototype-supplied `dryRun` would turn every
    // `migrate()` call into a no-op that still reports a plan.
    const dryRun = ownProp<unknown>(opts, "dryRun") === true;
    // Static guard BEFORE any SQL — even before the ledger table exists — so a
    // migration that could escape the ledger transaction is refused with
    // nothing executed, in dry-run and in apply alike.
    for (const migration of this.migrations) assertNoTransactionControl(migration);
    await this.ensureLedger();
    const applied = await this.readApplied();
    const plan = this.buildPlan(applied);
    if (dryRun) return { dryRun, applied, plan };

    for (const item of plan) {
      if (item.state === "already_applied") continue;
      await this.client.execute(item.migration.sql);
      await this.client.execute(
        `INSERT INTO ${this.ledgerTable} (id, checksum, applied_at) VALUES ($1, $2, now())`,
        [item.migration.id, item.migration.checksum],
      );
    }
    return { dryRun, applied: await this.readApplied(), plan };
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
