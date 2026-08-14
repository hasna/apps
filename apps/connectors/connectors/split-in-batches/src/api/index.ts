import type { ConnectorConfig, RawRequestOptions } from '../types';
import { ConnectorClient } from './client';
import { BatchesApi } from './batches';
import { EventsApi } from './events';
import { SearchApi } from './search';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly batches: BatchesApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.batches = new BatchesApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.SPLIT_IN_BATCHES_API_KEY;
    if (!apiKey) {
      throw new Error('SPLIT_IN_BATCHES_API_KEY environment variable is required');
    }

    return new Connector({
      apiKey,
      baseUrl: process.env.SPLIT_IN_BATCHES_BASE_URL,
    });
  }

  rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient } from './client';
export { BatchesApi } from './batches';
export { EventsApi } from './events';
export { SearchApi } from './search';
