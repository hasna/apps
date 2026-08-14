import type { ConnectorConfig, RawRequestOptions } from '../types';
import { ConnectorClient } from './client';

/**
 * Weaviate API Platform connector for item management, events, and vector search.
 */
export class Connector {
  private readonly client: ConnectorClient;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.WEAVIATE_API_PLATFORM_API_KEY;
    if (!apiKey) {
      throw new Error('WEAVIATE_API_PLATFORM_API_KEY environment variable is required');
    }
    return new Connector({
      apiKey,
      baseUrl: process.env.WEAVIATE_API_PLATFORM_BASE_URL,
    });
  }

  async listItems(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get('/items', params);
  }

  async createItem(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/items', body);
  }

  async getItem(itemId: string): Promise<unknown> {
    const encoded = this.client.encodePathSegment(itemId);
    return this.client.get(`/items/${encoded}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get('/events', params);
  }

  async search(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/search', body);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    return this.client.rawRequest<T>(options);
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
