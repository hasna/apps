import type { TwilioApiPlatformConfig, TwilioApiPlatformResponse } from '../types';
import { TwilioApiPlatformClient, type RequestOptions } from './client';

export { TwilioApiPlatformClient, DEFAULT_BASE_URL } from './client';

export class TwilioApiPlatform {
  private readonly client: TwilioApiPlatformClient;

  constructor(config: TwilioApiPlatformConfig) {
    this.client = new TwilioApiPlatformClient(config);
  }

  static fromEnv(): TwilioApiPlatform {
    const apiKey = process.env.TWILIO_API_PLATFORM_API_KEY;
    if (!apiKey) {
      throw new Error('TWILIO_API_PLATFORM_API_KEY environment variable is required');
    }
    return new TwilioApiPlatform({
      apiKey,
      baseUrl: process.env.TWILIO_API_PLATFORM_BASE_URL,
    });
  }

  async listItems(params?: Record<string, string | number | boolean | undefined>): Promise<TwilioApiPlatformResponse> {
    return this.client.get('/items', params);
  }

  async createItem(body: Record<string, unknown>): Promise<TwilioApiPlatformResponse> {
    return this.client.post('/items', body);
  }

  async getItem(itemId: string): Promise<TwilioApiPlatformResponse> {
    return this.client.get(`/items/${encodeURIComponent(itemId)}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<TwilioApiPlatformResponse> {
    return this.client.get('/events', params);
  }

  async search(body: Record<string, unknown>): Promise<TwilioApiPlatformResponse> {
    return this.client.post('/search', body);
  }

  async rawRequest(options: {
    path: string;
    method?: RequestOptions['method'];
    params?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown> | unknown[] | string;
    headers?: Record<string, string>;
  }): Promise<TwilioApiPlatformResponse> {
    return this.client.request(options.path, {
      method: options.method ?? 'GET',
      params: options.params,
      body: options.body,
      headers: options.headers,
    });
  }

  getClient(): TwilioApiPlatformClient {
    return this.client;
  }
}
