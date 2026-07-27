import { Database, type SQLQueryBindings } from "bun:sqlite";

/** Result of a mutating statement, mirroring `bun:sqlite`'s `Statement.run()`. */
export type RunResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

/**
 * Thin synchronous wrapper over `bun:sqlite` backing the `storage.cloud`
 * `backend: "sqlite"` usage ledger.
 *
 * Both pragmas are per-connection in SQLite and therefore have to be re-applied on
 * every open: `journal_mode=WAL` keeps concurrent ledger readers from blocking the
 * writer, and `foreign_keys=ON` makes SQLite actually enforce foreign keys. SQLite
 * defaults foreign key enforcement to OFF, so dropping that pragma would not raise an
 * error — it would silently turn every `ON DELETE CASCADE` and every foreign key
 * constraint into a no-op.
 */
export class SqliteAdapter {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA foreign_keys=ON");
  }

  run(sql: string, ...params: SQLQueryBindings[]): RunResult {
    const result = this.db.prepare(sql).run(...params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  all(sql: string, ...params: SQLQueryBindings[]): unknown[] {
    return this.db.prepare(sql).all(...params);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}
