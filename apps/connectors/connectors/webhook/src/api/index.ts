import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { HooksApi } from './hooks';
import { EventsApi } from './events';
import { SearchApi } from './search';

/**
 * Webhook API Connector
 */
export class Connector {
  private readonly client: ConnectorClient;

  public readonly hooks: HooksApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.hooks = new HooksApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.WEBHOOK_API_KEY;
    const baseUrl = process.env.WEBHOOK_BASE_URL;

    if (!apiKey) {
      throw new Error('WEBHOOK_API_KEY environment variable is required');
    }

    return new Connector({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  /** Arbitrary authenticated API request */
  async rawRequest(options: {
    path: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
    headers?: Record<string, string>;
  }): Promise<unknown> {
    return this.client.request(options.path, {
      method: options.method ?? 'GET',
      params: options.query,
      body: options.body,
      headers: options.headers,
    });
  }
}

export { ConnectorClient, DEFAULT_BASE_URL } from './client';
export { HooksApi } from './hooks';
export { EventsApi } from './events';
export { SearchApi } from './search';
