import type {
  CreateTestBody,
  ListTestsParams,
  RawRequestOptions,
  RunTestParams,
  SearchBody,
  WebPageTestConfig,
} from '../types';
import { WebPageTestClient } from './client';

export class WebPageTest {
  private readonly client: WebPageTestClient;

  constructor(config: WebPageTestConfig) {
    this.client = new WebPageTestClient(config);
  }

  static fromEnv(): WebPageTest {
    const apiKey = process.env.WEBPAGETEST_API_KEY;
    if (!apiKey) {
      throw new Error('WEBPAGETEST_API_KEY environment variable is required');
    }
    return new WebPageTest({
      apiKey,
      baseUrl: process.env.WEBPAGETEST_BASE_URL,
      classicBaseUrl: process.env.WEBPAGETEST_CLASSIC_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): WebPageTestClient {
    return this.client;
  }

  async listTests(params: ListTestsParams = {}): Promise<unknown> {
    return this.client.get('/tests', params);
  }

  async createTest(body: CreateTestBody): Promise<unknown> {
    return this.client.post('/tests', body);
  }

  async getTest(testId: string): Promise<unknown> {
    return this.client.get(`/tests/${encodeURIComponent(testId)}`);
  }

  async listEvents(params: Record<string, string | number | boolean | undefined> = {}): Promise<unknown> {
    return this.client.get('/events', params);
  }

  async search(body: SearchBody): Promise<unknown> {
    return this.client.post('/search', body);
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request(path, { method, params: query, body, headers });
  }

  async runClassicTest(params: RunTestParams): Promise<unknown> {
    const { url, f = 'json', ...rest } = params;
    return this.client.request('/runtest.php', {
      method: 'POST',
      params: { url, f, ...rest },
      baseUrl: this.client.getClassicBaseUrl(),
    });
  }

  async getClassicTestStatus(testId: string, f: 'json' | 'xml' = 'json'): Promise<unknown> {
    return this.client.get('/testStatus.php', { test: testId, f }, this.client.getClassicBaseUrl());
  }

  async getClassicTestResult(testId: string, f: 'json' | 'xml' = 'json'): Promise<unknown> {
    return this.client.get('/jsonResult.php', { test: testId, f }, this.client.getClassicBaseUrl());
  }
}

export { WebPageTestClient, DEFAULT_CLASSIC_BASE_URL, DEFAULT_REST_BASE_URL } from './client';
