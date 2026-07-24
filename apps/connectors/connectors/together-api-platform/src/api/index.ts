import type { TogetherApiPlatformConfig } from '../types';
import { TogetherApiPlatformClient, type RequestOptions } from './client';

export class TogetherApiPlatform {
  private readonly client: TogetherApiPlatformClient;

  constructor(config: TogetherApiPlatformConfig) {
    this.client = new TogetherApiPlatformClient(config);
  }

  static fromEnv(): TogetherApiPlatform {
    const apiKey = process.env.TOGETHER_API_PLATFORM_API_KEY;
    if (!apiKey) {
      throw new Error('TOGETHER_API_PLATFORM_API_KEY environment variable is required');
    }
    return new TogetherApiPlatform({
      apiKey,
      baseUrl: process.env.TOGETHER_API_PLATFORM_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async listItems(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.listItems(params);
  }

  async createItem(
    body: Record<string, unknown>,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<unknown> {
    return this.client.createItem(body, params);
  }

  async getItem(itemId: string): Promise<unknown> {
    return this.client.getItem(itemId);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.listEvents(params);
  }

  async search(
    body: Record<string, unknown>,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<unknown> {
    return this.client.search(body, params);
  }

  async rawRequest(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.client.rawRequest(path, options);
  }

  getClient(): TogetherApiPlatformClient {
    return this.client;
  }
}

export { TogetherApiPlatformClient, DEFAULT_BASE_URL } from './client';
export type { RequestOptions } from './client';
