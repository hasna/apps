// Tricentis Connector — Test automation platform API
import { TricentisClient } from './client';
import type {
  TricentisConfig,
  TricentisEvent,
  TricentisRawRequestOptions,
  TricentisSearchRequest,
  TricentisSearchResult,
  TricentisTest,
} from '../types';

export { TricentisClient, DEFAULT_BASE_URL } from './client';

export class Tricentis {
  private readonly client: TricentisClient;

  constructor(config: TricentisConfig) {
    this.client = new TricentisClient(config);
  }

  static fromEnv(): Tricentis {
    const apiKey = process.env.TRICENTIS_API_KEY;
    if (!apiKey) throw new Error('TRICENTIS_API_KEY is required');
    return new Tricentis({
      apiKey,
      baseUrl: process.env.TRICENTIS_BASE_URL,
    });
  }

  async listTests(params?: Record<string, string | number | boolean | undefined>): Promise<TricentisTest[] | { data: TricentisTest[] }> {
    return this.client.request('/tests', { params });
  }

  async createTest(body: Record<string, unknown>): Promise<TricentisTest | { data: TricentisTest }> {
    return this.client.request('/tests', { method: 'POST', body });
  }

  async getTest(testId: string): Promise<TricentisTest | { data: TricentisTest }> {
    return this.client.request(`/tests/${encodeURIComponent(testId)}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<TricentisEvent[] | { data: TricentisEvent[] }> {
    return this.client.request('/events', { params });
  }

  async search(body: TricentisSearchRequest): Promise<TricentisSearchResult> {
    return this.client.request('/search', { method: 'POST', body: body as Record<string, unknown> });
  }

  async rawRequest<T = unknown>(options: TricentisRawRequestOptions): Promise<T> {
    return this.client.request<T>(options.path, {
      method: options.method,
      body: options.body,
      params: options.params,
      headers: options.headers,
    });
  }

  getClient(): TricentisClient {
    return this.client;
  }
}
