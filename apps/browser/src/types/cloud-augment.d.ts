/**
 * Typed wrapper for the database adapter that exposes generic query<T> signatures.
 * The codebase uses db.query<T, P>(sql).get()/all() — P is informational only;
 * we only need T for return-type safety.
 */
import type { DbAdapter } from "@hasna/cloud";

export interface TypedQueryResult<T> {
  get(...params: any[]): T | null;
  all(...params: any[]): T[];
}

export interface TypedDb extends DbAdapter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  query<T = unknown, _P = unknown>(sql: string): TypedQueryResult<T>;
}
