import type { SupersetClient } from './client';
import type { SavedQuery, ListOptions, ListResult } from '../types';

const RESOURCE = '/api/v1/saved_query/';

/**
 * Saved Queries API - list and fetch SQL Lab saved queries.
 */
export class SavedQueriesApi {
  constructor(private readonly client: SupersetClient) {}

  /** List saved queries with optional filtering, ordering and pagination. */
  async list(options: ListOptions = {}): Promise<ListResult<SavedQuery>> {
    return this.client.list<SavedQuery>(RESOURCE, options);
  }

  /** Get a single saved query by id. */
  async get(id: number | string): Promise<SavedQuery> {
    return this.client.get<SavedQuery>(RESOURCE, id);
  }
}
