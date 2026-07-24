import { WizClient } from './client';
import type {
  WizConfig,
  WizEventsResponse,
  WizIssue,
  WizIssuesResponse,
  WizRawRequestOptions,
  WizSearchRequest,
  WizSearchResponse,
} from '../types';

export { WizClient } from './client';

export class Wiz {
  private readonly client: WizClient;

  constructor(config: WizConfig) {
    this.client = new WizClient(config);
  }

  static fromEnv(): Wiz {
    const apiKey = process.env.WIZ_API_KEY;
    if (!apiKey) throw new Error('WIZ_API_KEY is required');
    return new Wiz({
      apiKey,
      baseUrl: process.env.WIZ_BASE_URL,
    });
  }

  async listIssues(params?: Record<string, string | number | boolean | undefined>): Promise<WizIssuesResponse> {
    return this.client.request<WizIssuesResponse>('/issues', { params });
  }

  async createIssue(body: Record<string, unknown>): Promise<WizIssue> {
    return this.client.request<WizIssue>('/issues', { method: 'POST', body });
  }

  async getIssue(issueId: string): Promise<WizIssue> {
    const encoded = encodeURIComponent(issueId);
    return this.client.request<WizIssue>(`/issues/${encoded}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<WizEventsResponse> {
    return this.client.request<WizEventsResponse>('/events', { params });
  }

  async search(body: WizSearchRequest): Promise<WizSearchResponse> {
    return this.client.request<WizSearchResponse>('/search', { method: 'POST', body });
  }

  async rawRequest(options: WizRawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, body, params } = options;
    return this.client.request(path, { method, body, params });
  }

  getClient(): WizClient {
    return this.client;
  }
}
