import type { CreateRunParams, RunSummary, RunsListResponse } from '../types';
import type { WeightsBiasesClient } from './client';

export interface ListRunsParams {
  entity?: string;
  project?: string;
  filters?: string;
  order?: string;
  perPage?: number;
  [key: string]: string | number | boolean | undefined;
}

export class RunsApi {
  constructor(private readonly client: WeightsBiasesClient) {}

  list(params?: ListRunsParams): Promise<RunsListResponse> {
    return this.client.get<RunsListResponse>('/runs', params);
  }

  get(runId: string): Promise<RunSummary> {
    const encoded = encodeURIComponent(runId);
    return this.client.get<RunSummary>(`/runs/${encoded}`);
  }

  create(body: CreateRunParams): Promise<RunSummary> {
    return this.client.post<RunSummary>('/runs', body);
  }
}
