import type {
  StripeFinancialConnectionsConfig,
  ListItemsResponse,
  FinancialConnectionItem,
  ListEventsResponse,
  SearchResponse,
  RawRequestOptions,
} from '../types';
import { StripeFinancialConnectionsClient } from './client';

export { StripeFinancialConnectionsClient };

export class StripeFinancialConnections {
  private readonly client: StripeFinancialConnectionsClient;

  constructor(config: StripeFinancialConnectionsConfig) {
    this.client = new StripeFinancialConnectionsClient(config);
  }

  static fromEnv(): StripeFinancialConnections {
    const apiKey = process.env.STRIPE_FINANCIAL_CONNECTIONS_API_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_FINANCIAL_CONNECTIONS_API_KEY environment variable is required');
    }
    return new StripeFinancialConnections({
      apiKey,
      baseUrl: process.env.STRIPE_FINANCIAL_CONNECTIONS_BASE_URL,
    });
  }

  getClient(): StripeFinancialConnectionsClient {
    return this.client;
  }

  async listItems(params?: Record<string, string | number | boolean | undefined>): Promise<ListItemsResponse> {
    return this.client.get<ListItemsResponse>('/items', params);
  }

  async createItem(body: Record<string, unknown>): Promise<FinancialConnectionItem> {
    return this.client.post<FinancialConnectionItem>('/items', body);
  }

  async getItem(itemId: string): Promise<FinancialConnectionItem> {
    return this.client.get<FinancialConnectionItem>(`/items/${encodeURIComponent(itemId)}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<ListEventsResponse> {
    return this.client.get<ListEventsResponse>('/events', params);
  }

  async search(body: Record<string, unknown>): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', body);
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, query, body, headers } = options;
    const params = query as Record<string, string | number | boolean | undefined> | undefined;
    return this.client.request(path, { method, params, body, headers });
  }
}
