import type { ConnectorConfig, RawRequestParams, SearchParams } from '../types';
import { ConnectorClient } from './client';
import { EventsApi } from './events';
import { ReportsApi } from './reports';

export class Connector {
  private readonly client: ConnectorClient;
  public readonly reports: ReportsApi;
  public readonly events: EventsApi;

  constructor(config: ConnectorConfig) {
    this.client = new ConnectorClient(config);
    this.reports = new ReportsApi(this.client);
    this.events = new EventsApi(this.client);
  }

  static fromEnv(): Connector {
    const apiKey = process.env.TIMESAVED_API_KEY || process.env.TIMESAVED_TOKEN;
    const baseUrl = process.env.TIMESAVED_BASE_URL;

    if (!apiKey) {
      throw new Error('TIMESAVED_API_KEY environment variable is required');
    }

    return new Connector({ apiKey, baseUrl });
  }

  search(body: SearchParams): Promise<unknown> {
    return this.client.post<unknown>('/search', body);
  }

  rawRequest<T = unknown>(options: RawRequestParams): Promise<T> {
    return this.client.rawRequest<T>(options);
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ConnectorClient {
    return this.client;
  }
}

export { ConnectorClient, encodePathSegment } from './client';
export { ReportsApi } from './reports';
export { EventsApi } from './events';
