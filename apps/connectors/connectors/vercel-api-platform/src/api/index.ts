import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ItemsApi } from './items';
import { EventsApi } from './events';
import { SearchApi } from './search';
import { RawApi } from './raw';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly items: ItemsApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;
  public readonly raw: RawApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.items = new ItemsApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
    this.raw = new RawApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.VERCEL_API_PLATFORM_API_KEY;
    if (!apiKey) {
      throw new Error('VERCEL_API_PLATFORM_API_KEY environment variable is required');
    }
    return new Connector({
      apiKey,
      baseUrl: process.env.VERCEL_API_PLATFORM_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { ItemsApi } from './items';
export { EventsApi } from './events';
export { SearchApi } from './search';
export { RawApi } from './raw';
