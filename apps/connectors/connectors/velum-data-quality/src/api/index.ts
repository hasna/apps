import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { ChecksApi } from './checks';
import { EventsApi } from './events';
import { SearchApi } from './search';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly checks: ChecksApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.checks = new ChecksApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.VELUM_DATA_QUALITY_API_KEY;
    const baseUrl = process.env.VELUM_DATA_QUALITY_BASE_URL;

    if (!apiKey) {
      throw new Error('VELUM_DATA_QUALITY_API_KEY environment variable is required');
    }

    return new Connector({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  async rawRequest<T = unknown>(options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    params?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown> | unknown[] | string;
    headers?: Record<string, string>;
  }): Promise<T> {
    return this.client.rawRequest<T>(options);
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { ChecksApi } from './checks';
export { EventsApi } from './events';
export { SearchApi } from './search';
