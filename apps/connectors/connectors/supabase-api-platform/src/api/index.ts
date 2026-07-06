import type { SupabaseApiPlatformConfig } from '../types';
import { SupabaseApiPlatformClient, type RequestOptions } from './client';

export class SupabaseApiPlatform {
  private readonly client: SupabaseApiPlatformClient;

  constructor(config: SupabaseApiPlatformConfig) {
    this.client = new SupabaseApiPlatformClient(config);
  }

  static fromEnv(): SupabaseApiPlatform {
    const accessToken = process.env.SUPABASE_API_PLATFORM_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error('SUPABASE_API_PLATFORM_ACCESS_TOKEN environment variable is required');
    }
    return new SupabaseApiPlatform({
      accessToken,
      baseUrl: process.env.SUPABASE_API_PLATFORM_BASE_URL,
    });
  }

  getAccessTokenPreview(): string {
    return this.client.getAccessTokenPreview();
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

  async getItem(projectRef: string): Promise<unknown> {
    return this.client.getItem(projectRef);
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

  getClient(): SupabaseApiPlatformClient {
    return this.client;
  }
}

export { SupabaseApiPlatformClient, DEFAULT_BASE_URL } from './client';
export type { RequestOptions } from './client';
