import type { WeightsBiasesConfig } from '../types';
import { WeightsBiasesClient } from './client';
import { RunsApi } from './runs';
import { EventsApi } from './events';
import { SearchApi } from './search';

export class WeightsBiases {
  private readonly client: WeightsBiasesClient;

  public readonly runs: RunsApi;
  public readonly events: EventsApi;
  public readonly search: SearchApi;

  constructor(config: WeightsBiasesConfig) {
    this.client = new WeightsBiasesClient(config);
    this.runs = new RunsApi(this.client);
    this.events = new EventsApi(this.client);
    this.search = new SearchApi(this.client);
  }

  static fromEnv(): WeightsBiases {
    const apiKey = process.env.WANDB_API_KEY;
    if (!apiKey) {
      throw new Error('WANDB_API_KEY environment variable is required');
    }
    return new WeightsBiases({
      apiKey,
      baseUrl: process.env.WANDB_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): WeightsBiasesClient {
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

export { WeightsBiasesClient } from './client';
export { RunsApi } from './runs';
export { EventsApi } from './events';
export { SearchApi } from './search';
