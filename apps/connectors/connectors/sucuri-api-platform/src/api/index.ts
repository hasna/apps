import type { ConnectorConfig, RawRequestParams } from '../types';
import { ConnectorClient } from './client';
import { ItemsApi } from './items';
import { EventsApi } from './events';
import { SearchApi } from './search';

/**
 * Sucuri API Platform Connector
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly items: ItemsApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.items = new ItemsApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.SUCURI_API_PLATFORM_API_KEY;
    const baseUrl = process.env.SUCURI_API_PLATFORM_BASE_URL;

    if (!apiKey) {
      throw new Error('SUCURI_API_PLATFORM_API_KEY environment variable is required');
    }

    return new Connector({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  /**
   * Execute an arbitrary API request
   */
  async rawRequest<T = unknown>(params: RawRequestParams): Promise<T> {
    const { path, method = 'GET', body, params: query } = params;
    return this.client.request<T>(path, { method, body, params: query });
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { ItemsApi } from './items';
export { EventsApi } from './events';
export { SearchApi } from './search';
