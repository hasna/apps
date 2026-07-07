import type {
  StopAndErrorConfig,
  ListErrorsResponse,
  ListEventsResponse,
  WorkflowError,
  CreateErrorParams,
  SearchParams,
  SearchResponse,
  RawRequestOptions,
} from '../types';
import { StopAndErrorClient } from './client';

export class StopAndError {
  private readonly client: StopAndErrorClient;

  constructor(config: StopAndErrorConfig) {
    this.client = new StopAndErrorClient(config);
  }

  static fromEnv(): StopAndError {
    const apiKey = process.env.STOP_AND_ERROR_API_KEY;
    const baseUrl = process.env.STOP_AND_ERROR_BASE_URL;

    if (!apiKey) {
      throw new Error('STOP_AND_ERROR_API_KEY environment variable is required');
    }

    return new StopAndError({ apiKey, baseUrl });
  }

  getApiKeyPreview(): string {
    return this.client.getApiKeyPreview();
  }

  getClient(): StopAndErrorClient {
    return this.client;
  }

  async listErrors(params?: { cursor?: string; limit?: number }): Promise<ListErrorsResponse> {
    return this.client.get<ListErrorsResponse>('/errors', params);
  }

  async getError(id: string): Promise<WorkflowError> {
    return this.client.get<WorkflowError>(`/errors/${encodeURIComponent(id)}`);
  }

  async createError(params: CreateErrorParams): Promise<WorkflowError> {
    return this.client.post<WorkflowError>('/errors', params as unknown as Record<string, unknown>);
  }

  async listEvents(params?: { cursor?: string; limit?: number; errorId?: string }): Promise<ListEventsResponse> {
    return this.client.get<ListEventsResponse>('/events', params);
  }

  async search(params: SearchParams): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', params as unknown as Record<string, unknown>);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, params, body } = options;
    return this.client.request<T>(path, { method, params, body });
  }
}

export { StopAndErrorClient } from './client';
