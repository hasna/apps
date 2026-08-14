import type {
  TryPrismCandidate,
  TryPrismConfig,
  TryPrismListResponse,
  TryPrismSearch,
  TryPrismShortlist,
} from '../types';
import { encodePathSegment, TryPrismClient } from './client';

export { TryPrismClient, DEFAULT_BASE_URL, encodePathSegment } from './client';

export interface RawRequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * TryPrism API connector for AI-native recruiting.
 */
export class TryPrism {
  private readonly client: TryPrismClient;

  constructor(config: TryPrismConfig) {
    this.client = new TryPrismClient(config);
  }

  static fromEnv(): TryPrism {
    const apiKey = process.env.TRYPRISM_API_KEY;
    const baseUrl = process.env.TRYPRISM_BASE_URL;
    if (!apiKey) {
      throw new Error('TRYPRISM_API_KEY environment variable is required');
    }
    return new TryPrism({ apiKey, baseUrl });
  }

  async listSearches(
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<TryPrismListResponse<TryPrismSearch> | TryPrismSearch[]> {
    return this.client.get('/searches', params);
  }

  async getSearch(searchId: string): Promise<TryPrismSearch> {
    return this.client.get(`/searches/${encodePathSegment(searchId)}`);
  }

  async createSearch(body: Record<string, unknown>): Promise<TryPrismSearch> {
    return this.client.post('/searches', body);
  }

  async listCandidates(
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<TryPrismListResponse<TryPrismCandidate> | TryPrismCandidate[]> {
    return this.client.get('/candidates', params);
  }

  async getCandidate(candidateId: string): Promise<TryPrismCandidate> {
    return this.client.get(`/candidates/${encodePathSegment(candidateId)}`);
  }

  async submitCandidateFeedback(
    candidateId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.client.post(
      `/candidates/${encodePathSegment(candidateId)}/feedback`,
      body,
    );
  }

  async listShortlists(
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<TryPrismListResponse<TryPrismShortlist> | TryPrismShortlist[]> {
    return this.client.get('/shortlists', params);
  }

  async getShortlist(shortlistId: string): Promise<TryPrismShortlist> {
    return this.client.get(`/shortlists/${encodePathSegment(shortlistId)}`);
  }

  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { path, method = 'GET', query, body, headers } = options;
    return this.client.request<T>(path, { method, params: query, body, headers });
  }

  getClient(): TryPrismClient {
    return this.client;
  }
}
