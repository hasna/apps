import type { ConnectorClient } from './client';
import type { StreakPipeline, PipelineCreateParams, PipelineUpdateParams } from '../types';

export class PipelinesApi {
  constructor(private readonly client: ConnectorClient) {}

  async list(): Promise<StreakPipeline[]> {
    return this.client.get<StreakPipeline[]>('/pipelines');
  }

  async get(key: string): Promise<StreakPipeline> {
    return this.client.get<StreakPipeline>(`/pipelines/${encodeURIComponent(key)}`);
  }

  async create(data: PipelineCreateParams): Promise<StreakPipeline> {
    return this.client.putForm<StreakPipeline>('/pipelines', data);
  }

  async update(key: string, data: PipelineUpdateParams): Promise<StreakPipeline> {
    return this.client.post<StreakPipeline>(`/pipelines/${encodeURIComponent(key)}`, data);
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(`/pipelines/${encodeURIComponent(key)}`);
  }
}
