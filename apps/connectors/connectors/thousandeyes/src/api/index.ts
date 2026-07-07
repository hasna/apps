import type { ThousandEyesConfig } from '../types';
import { ThousandEyesClient } from './client';

export class ThousandEyes {
  private readonly client: ThousandEyesClient;

  constructor(config: ThousandEyesConfig) {
    this.client = new ThousandEyesClient(config);
  }

  static fromEnv(): ThousandEyes {
    const apiKey = process.env.THOUSANDEYES_API_KEY;
    const baseUrl = process.env.THOUSANDEYES_BASE_URL;

    if (!apiKey) {
      throw new Error('THOUSANDEYES_API_KEY environment variable is required');
    }

    return new ThousandEyes({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): ThousandEyesClient {
    return this.client;
  }

  async listTests(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get('/tests', params);
  }

  async createTest(testType: string, body: Record<string, unknown>): Promise<unknown> {
    if (!testType) {
      throw new Error('Test type is required');
    }
    return this.client.post(`/tests/${encodeURIComponent(testType)}/`, body);
  }

  async getTest(testId: string): Promise<unknown> {
    return this.client.get(`/tests/${encodeURIComponent(testId)}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    return this.client.get('/events', params);
  }

  async search(body: Record<string, unknown>): Promise<unknown> {
    return this.client.post('/search', body);
  }

  async rawRequest(options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    params?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown> | unknown[] | string;
    headers?: Record<string, string>;
  }): Promise<unknown> {
    return this.client.request(options.path, {
      method: options.method,
      params: options.params,
      body: options.body,
      headers: options.headers,
    });
  }

  async validate(): Promise<{ valid: boolean }> {
    await this.client.get('/users');
    return { valid: true };
  }
}

export { ThousandEyesClient } from './client';
