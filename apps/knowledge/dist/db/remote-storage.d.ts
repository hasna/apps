import type { Pool, QueryResultRow } from 'pg';
import type { PoolQueryClient } from '../generated/storage-kit/index.js';
export declare const KNOWLEDGE_APP_NAME = "knowledge";
export declare class PgAdapterAsync {
    private readonly client;
    constructor(connectionString: string);
    get pool(): Pool;
    run(sql: string, ...params: unknown[]): Promise<{
        changes: number;
    }>;
    all(sql: string, ...params: unknown[]): Promise<unknown[]>;
    get<T extends QueryResultRow = QueryResultRow>(sql: string, ...params: unknown[]): Promise<T | null>;
    close(): Promise<void>;
}
export declare function createKnowledgeCloudClient(): PoolQueryClient;
