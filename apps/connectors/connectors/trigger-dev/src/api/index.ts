import { TriggerDevClient } from './client';
import type {
  TriggerDevConfig,
  Run,
  RunListParams,
  RunListResponse,
  TriggerRunRequest,
  EventListResponse,
  SearchRequest,
  SearchResponse,
  RawRequestOptions,
} from '../types';

export { TriggerDevClient };

/**
 * Trigger.dev management API wrapper.
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
  async listRuns(params: RunListParams = {}): Promise<RunListResponse> {
    const queryParams: Record<string, string | number | readonly (string | number | boolean)[] | undefined> = {
      'page[size]': params.limit,
      'page[after]': params.after,
      'page[before]': params.before,
      'filter[status]': params.status,
      'filter[taskIdentifier]': params.taskIdentifier,
      'filter[version]': params.version,
      'filter[createdAt][from]': params.from,
      'filter[createdAt][to]': params.to,
      'filter[createdAt][period]': params.period,
    };
    return this.client.get<RunListResponse>('/runs', queryParams);
  }

  /**
   * Trigger a task (POST /tasks/{taskIdentifier}/trigger)
   */
  async triggerTask(request: TriggerRunRequest): Promise<Run> {
    const { taskIdentifier, ...body } = request;
    return this.client.post<Run>(`/tasks/${encodeURIComponent(taskIdentifier)}/trigger`, body);
  }

  /**
   * Backwards-compatible alias for triggering a task.
   */
  async createRun(body: TriggerRunRequest): Promise<Run> {
    return this.triggerTask(body);
  }

  /**
   * Get a run by ID (GET /runs/{runId})
   */
  async getRun(runId: string): Promise<Run> {
    return this.client.get<Run>(`/runs/${encodeURIComponent(runId)}`);
  }

  /**
   * List run events (GET /runs/{runId}/events)
   */
  async listEvents(runId: string): Promise<EventListResponse> {
    return this.client.get<EventListResponse>(`/runs/${encodeURIComponent(runId)}/events`);
  }

  /**
   * Execute a TRQL query (POST /query)
   */
  async search(body: SearchRequest): Promise<SearchResponse> {
    return this.client.post<SearchResponse>('/query', body);
  }

  /**
   * Generic authenticated request escape hatch
   */
  async rawRequest<T = unknown>(options: RawRequestOptions): Promise<T> {
    const { method = 'GET', path, params, body, headers } = options;
    return this.client.request<T>(path, { method, params, body, headers });
  }
}
