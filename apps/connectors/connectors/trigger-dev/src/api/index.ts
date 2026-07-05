import { TriggerDevClient } from './client';
import type {
  TriggerDevConfig,
  Run,
  RunListResponse,
  EventListResponse,
  SearchRequest,
  SearchResponse,
  RawRequestOptions,
} from '../types';

export { TriggerDevClient };

/**
 * Trigger.dev API wrapper (v1 REST surface)
 */
export class TriggerDev {
  private client: TriggerDevClient;

  constructor(config: TriggerDevConfig) {
    this.client = new TriggerDevClient(config);
  }

  getClient(): TriggerDevClient {
    return this.client;
  }

  /**
   * List runs (GET /runs)
   */
  async listRuns(params?: Record<string, string | number | boolean | undefined>): Promise<RunListResponse> {
    return this.client.get<RunListResponse>('/runs', params);
  }

  /**
   * Create a run (POST /runs)
   */
  async createRun(body: Record<string, unknown>): Promise<Run> {
    return this.client.post<Run>('/runs', body);
  }

  /**
   * Get a run by ID (GET /runs/{runId})
   */
  async getRun(runId: string): Promise<Run> {
    return this.client.get<Run>(`/runs/${encodeURIComponent(runId)}`);
  }

  /**
   * List events (GET /events)
   */
  async listEvents(params?: Record<string, string | number | boolean | undefined>): Promise<EventListResponse> {
    return this.client.get<EventListResponse>('/events', params);
  }

  /**
   * Search (POST /search)
   */
  async search(body: SearchRequest): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/search', body);
  }

  /**
   * Generic authenticated request escape hatch
   */
  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, params, body, headers } = options;
    return this.client.request<T>(path, { method, params, body, headers });
  }
}
