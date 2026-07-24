import { TestmoClient } from './client';
import type {
  TestmoConfig,
  TestmoEvent,
  TestmoListEventsParams,
  TestmoListRunsParams,
  TestmoPaginatedResult,
  TestmoRun,
  TestmoSearchRequest,
} from '../types';

export { TestmoClient, DEFAULT_BASE_URL } from './client';

export class Testmo {
  private readonly client: TestmoClient;

  constructor(config: TestmoConfig) {
    this.client = new TestmoClient(config);
  }

  static fromEnv(): Testmo {
    const apiKey = process.env.TESTMO_API_KEY;
    const baseUrl = process.env.TESTMO_BASE_URL;

    if (!apiKey) {
      throw new Error('TESTMO_API_KEY environment variable is required');
    }

    return new Testmo({ apiKey, baseUrl });
  }

  async listRuns(params?: TestmoListRunsParams): Promise<TestmoPaginatedResult<TestmoRun>> {
    return this.client.request('/runs', { params: params as Record<string, string | number | boolean | undefined> });
  }

  async createRun(body: Record<string, unknown>): Promise<{ result?: TestmoRun } & Record<string, unknown>> {
    return this.client.request('/runs', { method: 'POST', body });
  }

  async getRun(runId: number | string, params?: { expands?: string }): Promise<{ result?: TestmoRun } & Record<string, unknown>> {
    return this.client.request(`/runs/${encodeURIComponent(String(runId))}`, {
      params: params as Record<string, string | number | boolean | undefined>,
    });
  }

  async listEvents(params?: TestmoListEventsParams): Promise<TestmoPaginatedResult<TestmoEvent>> {
    return this.client.request('/events', { params: params as Record<string, string | number | boolean | undefined> });
  }

  async search(body: TestmoSearchRequest): Promise<Record<string, unknown>> {
    return this.client.request('/search', { method: 'POST', body: body as Record<string, unknown> });
  }

  async rawRequest(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      params?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown>;
    } = {},
  ): Promise<unknown> {
    return this.client.request(path, options);
  }

  getClient(): TestmoClient {
    return this.client;
  }
}
