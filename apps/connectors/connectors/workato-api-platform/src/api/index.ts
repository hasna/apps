import type { ConnectorConfig, RawRequestOptions } from '../types';
import { ConnectorClient } from './client';
import { EventsApi } from './events';
import { ItemsApi } from './items';
import { SearchApi } from './search';

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
    const apiKey = process.env.WORKATO_API_PLATFORM_API_KEY;
    const baseUrl = process.env.WORKATO_API_PLATFORM_BASE_URL;

    if (!apiKey) {
      throw new Error('WORKATO_API_PLATFORM_API_KEY environment variable is required');
    }

    return new Connector({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request(path, { method, params: query, body, headers });
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { ItemsApi } from './items';
export { EventsApi } from './events';
export { SearchApi } from './search';
