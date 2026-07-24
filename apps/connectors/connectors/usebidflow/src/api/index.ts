import type { UsebidflowConfig, RawRequestOptions } from '../types';
import { UsebidflowClient } from './client';
import { BidsApi } from './bids';
import { EventsApi } from './events';

export class Usebidflow {
  private readonly client: UsebidflowClient;

  public readonly bids: BidsApi;
  public readonly events: EventsApi;

  constructor(config: UsebidflowConfig) {
    this.client = new UsebidflowClient(config);
    this.bids = new BidsApi(this.client);
    this.events = new EventsApi(this.client);
  }

  static fromEnv(): Usebidflow {
    const apiKey = process.env.USEBIDFLOW_API_KEY;
    if (!apiKey) {
      throw new Error('USEBIDFLOW_API_KEY environment variable is required');
    }
    return new Usebidflow({
      apiKey,
      baseUrl: process.env.USEBIDFLOW_BASE_URL,
    });
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, body, params, headers } = options;
    return this.client.request<T>(path, {
      method: method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
      body,
      params,
      headers,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): UsebidflowClient {
    return this.client;
  }
}

export { UsebidflowClient, DEFAULT_BASE_URL } from './client';
export { BidsApi } from './bids';
export { EventsApi } from './events';
