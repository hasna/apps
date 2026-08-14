/**
 * Typed wrapper for the database adapter that exposes generic query<T> signatures.
 * The codebase uses db.query<T, P>(sql).get()/all() — P is informational only;
 * we only need T for return-type safety.
 */

export interface DbAdapter {
  exec(sql: string): void;
  close(): void;
  prepare(sql: string): {
    run(...params: any[]): { changes: number; lastInsertRowid?: number | bigint };
    get(...params: any[]): unknown;
    all(...params: any[]): unknown[];
  };
  transaction<T extends (...args: any[]) => any>(fn: T): T;
}

export interface TypedQueryResult<T> {
  get(...params: any[]): T | null;
  all(...params: any[]): T[];
}

export interface TypedDb extends DbAdapter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  query<T = unknown, _P = unknown>(sql: string): TypedQueryResult<T>;
}
