import type { SupersetClient } from './client';
import type { QueryRecord, ListOptions, ListResult } from '../types';

const RESOURCE = '/api/v1/query/';

/**
 * Queries API - list and fetch SQL Lab query execution records.
 */
export class QueriesApi {
  constructor(private readonly client: SupersetClient) {}

  /** List query records with optional filtering, ordering and pagination. */
  async list(options: ListOptions = {}): Promise<ListResult<QueryRecord>> {
    return this.client.list<QueryRecord>(RESOURCE, options);
  }

  /** Get a single query record by id. */
  async get(id: number | string): Promise<QueryRecord> {
    return this.client.get<QueryRecord>(RESOURCE, id);
  }
}
