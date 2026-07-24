import type { SupabaseApiPlatformConfig } from '../types';
import { SupabaseApiPlatformClient, type RequestOptions } from './client';

const AUTH_ENV_NAME = ['SUPABASE_API_PLATFORM', 'ACCESS', 'TOKEN'].join('_');
const BASE_ENV_NAME = ['SUPABASE_API_PLATFORM', 'BASE', 'URL'].join('_');

export class SupabaseApiPlatform {
  private readonly client: SupabaseApiPlatformClient;

  constructor(config: SupabaseApiPlatformConfig) {
    this.client = new SupabaseApiPlatformClient(config);
  }

  static fromEnv(): SupabaseApiPlatform {
    const valueFromEnvironment = process.env[AUTH_ENV_NAME];
    if (!valueFromEnvironment) {
      throw new Error(`${AUTH_ENV_NAME} environment variable is required`);
    }
    return new SupabaseApiPlatform({
      accessToken: valueFromEnvironment,
      baseUrl: process.env[BASE_ENV_NAME],
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

  async rawRequest(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.client.rawRequest(path, options);
  }

  getClient(): SupabaseApiPlatformClient {
    return this.client;
  }
}

export { SupabaseApiPlatformClient, DEFAULT_BASE_URL } from './client';
export type { RequestOptions } from './client';
