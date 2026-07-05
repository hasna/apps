import type {
  TursoApiPlatformConfig,
  TursoEvent,
  TursoItem,
  TursoSearchRequest,
} from '../types';
import { TursoApiPlatformClient } from './client';

export class TursoApiPlatform {
  private readonly client: TursoApiPlatformClient;

  constructor(config: TursoApiPlatformConfig) {
    this.client = new TursoApiPlatformClient(config);
  }

  static fromEnv(): TursoApiPlatform {
    const apiKey = process.env.TURSO_API_PLATFORM_API_KEY;
    if (!apiKey) {
      throw new Error('TURSO_API_PLATFORM_API_KEY environment variable is required');
    }
    return new TursoApiPlatform({
      apiKey,
      baseUrl: process.env.TURSO_API_PLATFORM_BASE_URL,
    });
  }

  getClient(): TursoApiPlatformClient {
    return this.client;
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  async listItems(params?: Record<string, string | number | boolean | undefined>): Promise<TursoItem[]> {
    return this.client.get<TursoItem[]>('/items', params);
  }

  async createItem(body: Record<string, unknown>): Promise<TursoItem> {
    return this.client.post<TursoItem>('/items', body);
  }

  async getItem(itemId: string): Promise<TursoItem> {
    const encodedId = encodeURIComponent(itemId);
    return this.client.get<TursoItem>(`/items/${encodedId}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<TursoEvent[]> {
    return this.client.get<TursoEvent[]>('/events', params);
  }

  async search(body: TursoSearchRequest): Promise<unknown> {
    return this.client.post('/search', body);
  }

  async rawRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
      headers?: Record<string, string>;
    },
  ): Promise<unknown> {
    return this.client.request(path, {
      method,
      params: options?.params,
      body: options?.body,
      headers: options?.headers,
    });
  }
}

export { TursoApiPlatformClient } from './client';
