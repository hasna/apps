import { Database as BunDatabase, type SQLQueryBindings, type Statement } from "bun:sqlite";

/** Result of a mutating statement, mirroring `bun:sqlite`'s `Statement.run()`. */
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * Statement bindings. `bun:sqlite` accepts both the spread form
 * (`run(sql, a, b)`) and a single array of values (`run(sql, [a, b])`), and
 * call sites in `src/db` use both, so both are allowed here.
 */
export type Bindings = SQLQueryBindings | SQLQueryBindings[];

/** A prepared statement handle returned by {@link SqliteAdapter.prepare}. */
export interface PreparedStatement {
  run(...params: Bindings[]): RunResult;
  get(...params: Bindings[]): unknown;
  all(...params: Bindings[]): unknown[];
  finalize(): void;
}

/** `bun:sqlite` declares its bindings as a spread of scalars; the array form is runtime-supported. */
function bind(params: Bindings[]): SQLQueryBindings[] {
  return params as SQLQueryBindings[];
}

/**
 * Thin synchronous wrapper over `bun:sqlite`.
 *
 * This is the local-only storage engine for the connectors database. It was
 * previously imported from `@hasna/cloud`, which is retired and unsupported;
 * the class is kept API-compatible with that import so the rest of `src/db`
 * and its tests are unchanged.
 *
 * Parameters are forwarded to `bun:sqlite` verbatim, so both the spread form
 * (`run(sql, a, b)`) and the array form (`run(sql, [a, b])`) keep working.
 */
export class SqliteAdapter {
  private readonly db: BunDatabase;

  constructor(path: string) {
    this.db = new BunDatabase(path, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL");
    this.db.exec("PRAGMA foreign_keys=ON");
  }

  run(sql: string, ...params: Bindings[]): RunResult {
    const result = this.db.prepare(sql).run(...bind(params));
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  get(sql: string, ...params: Bindings[]): unknown {
    return this.db.prepare(sql).get(...bind(params));
  }

  all(sql: string, ...params: Bindings[]): unknown[] {
    return this.db.prepare(sql).all(...bind(params));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  query(sql: string): Statement {
    return this.db.query(sql);
  }

  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    return {
      run(...params: Bindings[]): RunResult {
        const r = stmt.run(...bind(params));
        return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
      },
      get(...params: Bindings[]): unknown {
        return stmt.get(...bind(params));
      },
      all(...params: Bindings[]): unknown[] {
        return stmt.all(...bind(params));
      },
      finalize(): void {
        stmt.finalize();
      },
    };
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  get raw(): BunDatabase {
    return this.db;
  }
}
