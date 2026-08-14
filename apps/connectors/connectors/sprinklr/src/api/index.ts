import type {
  RawRequestOptions,
  SprinklrCase,
  SprinklrConfig,
  SprinklrEvent,
  SprinklrListResponse,
  SprinklrSearchRequest,
} from '../types';
import { SprinklrClient } from './client';

export class Sprinklr {
  private readonly client: SprinklrClient;

  constructor(config: SprinklrConfig) {
    this.client = new SprinklrClient(config);
  }

  static fromEnv(): Sprinklr {
    const apiKey = process.env.SPRINKLR_API_KEY;
    if (!apiKey) {
      throw new Error('SPRINKLR_API_KEY environment variable is required');
    }
    return new Sprinklr({
      apiKey,
      baseUrl: process.env.SPRINKLR_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getBaseUrl(): string {
    return this.client.getBaseUrl();
  }

  getClient(): SprinklrClient {
    return this.client;
  }

  async listCases(params?: Record<string, string | number | boolean | undefined>): Promise<SprinklrListResponse<SprinklrCase>> {
    return this.client.get<SprinklrListResponse<SprinklrCase>>('/cases', params);
  }

  async createCase(body: Record<string, unknown>): Promise<SprinklrCase> {
    return this.client.post<SprinklrCase>('/cases', body);
  }

  async getCase(caseId: string): Promise<SprinklrCase> {
    const encodedId = encodeURIComponent(caseId);
    return this.client.get<SprinklrCase>(`/cases/${encodedId}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<SprinklrListResponse<SprinklrEvent>> {
    return this.client.get<SprinklrListResponse<SprinklrEvent>>('/events', params);
  }

  async search(body: SprinklrSearchRequest): Promise<unknown> {
    return this.client.post('/search', body);
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request(path, { method, params: query, body, headers });
  }
}

export { SprinklrClient } from './client';
