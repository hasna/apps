// TestRigor Connector — AI-powered automated testing platform
import { TestRigorClient } from './client';
import type {
  TestRigorConfig,
  TestRigorSuite,
  TestRigorEvent,
  TestRigorSearchResult,
} from '../types';

export { TestRigorClient, DEFAULT_BASE_URL } from './client';

export class TestRigor {
  private readonly client: TestRigorClient;

  constructor(config: TestRigorConfig) {
    this.client = new TestRigorClient(config);
  }

  static fromEnv(): TestRigor {
    const apiKey = process.env.TESTRIGOR_API_KEY;
    if (!apiKey) throw new Error('TESTRIGOR_API_KEY is required');
    return new TestRigor({
      apiKey,
      baseUrl: process.env.TESTRIGOR_BASE_URL,
    });
  }

  async listSuites(options?: { params?: Record<string, string | number | undefined> }): Promise<unknown> {
    return this.client.request('/suites', { params: options?.params });
  }

  async createSuite(body: Record<string, unknown>): Promise<unknown> {
    return this.client.request('/suites', { method: 'POST', body });
  }

  async getSuite(suiteId: string): Promise<TestRigorSuite> {
    return this.client.request<TestRigorSuite>(`/suites/${encodeURIComponent(suiteId)}`);
  }

  async listEvents(options?: { params?: Record<string, string | number | undefined> }): Promise<unknown> {
    return this.client.request('/events', { params: options?.params });
  }

  async search(body: Record<string, unknown>): Promise<TestRigorSearchResult> {
    return this.client.request<TestRigorSearchResult>('/search', { method: 'POST', body });
  }

  async rawRequest(
    path: string,
    options?: {
      method?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string | number | undefined>;
    },
  ): Promise<unknown> {
    return this.client.request(path, options);
  }

  getClient(): TestRigorClient {
    return this.client;
  }
}
