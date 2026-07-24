import type { Pool, QueryResultRow } from 'pg';
export interface QueryResult<T extends QueryResultRow> {
    rows: T[];
    rowCount: number;
}
export interface PgExecutor {
    query<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<{
        rows: T[];
        rowCount: number | null;
    }>;
}
export interface TypedQueryClient {
    query<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
    many<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
    get<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T | null>;
    one<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T>;
    execute(sql: string, params?: readonly unknown[]): Promise<void>;
}
export declare function wrapExecutor(executor: PgExecutor): TypedQueryClient;
export interface PoolQueryClient extends TypedQueryClient {
    readonly pool: Pool;
    transaction<T>(fn: (client: TypedQueryClient) => Promise<T>): Promise<T>;
    close(): Promise<void>;
}
export declare function createQueryClient(pool: Pool): PoolQueryClient;
