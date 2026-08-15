import type { StripeAppsClient } from './client';
import type { SearchOptions, SearchResponse } from '../types';

/**
 * Search API - full-text/entity search (POST /search).
 */
export class SearchApi {
  constructor(private readonly client: StripeAppsClient) {}

  search(options: SearchOptions): Promise<SearchResponse> {
    if (!options.query) {
      throw new Error('query is required');
    }

    const body: Record<string, unknown> = { query: options.query };
    if (options.limit !== undefined) {
      body.limit = options.limit;
    }
    if (options.cursor) {
      body.cursor = options.cursor;
    }
    if (options.filters && Object.keys(options.filters).length > 0) {
      body.filters = options.filters;
    }

    return this.client.post<SearchResponse>('/search', body);
  }
}
