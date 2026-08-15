import type { StripeAppsConfig, RawRequestOptions } from '../types';
import { StripeAppsClient } from './client';
import { ItemsApi } from './items';
import { EventsApi } from './events';
import { SearchApi } from './search';

/**
 * Stripe Apps API client.
 * Provides access to items, events, search, and raw requests.
 */
export class StripeApps {
  private readonly client: StripeAppsClient;

  public readonly items: ItemsApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: StripeAppsConfig) {
    this.client = new StripeAppsClient(config);
    this.items = new ItemsApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  /**
   * Perform an arbitrary request against any Stripe Apps endpoint.
   * Useful for endpoints not yet wrapped by a typed helper.
   */
  raw<T = unknown>(options: RawRequestOptions): Promise<T> {
    return this.client.request<T>(options.path, {
      method: options.method,
      params: options.params,
      body: options.body,
    });
  }

  /**
   * Create a client from environment variables.
   * Reads STRIPEAPPS_API_KEY and optional STRIPEAPPS_BASE_URL.
   */
  static fromEnv(): StripeApps {
    const apiKey = process.env.STRIPEAPPS_API_KEY;
    if (!apiKey) {
      throw new Error('STRIPEAPPS_API_KEY environment variable is required');
    }
    return new StripeApps({ apiKey, baseUrl: process.env.STRIPEAPPS_BASE_URL });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): StripeAppsClient {
    return this.client;
  }
}

export { StripeAppsClient, DEFAULT_BASE_URL } from './client';
export { ItemsApi } from './items';
export { EventsApi } from './events';
export { SearchApi } from './search';
