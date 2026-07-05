import type { WeightsBiasesApiPlatformConfig } from '../types';
import { WeightsBiasesApiPlatformClient } from './client';
import { ItemsApi } from './items';
import { EventsApi } from './events';
import { SearchApi } from './search';

export class WeightsBiasesApiPlatform {
  private readonly client: WeightsBiasesApiPlatformClient;

  public readonly items: ItemsApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: WeightsBiasesApiPlatformConfig) {
    this.client = new WeightsBiasesApiPlatformClient(config);
    this.items = new ItemsApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): WeightsBiasesApiPlatform {
    const apiKey = process.env.WEIGHTS_BIASES_API_PLATFORM_API_KEY;
    if (!apiKey) {
      throw new Error('WEIGHTS_BIASES_API_PLATFORM_API_KEY environment variable is required');
    }
    return new WeightsBiasesApiPlatform({
      apiKey,
      baseUrl: process.env.WEIGHTS_BIASES_API_PLATFORM_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): WeightsBiasesApiPlatformClient {
    return this.client;
  }

  async rawRequest<T = unknown>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    return this.client.request<T>(path, options);
  }
}

export { WeightsBiasesApiPlatformClient } from './client';
export { ItemsApi } from './items';
export { EventsApi } from './events';
export { SearchApi } from './search';
