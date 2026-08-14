import type {
  VelumLabsConfig,
  Dataset,
  Event,
  SearchRequest,
  SearchResponse,
  RawRequestOptions,
} from '../types';
import { VelumLabsClient } from './client';

export class VelumLabs {
  private readonly client: VelumLabsClient;

  constructor(config: VelumLabsConfig) {
    this.client = new VelumLabsClient(config);
  }

  static fromEnv(): VelumLabs {
    const apiKey = process.env.VELUM_LABS_API_KEY;
    if (!apiKey) {
      throw new Error('VELUM_LABS_API_KEY environment variable is required');
    }
    return new VelumLabs({
      apiKey,
      baseUrl: process.env.VELUM_LABS_BASE_URL,
    });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  async listDatasets(params?: Record<string, string | number | boolean | undefined>): Promise<Dataset[] | { data: Dataset[] }> {
    return this.client.get<Dataset[] | { data: Dataset[] }>('/datasets', params);
  }

  async createDataset(body: Record<string, unknown>): Promise<Dataset> {
    return this.client.post<Dataset>('/datasets', body);
  }

  async getDataset(datasetId: string): Promise<Dataset> {
    const encodedId = encodeURIComponent(datasetId);
    return this.client.get<Dataset>(`/datasets/${encodedId}`);
  }

  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<Event[] | { data: Event[] }> {
    return this.client.get<Event[] | { data: Event[] }>('/events', params);
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', request);
  }

  async rawRequest(options: RawRequestOptions): Promise<unknown> {
    const { method = 'GET', path, query, body, headers } = options;
    return this.client.request(path, { method, params: query, body, headers });
  }

  getClient(): VelumLabsClient {
    return this.client;
  }
}

export { VelumLabsClient, DEFAULT_BASE_URL } from './client';
