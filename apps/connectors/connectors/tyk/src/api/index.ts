import { TykClient } from './client';
import type {
  TykConfig,
  ApiDefinition,
  TykEvent,
  SearchRequest,
  RawRequestOptions,
} from '../types';

export { TykClient, DEFAULT_BASE_URL } from './client';

export class Tyk {
  private readonly client: TykClient;

  constructor(config: TykConfig) {
    this.client = new TykClient(config);
  }

  getClient(): TykClient {
    return this.client;
  }

  async listApis(params?: Record<string, string | number | boolean | undefined>): Promise<ApiDefinition[] | Record<string, unknown>> {
    return this.client.get<ApiDefinition[] | Record<string, unknown>>('/apis', params);
  }

  async createApi(body: Record<string, unknown>): Promise<ApiDefinition> {
    return this.client.post<ApiDefinition>('/apis', body);
  }

  async getApi(apiId: string): Promise<ApiDefinition> {
    const encodedId = encodeURIComponent(apiId);
    return this.client.get<ApiDefinition>(`/apis/${encodedId}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<TykEvent[] | Record<string, unknown>> {
    return this.client.get<TykEvent[] | Record<string, unknown>>('/events', params);
  }

  async search(body: SearchRequest): Promise<Record<string, unknown>> {
    return this.client.post<Record<string, unknown>>('/search', body);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, params, body, headers } = options;
    return this.client.request<T>(path, { method, params, body, headers });
  }
}
