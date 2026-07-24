import type { Pool, QueryResultRow } from 'pg';
import type { PoolQueryClient } from '../generated/storage-kit/index.js';
import { KnowledgeContainmentError } from '../runtime-role.js';

export const KNOWLEDGE_APP_NAME = 'knowledge';

function containedRemoteStorage(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED',
    503,
    'hosted-client',
    'public-api',
    'remote database clients are unavailable during Stage A',
  );
}

export class PgAdapterAsync {
  declare private readonly client: PoolQueryClient;

  constructor(connectionString: string) {
    containedRemoteStorage();
  }

  get pool(): Pool {
    return containedRemoteStorage();
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    return containedRemoteStorage();
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    return containedRemoteStorage();
  }

  async get<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    ...params: unknown[]
  ): Promise<T | null> {
    return containedRemoteStorage();
  }

  async close(): Promise<void> {
    return containedRemoteStorage();
  }
}

export function createKnowledgeCloudClient(): PoolQueryClient {
  return containedRemoteStorage();
}
