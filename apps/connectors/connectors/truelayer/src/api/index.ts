import type { TrueLayerConfig } from '../types';
import { TrueLayerClient } from './client';
import { PaymentsApi } from './payments';
import { EventsApi } from './events';
import { SearchApi } from './search';

/**
 * Main TrueLayer open banking API connector.
 */
export class TrueLayer {
  private readonly client: TrueLayerClient;

  public readonly payments: PaymentsApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: TrueLayerConfig) {
    this.client = new TrueLayerClient(config);
    this.payments = new PaymentsApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): TrueLayer {
    const accessToken = process.env.TRUELAYER_ACCESS_TOKEN;
    const sandbox = process.env.TRUELAYER_SANDBOX === 'true' || process.env.TRUELAYER_SANDBOX === '1';
    const baseUrl = process.env.TRUELAYER_BASE_URL;

    if (!accessToken) {
      throw new Error('TRUELAYER_ACCESS_TOKEN environment variable is required');
    }

    return new TrueLayer({ accessToken, sandbox, baseUrl });
  }

  getTokenPreview(): string {
    return this.client.getTokenPreview();
  }

  isSandbox(): boolean {
    return this.client.isSandbox();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getClient(): TrueLayerClient {
    return this.client;
  }

  async rawRequest<T = unknown>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      params?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    return this.client.request<T>(path, options);
  }
}

export { TrueLayerClient } from './client';
export { PaymentsApi } from './payments';
export { EventsApi } from './events';
export { SearchApi } from './search';
