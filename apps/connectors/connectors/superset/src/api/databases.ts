import type { SupersetClient } from './client';
import type { Database, ListOptions, ListResult } from '../types';

const RESOURCE = '/api/v1/database/';

/**
 * Databases API - list and fetch Superset database connections.
 */
export class DatabasesApi {
  constructor(private readonly client: SupersetClient) {}

  /** List database connections with optional filtering, ordering and pagination. */
  async list(options: ListOptions = {}): Promise<ListResult<Database>> {
    return this.client.list<Database>(RESOURCE, options);
  }

  /** Get a single database connection by id. */
  async get(id: number | string): Promise<Database> {
    return this.client.get<Database>(RESOURCE, id);
  }
}
