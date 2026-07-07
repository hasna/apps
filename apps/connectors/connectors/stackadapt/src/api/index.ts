import type { ConnectorConfig } from '../types';
import { ConnectorClient } from './client';
import { CampaignsApi } from './campaigns';
import { EventsApi } from './events';

export class Connector {
  private readonly client: ConnectorClient;

  public readonly campaigns: CampaignsApi;
  public readonly events: EventsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.campaigns = new CampaignsApi(this.client);
    this.events = new EventsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.STACKADAPT_API_KEY || process.env.STACKADAPT_TOKEN;
    if (!apiKey) {
      throw new Error('STACKADAPT_API_KEY environment variable is required');
    }

    return new Connector({
      apiKey,
      baseUrl: process.env.STACKADAPT_BASE_URL,
      graphqlUrl: process.env.STACKADAPT_GRAPHQL_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }

  async rawRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
      baseUrl?: string;
    }
  ): Promise<T> {
    return this.client.request<T>(path, {
      method,
      params: options?.params,
      body: options?.body,
      baseUrl: options?.baseUrl,
    });
  }

  async graphql<T>(query: string, variables?: Record<string, unknown>, operationName?: string): Promise<T> {
    return this.client.graphql<T>({ query, variables, operationName });
  }
}

export { ConnectorClient, DEFAULT_REST_BASE_URL, DEFAULT_GRAPHQL_URL } from './client';
export { CampaignsApi } from './campaigns';
export { EventsApi } from './events';
