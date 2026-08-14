import type { JsonRecord, WhatsappCloudApiConfig } from '../types';
import { WhatsappCloudApiClient, type RequestOptions } from './client';

export { WhatsappCloudApiClient, DEFAULT_BASE_URL } from './client';
export type { RequestOptions } from './client';

export class WhatsappCloudApi {
  private readonly client: WhatsappCloudApiClient;

  constructor(config: WhatsappCloudApiConfig) {
    this.client = new WhatsappCloudApiClient(config);
  }

  static fromEnv(): WhatsappCloudApi {
    const apiKey = process.env.WHATSAPP_CLOUD_API_KEY;
    if (!apiKey) {
      throw new Error('WHATSAPP_CLOUD_API_KEY environment variable is required');
    }
    return new WhatsappCloudApi({
      apiKey,
      baseUrl: process.env.WHATSAPP_CLOUD_API_BASE_URL,
    });
  }

  async listItems(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.request('/items', { params });
  }

  async createItem(body: JsonRecord): Promise<unknown> {
    return this.client.request('/items', { method: 'POST', body });
  }

  async getItem(itemId: string): Promise<unknown> {
    const encoded = encodeURIComponent(itemId);
    return this.client.request(`/items/${encoded}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.request('/events', { params });
  }

  async search(body: JsonRecord): Promise<unknown> {
    return this.client.request('/search', { method: 'POST', body });
  }

  async rawRequest(options: {
    path: string;
    method?: RequestOptions['method'];
    query?: Record<string, string | number | boolean | undefined>;
    body?: JsonRecord | unknown[];
    headers?: Record<string, string>;
  }): Promise<unknown> {
    return this.client.request(options.path, {
      method: options.method,
      params: options.query,
      body: options.body,
      headers: options.headers,
    });
  }

  getClient(): WhatsappCloudApiClient {
    return this.client;
  }
}
