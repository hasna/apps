import { TykApiPlatformClient } from './client';
import type {
  TykApiPlatformConfig,
  Item,
  Event,
  SearchRequest,
  RawRequestOptions,
} from '../types';

export { TykApiPlatformClient, DEFAULT_BASE_URL } from './client';

export class TykApiPlatform {
  private readonly client: TykApiPlatformClient;

  constructor(config: TykApiPlatformConfig) {
    this.client = new TykApiPlatformClient(config);
  }

  getClient(): TykApiPlatformClient {
    return this.client;
  }

  async listItems(params?: Record<string, string | number | boolean | undefined>): Promise<Item[] | Record<string, unknown>> {
    return this.client.get<Item[] | Record<string, unknown>>('/items', params);
  }

  async createItem(body: Record<string, unknown>): Promise<Item> {
    return this.client.post<Item>('/items', body);
  }

  async getItem(itemId: string): Promise<Item> {
    const encodedId = encodeURIComponent(itemId);
    return this.client.get<Item>(`/items/${encodedId}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<Event[] | Record<string, unknown>> {
    return this.client.get<Event[] | Record<string, unknown>>('/events', params);
  }

  async search(body: SearchRequest): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>('/search', body);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, params, body, headers } = options;
    return this.client.request<T>(path, { method, params, body, headers });
  }
}
