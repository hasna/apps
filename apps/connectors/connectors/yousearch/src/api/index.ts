import type { YouSearchConfig } from '../types';
import { YouSearchClient } from './client';
import { SearchApi } from './search';
import { ResearchApi } from './research';

/**
 * You.com Search API Client
 */
export class YouSearch {
  private readonly client: YouSearchClient;

  public readonly search: SearchApi;
  public readonly research: ResearchApi;

  constructor(config: YouSearchConfig) {
    this.client = new YouSearchClient(config);
    this.search = new SearchApi(this.client);
    this.research = new ResearchApi(this.client);
  }

  /**
   * Create a client from environment variables
   * Looks for YOUSEARCH_API_KEY and optional YOUSEARCH_BASE_URL
   */
  static fromEnv(): YouSearch {
    const apiKey = process.env.YOUSEARCH_API_KEY;

    if (!apiKey) {
      throw new Error('YOUSEARCH_API_KEY environment variable is required');
    }

    return new YouSearch({
      apiKey,
      baseUrl: process.env.YOUSEARCH_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): YouSearchClient {
    return this.client;
  }

  /**
   * Make a raw authenticated request to any API path
   */
  async rawRequest<T = unknown>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown>;
    } = {}
  ): Promise<T> {
    return this.client.request<T>(path, options);
  }
}

export { YouSearchClient, DEFAULT_BASE_URL } from './client';
export { SearchApi } from './search';
export { ResearchApi } from './research';
