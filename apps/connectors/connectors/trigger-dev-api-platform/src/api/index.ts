import { TriggerDevClient, flattenRunsListParams } from './client';
import type {
  TriggerDevConfig,
  ListRunsResult,
  ListRunsParams,
  TriggerTaskBody,
  TriggerTaskResponse,
  ListSchedulesResult,
  ScheduleObject,
  ExecuteQueryParams,
  ExecuteQueryResponse,
} from '../types';

export { TriggerDevClient, flattenRunsListParams };

/**
 * Trigger.dev API Platform wrapper
 */
export class TriggerDevApiPlatform {
  private client: TriggerDevClient;

  constructor(config: TriggerDevConfig) {
    this.client = new TriggerDevClient(config);
  }

  getClient(): TriggerDevClient {
    return this.client;
  }

  private requireSecretKey(operation: string): void {
    if (this.client.isPersonalAccessToken()) {
      throw new Error(`${operation} requires a Trigger.dev project secret key; PAT auth is only supported for project-scoped run listing.`);
    }
  }

  private getRequiredProjectRef(): string {
    const projectRef = this.client.getProjectRef();
    if (!projectRef) {
      throw new Error('projectRef is required when listing runs with a Trigger.dev personal access token');
    }
    return projectRef;
  }

  // Runs (list-items / get-item)

  async listRuns(params?: ListRunsParams & {
    pageSize?: number;
    pageAfter?: string;
    pageBefore?: string;
    status?: string[];
    taskIdentifier?: string[];
    period?: string;
    isTest?: boolean;
  }): Promise<ListRunsResult> {
    const query = flattenRunsListParams({
      pageSize: params?.pageSize ?? params?.page?.size,
      pageAfter: params?.pageAfter ?? params?.page?.after,
      pageBefore: params?.pageBefore ?? params?.page?.before,
      status: params?.status ?? params?.filter?.status,
      taskIdentifier: params?.taskIdentifier ?? params?.filter?.taskIdentifier,
      period: params?.period ?? params?.filter?.createdAt?.period,
      isTest: params?.isTest ?? params?.filter?.isTest,
    });

    if (this.client.isPersonalAccessToken()) {
      const projectRef = this.getRequiredProjectRef();
      return this.client.get<ListRunsResult>(`/api/v1/projects/${encodeURIComponent(projectRef)}/runs`, query);
    }

    return this.client.get<ListRunsResult>('/api/v1/runs', query);
  }

  async getRun(runId: string): Promise<Record<string, unknown>> {
    this.requireSecretKey('Retrieving a run');
    return this.client.get<Record<string, unknown>>(`/api/v3/runs/${encodeURIComponent(runId)}`);
  }

  // Tasks (create-item)

  async triggerTask(taskIdentifier: string, body: TriggerTaskBody): Promise<TriggerTaskResponse> {
    this.requireSecretKey('Triggering a task');
    return this.client.post<TriggerTaskResponse>(
      `/api/v1/tasks/${encodeURIComponent(taskIdentifier)}/trigger`,
      body,
    );
  }

  // Schedules (list-events)

  async listSchedules(params?: { page?: number; perPage?: number }): Promise<ListSchedulesResult> {
    this.requireSecretKey('Listing schedules');
    return this.client.get<ListSchedulesResult>('/api/v1/schedules', {
      page: params?.page,
      perPage: params?.perPage,
    });
  }

  async getSchedule(scheduleId: string): Promise<ScheduleObject> {
    this.requireSecretKey('Retrieving a schedule');
    return this.client.get<ScheduleObject>(`/api/v1/schedules/${encodeURIComponent(scheduleId)}`);
  }

  // Query (search)

  async executeQuery(params: ExecuteQueryParams): Promise<ExecuteQueryResponse> {
    this.requireSecretKey('Executing a TRQL query');
    return this.client.post<ExecuteQueryResponse>('/api/v1/query', params);
  }

  // Raw request escape hatch

  async rawRequest<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    options?: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown> | unknown[] | string;
    },
  ): Promise<T> {
    return this.client.request<T>(path, {
      method,
      params: options?.query,
      body: options?.body,
    });
  }
}

export default TriggerDevApiPlatform;
