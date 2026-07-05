import type {
  WindmillApiPlatformConfig,
  ItemRecord,
  SearchRequest,
  RawRequestOptions,
} from '../types';
import { WindmillApiPlatformClient } from './client';

export class WindmillApiPlatform {
  private readonly client: WindmillApiPlatformClient;

  constructor(config: WindmillApiPlatformConfig) {
    this.client = new WindmillApiPlatformClient(config);
  }

  async listItems(query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.listItems(query);
  }

  async createItem(body: ItemRecord): Promise<unknown> {
    return this.client.createItem(body);
  }

  async getItem(itemId: string): Promise<unknown> {
    return this.client.getItem(itemId);
  }

  async listEvents(query?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.listEvents(query);
  }

  async search(body: SearchRequest): Promise<unknown> {
    return this.client.search(body);
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    return this.client.rawRequest(options);
  }

  static fromEnv(): WindmillApiPlatform {
    const apiKey = process.env.WINDMILL_API_PLATFORM_API_KEY;
    if (!apiKey) {
      throw new Error('WINDMILL_API_PLATFORM_API_KEY environment variable is required');
    }
    return new WindmillApiPlatform({
      apiKey,
      baseUrl: process.env.WINDMILL_API_PLATFORM_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }
}

export { WindmillApiPlatformClient, DEFAULT_BASE_URL } from './client';
