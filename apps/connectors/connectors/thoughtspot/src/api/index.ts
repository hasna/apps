import type { ConnectorConfig, RawRequestOptions } from '../types';
import { ConnectorClient } from './client';
import { EventsApi } from './events';
import { LiveboardsApi } from './liveboards';
import { SearchApi } from './search';

export class ThoughtSpot {
  private readonly client: ConnectorClient;

  public readonly liveboards: LiveboardsApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.liveboards = new LiveboardsApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): ThoughtSpot {
    const apiKey = process.env.THOUGHTSPOT_API_KEY;
    const baseUrl = process.env.THOUGHTSPOT_BASE_URL;
    if (!apiKey) {
      throw new Error('THOUGHTSPOT_API_KEY environment variable is required');
    }
    if (!baseUrl) {
      throw new Error('THOUGHTSPOT_BASE_URL environment variable is required');
    }
    return new ThoughtSpot({ apiKey, baseUrl });
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, encodePathSegment } from './client';
export { LiveboardsApi } from './liveboards';
export { EventsApi } from './events';
export { SearchApi } from './search';
