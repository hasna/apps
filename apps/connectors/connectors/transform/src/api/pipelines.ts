import type { TransformClient } from './client';
import type { Pipeline, PipelineCreateParams, PipelineListResponse } from '../types';

export class PipelinesApi {
  constructor(private readonly client: TransformClient) {}

  list(params?: Record<string, string | number | boolean | undefined>): Promise<PipelineListResponse> {
    return this.client.get<PipelineListResponse>('/pipelines', params);
  }

  create(body: PipelineCreateParams): Promise<Pipeline> {
    return this.client.post<Pipeline>('/pipelines', body);
  }

  get(pipelineId: string): Promise<Pipeline> {
    return this.client.get<Pipeline>(`/pipelines/${encodeURIComponent(pipelineId)}`);
  }
}
