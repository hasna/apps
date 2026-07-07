import type { JsonObject, JsonValue, RawRequestOptions, XaiApiPlatformConfig } from '../types';
import { XaiApiPlatformClient } from './client';

export class XaiApiPlatform {
  private readonly client: XaiApiPlatformClient;

  constructor(config: XaiApiPlatformConfig) {
    this.client = new XaiApiPlatformClient(config);
  }

  static fromEnv(): XaiApiPlatform {
    const apiKey = process.env.XAI_API_PLATFORM_API_KEY;
    if (!apiKey) {
      throw new Error('XAI_API_PLATFORM_API_KEY environment variable is required');
    }
    return new XaiApiPlatform({
      apiKey,
      baseUrl: process.env.XAI_API_PLATFORM_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async listItems(
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<JsonValue> {
    return this.client.get<JsonValue>('/items', query);
  }

  async createItem(body: JsonObject): Promise<JsonValue> {
    return this.client.post<JsonValue>('/items', body);
  }

  async getItem(itemId: string): Promise<JsonValue> {
    const encoded = this.client.encodePathSegment(itemId);
    return this.client.get<JsonValue>(`/items/${encoded}`);
  }

  async listEvents(
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<JsonValue> {
    return this.client.get<JsonValue>('/events', query);
  }

  async search(body: JsonObject): Promise<JsonValue> {
    return this.client.post<JsonValue>('/search', body);
  }

  async rawRequest(path: string, options: RawRequestOptions = {}): Promise<JsonValue> {
    return this.client.request<JsonValue>(path, options);
  }

  getClient(): XaiApiPlatformClient {
    return this.client;
  }
}

export { XaiApiPlatformClient, DEFAULT_BASE_URL } from './client';
