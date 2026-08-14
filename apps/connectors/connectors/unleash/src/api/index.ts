import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { FlagsApi } from './flags';
import { EventsApi } from './events';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly flags: FlagsApi;
  public readonly events: EventsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.flags = new FlagsApi(this.client);
    this.events = new EventsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.UNLEASH_API_KEY;
    const baseUrl = process.env.UNLEASH_BASE_URL;
    const projectId = process.env.UNLEASH_PROJECT;

    if (!apiKey) {
      throw new Error('UNLEASH_API_KEY environment variable is required');
    }

    return new Connector({ apiKey, baseUrl, projectId });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  /**
   * Make a raw Admin API request
   */
  async rawRequest<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    options?: {
      body?: Record<string, unknown> | unknown[] | string;
      params?: Record<string, string | number | boolean | undefined>;
    }
  ): Promise<T> {
    return this.client.request<T>(path, {
      method,
      body: options?.body,
      params: options?.params,
    });
  }
}

export { ConnectorClient, DEFAULT_BASE_URL, DEFAULT_PROJECT_ID } from './client';
export { FlagsApi } from './flags';
export { EventsApi } from './events';
