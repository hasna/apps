// @generated from the @hasna/contracts 0.4.0 declarations; Stage-A runtime containment stub.
import type { Pool, QueryResultRow } from 'pg';
import { KnowledgeContainmentError } from '../../runtime-role.js';

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

function containedQuery(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED', 503, 'hosted-client', 'public-api',
    'query clients are unavailable during Stage A',
  );
}

export function wrapExecutor(executor: PgExecutor): TypedQueryClient {
  return containedQuery();
}

export interface PoolQueryClient extends TypedQueryClient {
  readonly pool: Pool;
  transaction<T>(fn: (client: TypedQueryClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createQueryClient(pool: Pool): PoolQueryClient {
  return containedQuery();
}
