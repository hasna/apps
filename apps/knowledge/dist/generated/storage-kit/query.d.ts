import type { Pool, QueryResultRow } from "pg";
export interface QueryResult<T extends QueryResultRow> {
    rows: T[];
    rowCount: number;
}
/**
 * Minimal executor contract. `pg.Pool` and `pg.PoolClient` both satisfy the
 * `query` method; the wrapper builds the rest on top so tests can substitute a
 * lightweight shim without pulling in a live Postgres.
 */
export interface PgExecutor {
    query<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<{
        rows: T[];
        rowCount: number | null;
    }>;
}
export interface TypedQueryClient {
    query<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
    many<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
    /** First row or `null`. Restored here after open-knowledge dropped it. */
    get<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T | null>;
    /** Exactly one row; throws if zero or more than one row is returned. */
    one<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T>;
    execute(sql: string, params?: readonly unknown[]): Promise<void>;
}
/** Wrap any `PgExecutor` (a Pool, a PoolClient, or a test shim) with the typed vocabulary. */
export declare function wrapExecutor(executor: PgExecutor): TypedQueryClient;
export interface PoolQueryClient extends TypedQueryClient {
    readonly pool: Pool;
    /** Run a callback inside a `BEGIN`/`COMMIT` transaction on a dedicated client. */
    transaction<T>(fn: (client: TypedQueryClient) => Promise<T>): Promise<T>;
    close(): Promise<void>;
}
/** Build a `PoolQueryClient` around a live `pg.Pool`. */
export declare function createQueryClient(pool: Pool): PoolQueryClient;
